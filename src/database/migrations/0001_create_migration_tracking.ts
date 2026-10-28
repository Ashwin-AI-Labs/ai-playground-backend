import type { Migration } from "../types";

export const migration: Migration = {
  version: "0001",
  name: "create_migration_tracking",
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  },
};
