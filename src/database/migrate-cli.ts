import { pool, closePool } from "./pool";
import { applyPendingMigrations, getMigrationStatus, MigrationError } from "./runner";

async function printStatus(): Promise<void> {
  const statuses = await getMigrationStatus(pool);
  if (statuses.length === 0) {
    console.log("No migrations registered.");
    return;
  }

  for (const status of statuses) {
    const appliedAt = status.appliedAt ? ` @ ${status.appliedAt}` : "";
    console.log(
      `${status.version}_${status.name.padEnd(32)} ${status.status}${appliedAt}`,
    );
  }
}

async function runUp(): Promise<void> {
  const result = await applyPendingMigrations(pool);
  if (result.applied.length === 0) {
    console.log("No pending migrations.");
  } else {
    console.log("Applied migrations:");
    for (const name of result.applied) {
      console.log(`  - ${name}`);
    }
  }
  if (result.skipped.length > 0) {
    console.log("Already applied:");
    for (const name of result.skipped) {
      console.log(`  - ${name}`);
    }
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "up";

  try {
    if (command === "up") {
      await runUp();
    } else if (command === "status") {
      await printStatus();
    } else {
      console.error(`Unknown command "${command}". Use "up" or "status".`);
      process.exitCode = 1;
    }
  } catch (error) {
    if (error instanceof MigrationError) {
      console.error(error.message);
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

void main();
