import type { Migration } from "../types";

/**
 * Adds nullable PDF page range metadata to search chunks.
 * Existing rows remain NULL (page unavailable) until documents are re-indexed.
 */
export const migration: Migration = {
  version: "0007",
  name: "add_chunk_page_metadata",
  async up(client) {
    await client.query(`
      ALTER TABLE search_document_chunks
      ADD COLUMN IF NOT EXISTS page_start INTEGER NULL
    `);
    await client.query(`
      ALTER TABLE search_document_chunks
      ADD COLUMN IF NOT EXISTS page_end INTEGER NULL
    `);
    await client.query(`
      ALTER TABLE search_document_chunks
      DROP CONSTRAINT IF EXISTS search_document_chunks_page_range_chk
    `);
    await client.query(`
      ALTER TABLE search_document_chunks
      ADD CONSTRAINT search_document_chunks_page_range_chk
      CHECK (
        (page_start IS NULL AND page_end IS NULL)
        OR (
          page_start IS NOT NULL
          AND page_end IS NOT NULL
          AND page_start >= 1
          AND page_end >= page_start
        )
      )
    `);
  },
};
