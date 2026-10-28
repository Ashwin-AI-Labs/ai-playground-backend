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
  version: "0002",
  name: "create_chat_conversations",
  async up(client) {
    const exists = await tableExists(client, "conversations");

    if (!exists) {
      await client.query(`
        CREATE TABLE conversations (
          id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          title TEXT NOT NULL DEFAULT 'New chat',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX conversations_updated_at_idx
          ON conversations (updated_at DESC);
      `);
      return;
    }

    const idType = await columnDataType(client, "conversations", "id");
    if (idType === "uuid" || idType === "bigint") {
      await client.query(`
        CREATE INDEX IF NOT EXISTS conversations_updated_at_idx
          ON conversations (updated_at DESC);
      `);
      return;
    }

    throw new Error(
      `Migration 0002: conversations exists with unsupported id type "${idType}". Expected uuid (legacy) or bigint.`,
    );
  },
};
