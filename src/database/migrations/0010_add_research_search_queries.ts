import type { Migration } from "../types";

/**
 * Persist the search queries used during a research run.
 */
export const migration: Migration = {
  version: "0010",
  name: "add_research_search_queries",
  async up(client) {
    await client.query(`
      ALTER TABLE research_sessions
      ADD COLUMN IF NOT EXISTS search_queries JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
  },
};
