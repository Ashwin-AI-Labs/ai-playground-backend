import type { Migration } from "../types";

/**
 * Document summarizer history (Project 6).
 * Stores summary JSON and metadata; does not store original file bytes.
 */
export const migration: Migration = {
  version: "0011",
  name: "create_document_summaries",
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS document_summaries (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        document_name TEXT NOT NULL,
        file_type TEXT NOT NULL
          CHECK (file_type IN ('pdf', 'txt', 'md')),
        file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes >= 0),
        content_hash TEXT NOT NULL,
        status TEXT NOT NULL
          CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
        summary_length TEXT NOT NULL
          CHECK (summary_length IN ('short', 'medium', 'detailed')),
        summary_style TEXT NOT NULL
          CHECK (summary_style IN ('general', 'executive', 'technical', 'academic', 'meeting_notes')),
        strategy TEXT NOT NULL
          CHECK (strategy IN ('direct', 'map_reduce', 'refine')),
        chunk_count INTEGER NOT NULL DEFAULT 0,
        page_count INTEGER NULL,
        model_id TEXT NULL,
        duration_ms INTEGER NULL,
        summary_json JSONB NULL,
        warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
        error_message TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS document_summaries_updated_at_idx
      ON document_summaries (updated_at DESC)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS document_summaries_content_hash_idx
      ON document_summaries (content_hash)
    `);
  },
};
