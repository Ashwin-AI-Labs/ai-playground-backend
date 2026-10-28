import { pool } from "../../database/pool";
import { toApiId } from "../../database/id";
import type { RagCitationDto } from "./rag.types";

export type RagSessionRecord = {
  id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
};

export type RagMessageRecord = {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  insufficient_evidence: boolean;
  created_at: Date;
};

type SessionRow = {
  id: string | number | bigint;
  title: string;
  created_at: Date;
  updated_at: Date;
};

type MessageRow = {
  id: string | number | bigint;
  session_id: string | number | bigint;
  role: "user" | "assistant";
  content: string;
  insufficient_evidence: boolean;
  created_at: Date;
};

function mapSession(row: SessionRow): RagSessionRecord {
  return {
    id: toApiId(row.id),
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapMessage(row: MessageRow): RagMessageRecord {
  return {
    id: toApiId(row.id),
    session_id: toApiId(row.session_id),
    role: row.role,
    content: row.content,
    insufficient_evidence: row.insufficient_evidence,
    created_at: row.created_at,
  };
}

export async function createSession(title: string): Promise<RagSessionRecord> {
  const result = await pool.query<SessionRow>(
    `
      INSERT INTO rag_sessions (title)
      VALUES ($1)
      RETURNING *
    `,
    [title.slice(0, 120)],
  );
  return mapSession(result.rows[0]);
}

export async function getSessionById(
  sessionId: string,
): Promise<RagSessionRecord | null> {
  const result = await pool.query<SessionRow>(
    `SELECT * FROM rag_sessions WHERE id = $1`,
    [sessionId],
  );
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

export async function touchSession(sessionId: string): Promise<void> {
  await pool.query(
    `UPDATE rag_sessions SET updated_at = NOW() WHERE id = $1`,
    [sessionId],
  );
}

export async function listSessions(limit: number): Promise<RagSessionRecord[]> {
  const result = await pool.query<SessionRow>(
    `
      SELECT *
      FROM rag_sessions
      ORDER BY updated_at DESC, id DESC
      LIMIT $1
    `,
    [limit],
  );
  return result.rows.map(mapSession);
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  const result = await pool.query(`DELETE FROM rag_sessions WHERE id = $1`, [
    sessionId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

export async function addMessage(input: {
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  insufficientEvidence?: boolean;
}): Promise<RagMessageRecord> {
  const result = await pool.query<MessageRow>(
    `
      INSERT INTO rag_messages (
        session_id,
        role,
        content,
        insufficient_evidence
      )
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `,
    [
      input.sessionId,
      input.role,
      input.content,
      input.insufficientEvidence ?? false,
    ],
  );
  await touchSession(input.sessionId);
  return mapMessage(result.rows[0]);
}

export async function insertCitations(
  messageId: string,
  citations: RagCitationDto[],
): Promise<void> {
  for (const citation of citations) {
    await pool.query(
      `
        INSERT INTO rag_message_citations (
          message_id,
          citation_number,
          document_id,
          chunk_id,
          filename,
          page_number,
          excerpt,
          similarity
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        messageId,
        citation.id,
        citation.documentId,
        citation.chunkId,
        citation.filename,
        citation.pageNumber,
        citation.excerpt,
        citation.similarity,
      ],
    );
  }
}

export async function listMessages(
  sessionId: string,
): Promise<RagMessageRecord[]> {
  const result = await pool.query<MessageRow>(
    `
      SELECT *
      FROM rag_messages
      WHERE session_id = $1
      ORDER BY id ASC
    `,
    [sessionId],
  );
  return result.rows.map(mapMessage);
}

export async function listCitationsForMessages(
  messageIds: string[],
): Promise<
  Array<{
    message_id: string;
    citation: RagCitationDto;
  }>
> {
  if (messageIds.length === 0) {
    return [];
  }

  const result = await pool.query<{
    message_id: string | number | bigint;
    citation_number: number;
    document_id: string | number | bigint;
    chunk_id: string | number | bigint;
    filename: string;
    page_number: number | null;
    excerpt: string;
    similarity: number | null;
  }>(
    `
      SELECT *
      FROM rag_message_citations
      WHERE message_id = ANY($1::bigint[])
      ORDER BY message_id ASC, citation_number ASC
    `,
    [messageIds],
  );

  return result.rows.map((row) => ({
    message_id: toApiId(row.message_id),
    citation: {
      id: row.citation_number,
      documentId: toApiId(row.document_id),
      filename: row.filename,
      chunkId: toApiId(row.chunk_id),
      pageNumber: row.page_number,
      pageEnd: row.page_number,
      pageAvailable: row.page_number !== null,
      excerpt: row.excerpt,
      similarity: row.similarity ?? 0,
    },
  }));
}

export async function listRecentHistory(
  sessionId: string,
  limit = 6,
): Promise<Array<{ role: "user" | "assistant"; content: string }>> {
  const result = await pool.query<MessageRow>(
    `
      SELECT *
      FROM rag_messages
      WHERE session_id = $1
      ORDER BY id DESC
      LIMIT $2
    `,
    [sessionId, limit],
  );

  return result.rows
    .map(mapMessage)
    .reverse()
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));
}

export async function countCompletedDocuments(
  documentIds?: string[],
): Promise<number> {
  if (documentIds && documentIds.length > 0) {
    const result = await pool.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM search_documents
        WHERE status = 'completed' AND id = ANY($1::bigint[])
      `,
      [documentIds],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM search_documents WHERE status = 'completed'`,
  );
  return Number(result.rows[0]?.count ?? 0);
}
