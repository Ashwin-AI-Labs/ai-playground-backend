import { pool } from "../../database/pool";
import { toApiId } from "../../database/id";
import { toPgVectorLiteral } from "../embeddings";

export type SimilarityHit = {
  chunkId: string;
  documentId: string;
  filename: string;
  originalFilename: string;
  chunkIndex: number;
  content: string;
  /** Cosine similarity in [0, 1] derived as 1 - cosine_distance. */
  similarity: number;
  documentCreatedAt: string;
  pageStart: number | null;
  pageEnd: number | null;
};

/**
 * Rank chunks by cosine similarity using pgvector's <=> distance operator.
 * Only completed documents are searched.
 */
export async function searchSimilarChunks(input: {
  queryEmbedding: number[];
  limit: number;
  documentIds?: string[];
  minSimilarity?: number;
}): Promise<SimilarityHit[]> {
  const vectorLiteral = toPgVectorLiteral(input.queryEmbedding);
  const params: unknown[] = [vectorLiteral, input.limit];
  let documentFilter = "";
  let similarityFilter = "";

  if (input.documentIds && input.documentIds.length > 0) {
    params.push(input.documentIds);
    documentFilter = `AND d.id = ANY($${params.length}::bigint[])`;
  }

  if (
    typeof input.minSimilarity === "number" &&
    Number.isFinite(input.minSimilarity)
  ) {
    // cosine distance = 1 - similarity
    params.push(1 - input.minSimilarity);
    similarityFilter = `AND (c.embedding <=> $1::vector) <= $${params.length}`;
  }

  const result = await pool.query<{
    chunk_id: string | number | bigint;
    document_id: string | number | bigint;
    filename: string;
    original_filename: string;
    chunk_index: number;
    content: string;
    distance: number;
    document_created_at: Date;
    page_start: number | null;
    page_end: number | null;
  }>(
    `
      SELECT
        c.id AS chunk_id,
        c.document_id,
        d.filename,
        d.original_filename,
        c.chunk_index,
        c.content,
        (c.embedding <=> $1::vector) AS distance,
        d.created_at AS document_created_at,
        c.page_start,
        c.page_end
      FROM search_document_chunks c
      INNER JOIN search_documents d ON d.id = c.document_id
      WHERE d.status = 'completed'
        ${documentFilter}
        ${similarityFilter}
      ORDER BY c.embedding <=> $1::vector ASC
      LIMIT $2
    `,
    params,
  );

  return result.rows.map((row) => {
    const distance = Number(row.distance);
    const similarity = Number.isFinite(distance)
      ? Math.max(0, Math.min(1, 1 - distance))
      : 0;

    return {
      chunkId: toApiId(row.chunk_id),
      documentId: toApiId(row.document_id),
      filename: row.filename,
      originalFilename: row.original_filename,
      chunkIndex: row.chunk_index,
      content: row.content,
      similarity,
      documentCreatedAt: row.document_created_at.toISOString(),
      pageStart: row.page_start,
      pageEnd: row.page_end,
    };
  });
}
