import { pool } from "../../database/pool";
import { toApiId } from "../../database/id";
import { toPgVectorLiteral } from "../../services/embeddings";
import type { DocumentStatus } from "./semantic-search.types";

export type SearchDocumentRecord = {
  id: string;
  filename: string;
  original_filename: string;
  mime_type: string;
  file_size_bytes: string;
  content_hash: string;
  status: DocumentStatus;
  error_message: string | null;
  chunk_count: number;
  created_at: Date;
  updated_at: Date;
};

type DocumentRow = {
  id: string | number | bigint;
  filename: string;
  original_filename: string;
  mime_type: string;
  file_size_bytes: string | number | bigint;
  content_hash: string;
  status: DocumentStatus;
  error_message: string | null;
  chunk_count: number;
  created_at: Date;
  updated_at: Date;
};

function mapDocument(row: DocumentRow): SearchDocumentRecord {
  return {
    id: toApiId(row.id),
    filename: row.filename,
    original_filename: row.original_filename,
    mime_type: row.mime_type,
    file_size_bytes: toApiId(row.file_size_bytes),
    content_hash: row.content_hash,
    status: row.status,
    error_message: row.error_message,
    chunk_count: row.chunk_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function findCompletedByContentHash(
  contentHash: string,
  userId: string,
): Promise<SearchDocumentRecord | null> {
  const result = await pool.query<DocumentRow>(
    `
      SELECT *
      FROM search_documents
      WHERE content_hash = $1 AND status = 'completed' AND user_id = $2
      ORDER BY id ASC
      LIMIT 1
    `,
    [contentHash, userId],
  );
  return result.rows[0] ? mapDocument(result.rows[0]) : null;
}

export async function createDocument(input: {
  filename: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  contentHash: string;
  status: DocumentStatus;
  userId: string;
}): Promise<SearchDocumentRecord> {
  const result = await pool.query<DocumentRow>(
    `
      INSERT INTO search_documents (
        filename,
        original_filename,
        mime_type,
        file_size_bytes,
        content_hash,
        status,
        user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `,
    [
      input.filename,
      input.originalFilename,
      input.mimeType,
      input.fileSizeBytes,
      input.contentHash,
      input.status,
      input.userId,
    ],
  );
  return mapDocument(result.rows[0]);
}

export async function updateDocumentStatus(
  documentId: string,
  input: {
    status: DocumentStatus;
    errorMessage?: string | null;
    chunkCount?: number;
  },
): Promise<SearchDocumentRecord | null> {
  const result = await pool.query<DocumentRow>(
    `
      UPDATE search_documents
      SET
        status = $2,
        error_message = $3,
        chunk_count = COALESCE($4, chunk_count),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      documentId,
      input.status,
      input.errorMessage ?? null,
      input.chunkCount ?? null,
    ],
  );
  return result.rows[0] ? mapDocument(result.rows[0]) : null;
}

export async function insertChunks(
  documentId: string,
  chunks: Array<{
    index: number;
    content: string;
    embedding: number[];
    pageStart?: number | null;
    pageEnd?: number | null;
  }>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM search_document_chunks WHERE document_id = $1`, [
      documentId,
    ]);

    for (const chunk of chunks) {
      await client.query(
        `
          INSERT INTO search_document_chunks (
            document_id,
            chunk_index,
            content,
            embedding,
            page_start,
            page_end
          )
          VALUES ($1, $2, $3, $4::vector, $5, $6)
        `,
        [
          documentId,
          chunk.index,
          chunk.content,
          toPgVectorLiteral(chunk.embedding),
          chunk.pageStart ?? null,
          chunk.pageEnd ?? null,
        ],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteDocument(
  documentId: string,
  userId: string,
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM search_documents WHERE id = $1 AND user_id = $2`,
    [documentId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getDocumentById(
  documentId: string,
  userId: string,
): Promise<SearchDocumentRecord | null> {
  const result = await pool.query<DocumentRow>(
    `SELECT * FROM search_documents WHERE id = $1 AND user_id = $2`,
    [documentId, userId],
  );
  return result.rows[0] ? mapDocument(result.rows[0]) : null;
}

export async function listDocuments(input: {
  limit: number;
  offset: number;
  userId?: string;
}): Promise<{ documents: SearchDocumentRecord[]; total: number }> {
  const where = input.userId ? `WHERE user_id = $3` : "";
  const params: unknown[] = [input.limit, input.offset];
  if (input.userId) params.push(input.userId);

  const countResult = await pool.query<{ count: string }>(
    input.userId
      ? `SELECT COUNT(*)::text AS count FROM search_documents WHERE user_id = $1`
      : `SELECT COUNT(*)::text AS count FROM search_documents`,
    input.userId ? [input.userId] : [],
  );
  const result = await pool.query<DocumentRow>(
    `
      SELECT *
      FROM search_documents
      ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT $1 OFFSET $2
    `,
    params,
  );

  return {
    documents: result.rows.map(mapDocument),
    total: Number(countResult.rows[0]?.count ?? 0),
  };
}

export async function countCompletedDocuments(userId?: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    userId
      ? `SELECT COUNT(*)::text AS count FROM search_documents WHERE status = 'completed' AND user_id = $1`
      : `SELECT COUNT(*)::text AS count FROM search_documents WHERE status = 'completed'`,
    userId ? [userId] : [],
  );
  return Number(result.rows[0]?.count ?? 0);
}
