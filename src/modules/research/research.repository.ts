import { pool } from "../../database/pool";
import { toApiId } from "../../database/id";
import type {
  ResearchReport,
  ResearchSourceDto,
  ResearchStatus,
} from "./research.types";

export type ResearchSessionRecord = {
  id: string;
  title: string;
  question: string;
  status: ResearchStatus;
  report: ResearchReport | null;
  insufficient_evidence: boolean;
  error_message: string | null;
  duration_ms: number | null;
  search_query_count: number;
  search_queries: string[];
  source_count: number;
  created_at: Date;
  updated_at: Date;
};

type SessionRow = {
  id: string | number | bigint;
  title: string;
  question: string;
  status: ResearchStatus;
  report: ResearchReport | null;
  insufficient_evidence: boolean;
  error_message: string | null;
  duration_ms: number | null;
  search_query_count: number;
  search_queries?: string[] | null;
  source_count: number;
  created_at: Date;
  updated_at: Date;
};

type SourceRow = {
  id: string | number | bigint;
  source_number: number;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  excerpt: string;
  published_at: string | null;
  retrieved_at: Date;
  fetch_status: ResearchSourceDto["fetchStatus"];
  provider: string;
};

function mapSession(row: SessionRow): ResearchSessionRecord {
  return {
    id: toApiId(row.id),
    title: row.title,
    question: row.question,
    status: row.status,
    report: row.report,
    insufficient_evidence: row.insufficient_evidence,
    error_message: row.error_message,
    duration_ms: row.duration_ms,
    search_query_count: row.search_query_count,
    search_queries: Array.isArray(row.search_queries) ? row.search_queries : [],
    source_count: row.source_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function createSession(input: {
  title: string;
  question: string;
  userId: string;
}): Promise<ResearchSessionRecord> {
  const result = await pool.query<SessionRow>(
    `
      INSERT INTO research_sessions (title, question, status, user_id)
      VALUES ($1, $2, 'running', $3)
      RETURNING *
    `,
    [input.title.slice(0, 120), input.question, input.userId],
  );
  return mapSession(result.rows[0]);
}

export async function getSessionById(
  sessionId: string,
  userId: string,
): Promise<ResearchSessionRecord | null> {
  const result = await pool.query<SessionRow>(
    `SELECT * FROM research_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId],
  );
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

export async function updateSession(
  sessionId: string,
  input: {
    status: ResearchStatus;
    report?: ResearchReport | null;
    insufficientEvidence?: boolean;
    errorMessage?: string | null;
    durationMs?: number | null;
    searchQueryCount?: number;
    searchQueries?: string[];
    sourceCount?: number;
  },
): Promise<ResearchSessionRecord | null> {
  const result = await pool.query<SessionRow>(
    `
      UPDATE research_sessions
      SET
        status = $2,
        report = COALESCE($3::jsonb, report),
        insufficient_evidence = COALESCE($4, insufficient_evidence),
        error_message = $5,
        duration_ms = COALESCE($6, duration_ms),
        search_query_count = COALESCE($7, search_query_count),
        search_queries = COALESCE($8::jsonb, search_queries),
        source_count = COALESCE($9, source_count),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      sessionId,
      input.status,
      input.report ? JSON.stringify(input.report) : null,
      input.insufficientEvidence ?? null,
      input.errorMessage ?? null,
      input.durationMs ?? null,
      input.searchQueryCount ?? null,
      input.searchQueries ? JSON.stringify(input.searchQueries) : null,
      input.sourceCount ?? null,
    ],
  );
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

export async function replaceSources(
  sessionId: string,
  sources: ResearchSourceDto[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM research_sources WHERE session_id = $1`, [
      sessionId,
    ]);
    for (const source of sources) {
      await client.query(
        `
          INSERT INTO research_sources (
            session_id,
            source_number,
            title,
            url,
            domain,
            snippet,
            excerpt,
            published_at,
            retrieved_at,
            fetch_status,
            provider
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        `,
        [
          sessionId,
          source.id,
          source.title,
          source.url,
          source.domain,
          source.snippet,
          source.excerpt,
          source.publishedAt,
          source.retrievedAt,
          source.fetchStatus,
          source.provider,
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

export async function listSources(
  sessionId: string,
): Promise<ResearchSourceDto[]> {
  const result = await pool.query<SourceRow>(
    `
      SELECT *
      FROM research_sources
      WHERE session_id = $1
      ORDER BY source_number ASC
    `,
    [sessionId],
  );

  return result.rows.map((row) => ({
    id: row.source_number,
    title: row.title,
    url: row.url,
    domain: row.domain,
    snippet: row.snippet,
    excerpt: row.excerpt,
    publishedAt: row.published_at,
    retrievedAt: row.retrieved_at.toISOString(),
    fetchStatus: row.fetch_status,
    provider: row.provider,
  }));
}

export async function listSessions(input: {
  limit: number;
  offset: number;
  userId: string;
}): Promise<{ sessions: ResearchSessionRecord[]; total: number }> {
  const count = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM research_sessions WHERE user_id = $1`,
    [input.userId],
  );
  const result = await pool.query<SessionRow>(
    `
      SELECT *
      FROM research_sessions
      WHERE user_id = $1
      ORDER BY updated_at DESC, id DESC
      LIMIT $2 OFFSET $3
    `,
    [input.userId, input.limit, input.offset],
  );
  return {
    sessions: result.rows.map(mapSession),
    total: Number(count.rows[0]?.count ?? 0),
  };
}

export async function deleteSession(
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM research_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}
