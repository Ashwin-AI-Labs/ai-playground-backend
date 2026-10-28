import type { Migration } from "../types";

/**
 * Multi-user authentication foundation:
 * - users
 * - email_verification_challenges (hashed OTPs)
 * - refresh_sessions (hashed refresh tokens + family revocation)
 * - nullable user_id ownership on root AI feature tables
 *
 * Legacy rows keep user_id NULL and remain inaccessible to normal accounts.
 */
export const migration: Migration = {
  version: "0012",
  name: "create_users_and_ownership",
  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
        gender TEXT NULL
          CHECK (
            gender IS NULL
            OR gender IN ('female', 'male', 'non_binary', 'prefer_not_to_say', 'other')
          ),
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        email_verified_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT users_email_unique UNIQUE (email)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS users_email_verified_at_idx
      ON users (email_verified_at)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS email_verification_challenges (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        otp_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
        consumed_at TIMESTAMPTZ NULL,
        last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS email_verification_challenges_user_id_idx
      ON email_verification_challenges (user_id, created_at DESC)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS refresh_sessions (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        family_id UUID NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ NULL,
        replaced_by_id BIGINT NULL REFERENCES refresh_sessions(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMPTZ NULL,
        user_agent TEXT NULL,
        ip_address TEXT NULL,
        CONSTRAINT refresh_sessions_token_hash_unique UNIQUE (token_hash)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS refresh_sessions_user_id_idx
      ON refresh_sessions (user_id)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS refresh_sessions_family_id_idx
      ON refresh_sessions (family_id)
    `);

    const ownershipTables = [
      "conversations",
      "tasks",
      "search_documents",
      "rag_sessions",
      "research_sessions",
      "document_summaries",
    ] as const;

    for (const table of ownershipTables) {
      await client.query(`
        ALTER TABLE ${table}
        ADD COLUMN IF NOT EXISTS user_id BIGINT NULL REFERENCES users(id) ON DELETE CASCADE
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS ${table}_user_id_idx
        ON ${table} (user_id)
      `);
    }

    // Per-user completed-document dedupe (legacy global unique index removed).
    await client.query(`
      DROP INDEX IF EXISTS search_documents_content_hash_unique_completed
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS search_documents_user_content_hash_unique_completed
      ON search_documents (user_id, content_hash)
      WHERE status = 'completed' AND user_id IS NOT NULL
    `);
  },
};
