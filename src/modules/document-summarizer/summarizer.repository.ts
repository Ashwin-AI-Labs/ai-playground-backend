import { pool } from "../../database/pool";
import { toApiId } from "../../database/id";
import type {
  StructuredSummary,
  SummaryLength,
  SummaryStatus,
  SummaryStrategy,
  SummaryStyle,
} from "./summarizer.types";

export type DocumentSummaryRecord = {
  id: string;
  document_name: string;
  file_type: "pdf" | "txt" | "md";
  file_size_bytes: string;
  content_hash: string;
  status: SummaryStatus;
  summary_length: SummaryLength;
  summary_style: SummaryStyle;
  strategy: SummaryStrategy;
  chunk_count: number;
  page_count: number | null;
  model_id: string | null;
  duration_ms: number | null;
  summary_json: StructuredSummary | null;
  warnings: string[];
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
};

type Row = {
  id: string | number | bigint;
  document_name: string;
  file_type: "pdf" | "txt" | "md";
  file_size_bytes: string | number | bigint;
  content_hash: string;
  status: SummaryStatus;
  summary_length: SummaryLength;
  summary_style: SummaryStyle;
  strategy: SummaryStrategy;
  chunk_count: number;
  page_count: number | null;
  model_id: string | null;
  duration_ms: number | null;
  summary_json: StructuredSummary | null;
  warnings: string[] | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
};

function mapRow(row: Row): DocumentSummaryRecord {
  return {
    id: toApiId(row.id),
    document_name: row.document_name,
    file_type: row.file_type,
    file_size_bytes: toApiId(row.file_size_bytes),
    content_hash: row.content_hash,
    status: row.status,
    summary_length: row.summary_length,
    summary_style: row.summary_style,
    strategy: row.strategy,
    chunk_count: row.chunk_count,
    page_count: row.page_count,
    model_id: row.model_id,
    duration_ms: row.duration_ms,
    summary_json: row.summary_json,
    warnings: Array.isArray(row.warnings) ? row.warnings : [],
    error_message: row.error_message,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function createSummary(input: {
  documentName: string;
  fileType: "pdf" | "txt" | "md";
  fileSizeBytes: number;
  contentHash: string;
  length: SummaryLength;
  style: SummaryStyle;
  strategy: SummaryStrategy;
  userId: string;
}): Promise<DocumentSummaryRecord> {
  const result = await pool.query<Row>(
    `
      INSERT INTO document_summaries (
        document_name,
        file_type,
        file_size_bytes,
        content_hash,
        status,
        summary_length,
        summary_style,
        strategy,
        user_id
      )
      VALUES ($1,$2,$3,$4,'processing',$5,$6,$7,$8)
      RETURNING *
    `,
    [
      input.documentName.slice(0, 260),
      input.fileType,
      input.fileSizeBytes,
      input.contentHash,
      input.length,
      input.style,
      input.strategy,
      input.userId,
    ],
  );
  return mapRow(result.rows[0]);
}

export async function completeSummary(
  id: string,
  input: {
    summary: StructuredSummary;
    chunkCount: number;
    pageCount: number | null;
    modelId: string | null;
    durationMs: number;
    warnings: string[];
    strategy: SummaryStrategy;
  },
): Promise<DocumentSummaryRecord | null> {
  const result = await pool.query<Row>(
    `
      UPDATE document_summaries
      SET
        status = 'completed',
        summary_json = $2::jsonb,
        chunk_count = $3,
        page_count = $4,
        model_id = $5,
        duration_ms = $6,
        warnings = $7::jsonb,
        strategy = $8,
        error_message = NULL,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      id,
      JSON.stringify(input.summary),
      input.chunkCount,
      input.pageCount,
      input.modelId,
      input.durationMs,
      JSON.stringify(input.warnings),
      input.strategy,
    ],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function failSummary(
  id: string,
  input: { errorMessage: string; durationMs: number },
): Promise<void> {
  await pool.query(
    `
      UPDATE document_summaries
      SET
        status = 'failed',
        error_message = $2,
        duration_ms = $3,
        updated_at = NOW()
      WHERE id = $1
    `,
    [id, input.errorMessage.slice(0, 1000), input.durationMs],
  );
}

export async function getSummaryById(
  id: string,
  userId: string,
): Promise<DocumentSummaryRecord | null> {
  const result = await pool.query<Row>(
    `SELECT * FROM document_summaries WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function listSummaries(input: {
  limit: number;
  offset: number;
  userId: string;
}): Promise<{ summaries: DocumentSummaryRecord[]; total: number }> {
  const count = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM document_summaries WHERE user_id = $1`,
    [input.userId],
  );
  const result = await pool.query<Row>(
    `
      SELECT *
      FROM document_summaries
      WHERE user_id = $1
      ORDER BY updated_at DESC, id DESC
      LIMIT $2 OFFSET $3
    `,
    [input.userId, input.limit, input.offset],
  );
  return {
    summaries: result.rows.map(mapRow),
    total: Number(count.rows[0]?.count ?? 0),
  };
}

export async function deleteSummary(id: string, userId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM document_summaries WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return (result.rowCount ?? 0) > 0;
}
