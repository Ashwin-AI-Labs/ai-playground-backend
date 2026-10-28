import { afterAll, describe, expect, it } from "vitest";
import { pool, closePool } from "./pool";
import { applyPendingMigrations } from "./runner";
import { toApiId } from "./id";

const shouldRun = process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.runIf(shouldRun)("database persistence integration", () => {
  afterAll(async () => {
    await closePool();
  });

  it("keeps migrations idempotent and uses sequential bigint IDs", async () => {
    const first = await applyPendingMigrations(pool);
    const second = await applyPendingMigrations(pool);

    expect(second.applied).toEqual([]);
    expect(second.skipped.length).toBeGreaterThan(0);
    expect(first.skipped.length + first.applied.length).toBe(second.skipped.length);

    const conversation = await pool.query<{ id: string }>(
      `INSERT INTO conversations (title)
       VALUES ('integration-test')
       RETURNING id`,
    );
    const conversationId = toApiId(conversation.rows[0].id);
    expect(conversationId).toMatch(/^\d+$/);

    const message = await pool.query<{ id: string; conversation_id: string }>(
      `INSERT INTO messages (conversation_id, role, content)
       VALUES ($1, 'user', 'hello integration')
       RETURNING id, conversation_id`,
      [conversationId],
    );

    expect(toApiId(message.rows[0].id)).toMatch(/^\d+$/);
    expect(toApiId(message.rows[0].conversation_id)).toBe(conversationId);

    await pool.query(`DELETE FROM conversations WHERE id = $1`, [conversationId]);
  });
});
