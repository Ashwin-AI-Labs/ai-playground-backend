import type { Migration } from "../types";

/**
 * AI Research Assistant sessions and source registry.
 * Separate from Chat / RAG tables.
 */
export const migration: Migration = {
  version: "0009",
  name: "create_research_sessions",
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS research_sessions (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        title TEXT NOT NULL,
        question TEXT NOT NULL,
        status TEXT NOT NULL
          CHECK (status IN ('pending', 'running', 'completed', 'failed')),
        report JSONB NULL,
        insufficient_evidence BOOLEAN NOT NULL DEFAULT FALSE,
        error_message TEXT NULL,
        duration_ms INTEGER NULL,
        search_query_count INTEGER NOT NULL DEFAULT 0,
        source_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS research_sessions_updated_at_idx
      ON research_sessions (updated_at DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS research_sources (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        session_id BIGINT NOT NULL
          REFERENCES research_sessions(id) ON DELETE CASCADE,
        source_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        domain TEXT NOT NULL,
        snippet TEXT NOT NULL DEFAULT '',
        excerpt TEXT NOT NULL DEFAULT '',
        published_at TEXT NULL,
        retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        fetch_status TEXT NOT NULL DEFAULT 'snippet_only'
          CHECK (fetch_status IN ('fetched', 'snippet_only', 'blocked', 'failed')),
        provider TEXT NOT NULL DEFAULT 'tavily',
        CONSTRAINT research_sources_session_number_uidx
          UNIQUE (session_id, source_number)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS research_sources_session_id_idx
      ON research_sources (session_id)
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS research_sources_session_url_uidx
      ON research_sources (session_id, url)
    `);
  },
};
