import type { PoolClient } from "pg";
import type { Migration } from "../types";

async function tableExists(client: PoolClient, tableName: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName],
  );
  return result.rows[0]?.exists === true;
}

async function columnDataType(
  client: PoolClient,
  tableName: string,
  columnName: string,
): Promise<string | null> {
  const result = await client.query<{ data_type: string }>(
    `SELECT data_type
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = $2`,
    [tableName, columnName],
  );
  return result.rows[0]?.data_type ?? null;
}

export const migration: Migration = {
  version: "0003",
  name: "create_chat_messages",
  async up(client) {
    const conversationsExists = await tableExists(client, "conversations");
    if (!conversationsExists) {
      throw new Error(
        "Migration 0003: conversations table is missing. Apply 0002 first.",
      );
    }

    const exists = await tableExists(client, "messages");

    if (!exists) {
      const conversationIdType = await columnDataType(client, "conversations", "id");

      if (conversationIdType === "bigint") {
        await client.query(`
          CREATE TABLE messages (
            id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
            content TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE INDEX messages_conversation_id_created_at_idx
            ON messages (conversation_id, created_at);
        `);
        return;
      }

      if (conversationIdType === "uuid") {
        // Legacy bridge: keep UUID FKs until 0004 standardizes application IDs.
        await client.query(`
          CREATE TABLE messages (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
            content TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );

          CREATE INDEX messages_conversation_id_created_at_idx
            ON messages (conversation_id, created_at);
        `);
        return;
      }

      throw new Error(
        `Migration 0003: unsupported conversations.id type "${conversationIdType}" when creating messages.`,
      );
    }

    const idType = await columnDataType(client, "messages", "id");
    const conversationIdType = await columnDataType(client, "messages", "conversation_id");

    const compatible =
      (idType === "uuid" && conversationIdType === "uuid") ||
      (idType === "bigint" && conversationIdType === "bigint");

    if (!compatible) {
      throw new Error(
        `Migration 0003: messages exists with unsupported types id=${idType}, conversation_id=${conversationIdType}.`,
      );
    }

    await client.query(`
      CREATE INDEX IF NOT EXISTS messages_conversation_id_created_at_idx
        ON messages (conversation_id, created_at);
    `);
  },
};
