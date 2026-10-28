import type { Migration } from "../types";

/**
 * RAG Q&A sessions, messages, and validated citation snapshots.
 * Separate from Chat Assistant conversations.
 */
export const migration: Migration = {
  version: "0008",
  name: "create_rag_sessions",
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS rag_sessions (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS rag_sessions_updated_at_idx
      ON rag_sessions (updated_at DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS rag_messages (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        session_id BIGINT NOT NULL
          REFERENCES rag_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        insufficient_evidence BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS rag_messages_session_id_idx
      ON rag_messages (session_id, id ASC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS rag_message_citations (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        message_id BIGINT NOT NULL
          REFERENCES rag_messages(id) ON DELETE CASCADE,
        citation_number INTEGER NOT NULL,
        document_id BIGINT NOT NULL,
        chunk_id BIGINT NOT NULL,
        filename TEXT NOT NULL,
        page_number INTEGER NULL,
        excerpt TEXT NOT NULL,
        similarity DOUBLE PRECISION NULL,
        CONSTRAINT rag_message_citations_message_number_uidx
          UNIQUE (message_id, citation_number)
      )
    `);
  },
};
