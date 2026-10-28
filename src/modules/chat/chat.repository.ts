import { toApiId } from "../../database/id";
import { pool } from "../../database/pool";

export type ConversationRecord = {
  id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
};

export type MessageRecord = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: Date;
};

type ConversationRow = {
  id: string | number | bigint;
  title: string;
  created_at: Date;
  updated_at: Date;
};

type MessageRow = {
  id: string | number | bigint;
  conversation_id: string | number | bigint;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: Date;
};

function mapConversation(row: ConversationRow): ConversationRecord {
  return {
    id: toApiId(row.id),
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapMessage(row: MessageRow): MessageRecord {
  return {
    id: toApiId(row.id),
    conversation_id: toApiId(row.conversation_id),
    role: row.role,
    content: row.content,
    created_at: row.created_at,
  };
}

export async function createConversation(title: string): Promise<ConversationRecord> {
  const result = await pool.query<ConversationRow>(
    `INSERT INTO conversations (title)
     VALUES ($1)
     RETURNING id, title, created_at, updated_at`,
    [title],
  );

  return mapConversation(result.rows[0]);
}

export async function getConversationById(
  conversationId: string,
): Promise<ConversationRecord | null> {
  const result = await pool.query<ConversationRow>(
    `SELECT id, title, created_at, updated_at
     FROM conversations
     WHERE id = $1`,
    [conversationId],
  );

  const row = result.rows[0];
  return row ? mapConversation(row) : null;
}

export async function listConversations(limit = 50): Promise<ConversationRecord[]> {
  const result = await pool.query<ConversationRow>(
    `SELECT id, title, created_at, updated_at
     FROM conversations
     ORDER BY updated_at DESC
     LIMIT $1`,
    [limit],
  );

  return result.rows.map(mapConversation);
}

export async function touchConversation(conversationId: string): Promise<void> {
  await pool.query(
    `UPDATE conversations
     SET updated_at = NOW()
     WHERE id = $1`,
    [conversationId],
  );
}

export async function updateConversationTitle(
  conversationId: string,
  title: string,
): Promise<void> {
  await pool.query(
    `UPDATE conversations
     SET title = $2, updated_at = NOW()
     WHERE id = $1`,
    [conversationId, title],
  );
}

export async function addMessage(
  conversationId: string,
  role: MessageRecord["role"],
  content: string,
): Promise<MessageRecord> {
  const result = await pool.query<MessageRow>(
    `INSERT INTO messages (conversation_id, role, content)
     VALUES ($1, $2, $3)
     RETURNING id, conversation_id, role, content, created_at`,
    [conversationId, role, content],
  );

  return mapMessage(result.rows[0]);
}

export async function listMessages(
  conversationId: string,
): Promise<MessageRecord[]> {
  const result = await pool.query<MessageRow>(
    `SELECT id, conversation_id, role, content, created_at
     FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [conversationId],
  );

  return result.rows.map(mapMessage);
}
