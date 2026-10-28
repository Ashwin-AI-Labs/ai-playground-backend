import { randomUUID } from "crypto";
import { toApiId } from "../../database/id";
import { pool } from "../../database/pool";
import { env } from "../../config/env";

// ─── User types ─────────────────────────────────────────────────────────────

export type UserRecord = {
  id: string;
  name: string;
  gender: string | null;
  email: string;
  password_hash: string;
  email_verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type UserRow = {
  id: string | number | bigint;
  name: string;
  gender: string | null;
  email: string;
  password_hash: string;
  email_verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function mapUser(row: UserRow): UserRecord {
  return {
    id: toApiId(row.id),
    name: row.name,
    gender: row.gender,
    email: row.email,
    password_hash: row.password_hash,
    email_verified_at: row.email_verified_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ─── Challenge types ─────────────────────────────────────────────────────────

export type ChallengeRecord = {
  id: string;
  user_id: string;
  otp_hash: string;
  expires_at: Date;
  attempt_count: number;
  max_attempts: number;
  consumed_at: Date | null;
  last_sent_at: Date;
  created_at: Date;
};

type ChallengeRow = {
  id: string | number | bigint;
  user_id: string | number | bigint;
  otp_hash: string;
  expires_at: Date;
  attempt_count: number;
  max_attempts: number;
  consumed_at: Date | null;
  last_sent_at: Date;
  created_at: Date;
};

function mapChallenge(row: ChallengeRow): ChallengeRecord {
  return {
    id: toApiId(row.id),
    user_id: toApiId(row.user_id),
    otp_hash: row.otp_hash,
    expires_at: row.expires_at,
    attempt_count: row.attempt_count,
    max_attempts: row.max_attempts,
    consumed_at: row.consumed_at,
    last_sent_at: row.last_sent_at,
    created_at: row.created_at,
  };
}

// ─── Refresh session types ────────────────────────────────────────────────────

export type RefreshSessionRecord = {
  id: string;
  user_id: string;
  family_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by_id: string | null;
  created_at: Date;
  last_used_at: Date | null;
  user_agent: string | null;
  ip_address: string | null;
};

type RefreshSessionRow = {
  id: string | number | bigint;
  user_id: string | number | bigint;
  family_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by_id: string | number | bigint | null;
  created_at: Date;
  last_used_at: Date | null;
  user_agent: string | null;
  ip_address: string | null;
};

function mapRefreshSession(row: RefreshSessionRow): RefreshSessionRecord {
  return {
    id: toApiId(row.id),
    user_id: toApiId(row.user_id),
    family_id: row.family_id,
    token_hash: row.token_hash,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    replaced_by_id: row.replaced_by_id ? toApiId(row.replaced_by_id) : null,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    user_agent: row.user_agent,
    ip_address: row.ip_address,
  };
}

// ─── User CRUD ────────────────────────────────────────────────────────────────

export async function findUserByEmail(
  email: string,
): Promise<UserRecord | null> {
  const result = await pool.query<UserRow>(
    `SELECT id, name, gender, email, password_hash, email_verified_at, created_at, updated_at
     FROM users WHERE email = $1`,
    [email],
  );
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

export async function findUserById(userId: string): Promise<UserRecord | null> {
  const result = await pool.query<UserRow>(
    `SELECT id, name, gender, email, password_hash, email_verified_at, created_at, updated_at
     FROM users WHERE id = $1`,
    [userId],
  );
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

export async function createUser(input: {
  name: string;
  gender: string | null;
  email: string;
  passwordHash: string;
}): Promise<UserRecord> {
  const result = await pool.query<UserRow>(
    `INSERT INTO users (name, gender, email, password_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, gender, email, password_hash, email_verified_at, created_at, updated_at`,
    [input.name, input.gender, input.email, input.passwordHash],
  );
  return mapUser(result.rows[0]);
}

export async function updateUserPasswordAndName(
  userId: string,
  input: { name: string; gender: string | null; passwordHash: string },
): Promise<UserRecord | null> {
  const result = await pool.query<UserRow>(
    `UPDATE users
     SET name = $2, gender = $3, password_hash = $4, updated_at = NOW()
     WHERE id = $1
     RETURNING id, name, gender, email, password_hash, email_verified_at, created_at, updated_at`,
    [userId, input.name, input.gender, input.passwordHash],
  );
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

export async function setEmailVerified(userId: string): Promise<void> {
  await pool.query(
    `UPDATE users SET email_verified_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [userId],
  );
}

export async function updateUserName(
  userId: string,
  name: string,
): Promise<UserRecord | null> {
  const result = await pool.query<UserRow>(
    `UPDATE users
     SET name = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING id, name, gender, email, password_hash, email_verified_at, created_at, updated_at`,
    [userId, name],
  );
  return result.rows[0] ? mapUser(result.rows[0]) : null;
}

// ─── Email verification challenges ───────────────────────────────────────────

export async function createChallenge(input: {
  userId: string;
  otpHash: string;
}): Promise<ChallengeRecord> {
  const expiresAt = new Date(
    Date.now() + env.OTP_TTL_SECONDS * 1000,
  ).toISOString();

  const result = await pool.query<ChallengeRow>(
    `INSERT INTO email_verification_challenges
       (user_id, otp_hash, expires_at, max_attempts)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.userId, input.otpHash, expiresAt, env.OTP_MAX_ATTEMPTS],
  );
  return mapChallenge(result.rows[0]);
}

export async function findLatestChallenge(
  userId: string,
): Promise<ChallengeRecord | null> {
  const result = await pool.query<ChallengeRow>(
    `SELECT * FROM email_verification_challenges
     WHERE user_id = $1 AND consumed_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId],
  );
  return result.rows[0] ? mapChallenge(result.rows[0]) : null;
}

export async function incrementChallengeAttempts(
  challengeId: string,
): Promise<void> {
  await pool.query(
    `UPDATE email_verification_challenges
     SET attempt_count = attempt_count + 1
     WHERE id = $1`,
    [challengeId],
  );
}

export async function consumeChallenge(challengeId: string): Promise<void> {
  await pool.query(
    `UPDATE email_verification_challenges
     SET consumed_at = NOW()
     WHERE id = $1`,
    [challengeId],
  );
}

export async function updateChallengeSentAt(
  challengeId: string,
  newOtpHash: string,
): Promise<ChallengeRecord | null> {
  const expiresAt = new Date(
    Date.now() + env.OTP_TTL_SECONDS * 1000,
  ).toISOString();

  const result = await pool.query<ChallengeRow>(
    `UPDATE email_verification_challenges
     SET otp_hash = $2, expires_at = $3, last_sent_at = NOW(), attempt_count = 0
     WHERE id = $1
     RETURNING *`,
    [challengeId, newOtpHash, expiresAt],
  );
  return result.rows[0] ? mapChallenge(result.rows[0]) : null;
}

// ─── Refresh sessions ─────────────────────────────────────────────────────────

export async function createRefreshSession(input: {
  userId: string;
  familyId?: string;
  tokenHash: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<RefreshSessionRecord> {
  const expiresAt = new Date(
    Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const familyId = input.familyId ?? randomUUID();

  const result = await pool.query<RefreshSessionRow>(
    `INSERT INTO refresh_sessions
       (user_id, family_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.userId,
      familyId,
      input.tokenHash,
      expiresAt,
      input.userAgent ?? null,
      input.ipAddress ?? null,
    ],
  );
  return mapRefreshSession(result.rows[0]);
}

export async function findRefreshSessionByHash(
  tokenHash: string,
): Promise<RefreshSessionRecord | null> {
  const result = await pool.query<RefreshSessionRow>(
    `SELECT * FROM refresh_sessions WHERE token_hash = $1`,
    [tokenHash],
  );
  return result.rows[0] ? mapRefreshSession(result.rows[0]) : null;
}

export async function rotateRefreshSession(input: {
  oldSessionId: string;
  newTokenHash: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  familyId: string;
  userId: string;
}): Promise<RefreshSessionRecord> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const expiresAt = new Date(
      Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    const newResult = await client.query<RefreshSessionRow>(
      `INSERT INTO refresh_sessions
         (user_id, family_id, token_hash, expires_at, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.userId,
        input.familyId,
        input.newTokenHash,
        expiresAt,
        input.userAgent ?? null,
        input.ipAddress ?? null,
      ],
    );

    const newSession = mapRefreshSession(newResult.rows[0]);

    await client.query(
      `UPDATE refresh_sessions
       SET revoked_at = NOW(), replaced_by_id = $2, last_used_at = NOW()
       WHERE id = $1`,
      [input.oldSessionId, newSession.id],
    );

    await client.query("COMMIT");
    return newSession;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function revokeFamilySessions(familyId: string): Promise<void> {
  await pool.query(
    `UPDATE refresh_sessions
     SET revoked_at = NOW()
     WHERE family_id = $1 AND revoked_at IS NULL`,
    [familyId],
  );
}

export async function revokeSessionByHash(tokenHash: string): Promise<void> {
  await pool.query(
    `UPDATE refresh_sessions
     SET revoked_at = NOW()
     WHERE token_hash = $1`,
    [tokenHash],
  );
}
