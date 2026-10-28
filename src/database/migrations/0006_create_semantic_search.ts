import type { Migration } from "../types";

/**
 * Semantic Document Search tables + pgvector extension.
 *
 * Embedding column dimension: 1536 — matches OpenAI text-embedding-3-small
 * default output (also OPENAI_EMBEDDING_DIMENSIONS default).
 * Changing the model/dimensions requires a new migration.
 */
export const migration: Migration = {
  version: "0006",
  name: "create_semantic_search",
  async up(client) {
    await client.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS search_documents (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        filename TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_size_bytes BIGINT NOT NULL,
        content_hash TEXT NOT NULL,
        status TEXT NOT NULL
          CHECK (status IN ('processing', 'completed', 'failed')),
        error_message TEXT NULL,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS search_documents_content_hash_completed_uidx
      ON search_documents (content_hash)
      WHERE status = 'completed'
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS search_documents_created_at_idx
      ON search_documents (created_at DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS search_document_chunks (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        document_id BIGINT NOT NULL
          REFERENCES search_documents(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        embedding VECTOR(1536) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT search_document_chunks_document_chunk_uidx
          UNIQUE (document_id, chunk_index)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS search_document_chunks_document_id_idx
      ON search_document_chunks (document_id)
    `);

    // Cosine distance index for semantic search (pgvector HNSW).
    // Safe to create on empty/small tables; improves ranking as data grows.
    await client.query(`
      CREATE INDEX IF NOT EXISTS search_document_chunks_embedding_hnsw_idx
      ON search_document_chunks
      USING hnsw (embedding vector_cosine_ops)
    `);
  },
};
