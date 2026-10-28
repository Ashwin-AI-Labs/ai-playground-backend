import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import {
  assertNoMissingMigrations,
  buildMigrationStatus,
  MigrationError,
  validateMigrations,
} from "./runner";
import type { Migration } from "./types";

function migration(
  version: string,
  name: string,
  up: Migration["up"] = async () => undefined,
): Migration {
  return { version, name, up };
}

describe("validateMigrations", () => {
  it("sorts migrations by version", () => {
    const sorted = validateMigrations([
      migration("0003", "c"),
      migration("0001", "a"),
      migration("0002", "b"),
    ]);
    expect(sorted.map((item) => item.version)).toEqual(["0001", "0002", "0003"]);
  });

  it("rejects duplicate versions", () => {
    expect(() =>
      validateMigrations([migration("0001", "a"), migration("0001", "b")]),
    ).toThrowError(/Duplicate migration version/);
  });

  it("rejects invalid version formats", () => {
    expect(() => validateMigrations([migration("1", "a")])).toThrowError(
      /Invalid migration version/,
    );
  });
});

describe("buildMigrationStatus", () => {
  it("marks already-applied migrations and pending ones", () => {
    const statuses = buildMigrationStatus(
      [migration("0001", "one"), migration("0002", "two")],
      [
        {
          version: "0001",
          name: "one",
          applied_at: new Date("2026-10-26T00:00:00.000Z"),
        },
      ],
    );

    expect(statuses).toEqual([
      {
        version: "0001",
        name: "one",
        status: "applied",
        appliedAt: "2026-10-26T00:00:00.000Z",
      },
      {
        version: "0002",
        name: "two",
        status: "pending",
      },
    ]);
  });

  it("detects missing migration files referenced by tracking history", () => {
    const statuses = buildMigrationStatus([migration("0001", "one")], [
      {
        version: "0001",
        name: "one",
        applied_at: new Date("2026-10-26T00:00:00.000Z"),
      },
      {
        version: "0099",
        name: "ghost",
        applied_at: new Date("2026-10-26T01:00:00.000Z"),
      },
    ]);

    expect(statuses.some((item) => item.status === "missing")).toBe(true);
    expect(() => assertNoMissingMigrations(statuses)).toThrowError(
      /missing from the repository/,
    );
  });
});

describe("applyPendingMigrations transaction behavior", () => {
  it("rolls back a failed migration and does not record success", async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(String(sql).trim().split("\n")[0] ?? "");
        if (String(sql).includes("pg_try_advisory_lock")) {
          return { rows: [{ locked: true }] };
        }
        if (String(sql).includes("information_schema.tables")) {
          return { rows: [{ exists: true }] };
        }
        if (String(sql).includes("FROM schema_migrations")) {
          return { rows: [] };
        }
        if (String(sql).includes("INSERT INTO schema_migrations")) {
          throw new Error("should not insert after failure");
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    } as unknown as PoolClient;

    const pool = {
      connect: vi.fn(async () => client),
    };

    const { applyPendingMigrations } = await import("./runner");

    const failing: Migration[] = [
      migration("0001", "create_migration_tracking", async () => {
        throw new Error("boom");
      }),
    ];

    await expect(applyPendingMigrations(pool as never, failing)).rejects.toBeInstanceOf(
      MigrationError,
    );

    expect(queries.some((sql) => sql.startsWith("BEGIN"))).toBe(true);
    expect(queries.some((sql) => sql.startsWith("ROLLBACK"))).toBe(true);
    expect(queries.some((sql) => sql.includes("INSERT INTO schema_migrations"))).toBe(
      false,
    );
  });
});
