import type { Migration } from "../types";

export const migration: Migration = {
  version: "0005",
  name: "create_tasks",
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT NOT NULL DEFAULT 'medium'
          CHECK (priority IN ('low', 'medium', 'high')),
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'in_progress', 'completed')),
        due_date TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status);
      CREATE INDEX IF NOT EXISTS tasks_priority_idx ON tasks (priority);
      CREATE INDEX IF NOT EXISTS tasks_created_at_idx ON tasks (created_at DESC);
    `);
  },
};
