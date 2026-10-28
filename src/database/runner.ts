import type { Pool, PoolClient } from "pg";
import { migrations as registeredMigrations } from "./migrations";
import type { AppliedMigration, Migration, MigrationStatus } from "./types";

/** Arbitrary but stable lock key for AI Playground schema migrations. */
export const MIGRATION_ADVISORY_LOCK_KEY = 8_826_451_903;

const VERSION_PATTERN = /^\d{4}$/;
const NAME_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

export function validateMigrations(migrations: Migration[]): Migration[] {
  if (migrations.length === 0) {
    throw new MigrationError("No migrations are registered.");
  }

  const seen = new Set<string>();
  for (const migration of migrations) {
    if (!VERSION_PATTERN.test(migration.version)) {
      throw new MigrationError(
        `Invalid migration version "${migration.version}". Expected four digits, e.g. 0001.`,
      );
    }
    if (!NAME_PATTERN.test(migration.name)) {
      throw new MigrationError(
        `Invalid migration name "${migration.name}". Use snake_case.`,
      );
    }
    if (typeof migration.up !== "function") {
      throw new MigrationError(
        `Migration ${migration.version}_${migration.name} is missing an up() function.`,
      );
    }
    if (seen.has(migration.version)) {
      throw new MigrationError(
        `Duplicate migration version detected: ${migration.version}`,
      );
    }
    seen.add(migration.version);
  }

  return [...migrations].sort((a, b) => a.version.localeCompare(b.version));
}

async function trackingTableExists(client: PoolClient): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'schema_migrations'
     ) AS exists`,
  );
  return result.rows[0]?.exists === true;
}

export async function listAppliedMigrations(
  client: PoolClient,
): Promise<AppliedMigration[]> {
  if (!(await trackingTableExists(client))) {
    return [];
  }

  const result = await client.query<AppliedMigration>(
    `SELECT version, name, applied_at
     FROM schema_migrations
     ORDER BY version ASC`,
  );
  return result.rows;
}

export function buildMigrationStatus(
  migrations: Migration[],
  applied: AppliedMigration[],
): MigrationStatus[] {
  const sorted = validateMigrations(migrations);
  const appliedByVersion = new Map(applied.map((row) => [row.version, row]));
  const registeredVersions = new Set(sorted.map((migration) => migration.version));

  const statuses: MigrationStatus[] = sorted.map((migration) => {
    const row = appliedByVersion.get(migration.version);
    if (!row) {
      return {
        version: migration.version,
        name: migration.name,
        status: "pending",
      };
    }
    return {
      version: migration.version,
      name: migration.name,
      status: "applied",
      appliedAt: row.applied_at.toISOString(),
    };
  });

  for (const row of applied) {
    if (!registeredVersions.has(row.version)) {
      statuses.push({
        version: row.version,
        name: row.name,
        status: "missing",
        appliedAt: row.applied_at.toISOString(),
      });
    }
  }

  return statuses.sort((a, b) => a.version.localeCompare(b.version));
}

export function assertNoMissingMigrations(statuses: MigrationStatus[]): void {
  const missing = statuses.filter((status) => status.status === "missing");
  if (missing.length === 0) {
    return;
  }

  const details = missing
    .map(
      (item) =>
        `  - ${item.version}_${item.name} (applied at ${item.appliedAt ?? "unknown"})`,
    )
    .join("\n");

  throw new MigrationError(
    `Migration tracking references files that are missing from the repository:\n${details}\n\nRestore the missing migration source files before running migrations again. Do not delete rows from schema_migrations unless you are performing a carefully planned repair.`,
  );
}

async function withAdvisoryLock<T>(
  client: PoolClient,
  fn: () => Promise<T>,
): Promise<T> {
  const lock = await client.query<{ locked: boolean }>(
    `SELECT pg_try_advisory_lock($1) AS locked`,
    [MIGRATION_ADVISORY_LOCK_KEY],
  );

  if (!lock.rows[0]?.locked) {
    throw new MigrationError(
      "Could not acquire migration advisory lock. Another migration runner may be active.",
    );
  }

  try {
    return await fn();
  } finally {
    await client.query(`SELECT pg_advisory_unlock($1)`, [
      MIGRATION_ADVISORY_LOCK_KEY,
    ]);
  }
}

export async function getMigrationStatus(
  pool: Pool,
  migrations: Migration[] = registeredMigrations,
): Promise<MigrationStatus[]> {
  const client = await pool.connect();
  try {
    return await withAdvisoryLock(client, async () => {
      const applied = await listAppliedMigrations(client);
      const statuses = buildMigrationStatus(migrations, applied);
      assertNoMissingMigrations(statuses);
      return statuses;
    });
  } finally {
    client.release();
  }
}

export async function applyPendingMigrations(
  pool: Pool,
  migrations: Migration[] = registeredMigrations,
): Promise<{ applied: string[]; skipped: string[] }> {
  const client = await pool.connect();
  try {
    return await withAdvisoryLock(client, async () => {
      const sorted = validateMigrations(migrations);
      const appliedRows = await listAppliedMigrations(client);
      const statuses = buildMigrationStatus(sorted, appliedRows);
      assertNoMissingMigrations(statuses);

      const appliedVersions = new Set(
        appliedRows.map((row) => row.version),
      );
      const applied: string[] = [];
      const skipped: string[] = [];

      for (const migration of sorted) {
        const key = `${migration.version}_${migration.name}`;
        if (appliedVersions.has(migration.version)) {
          skipped.push(key);
          continue;
        }

        try {
          await client.query("BEGIN");
          await migration.up(client);
          await client.query(
            `INSERT INTO schema_migrations (version, name)
             VALUES ($1, $2)`,
            [migration.version, migration.name],
          );
          await client.query("COMMIT");
          applied.push(key);
          appliedVersions.add(migration.version);
        } catch (error) {
          await client.query("ROLLBACK");
          const message =
            error instanceof Error ? error.message : "Unknown migration error";
          throw new MigrationError(
            `Migration ${key} failed and was rolled back: ${message}`,
          );
        }
      }

      return { applied, skipped };
    });
  } finally {
    client.release();
  }
}
