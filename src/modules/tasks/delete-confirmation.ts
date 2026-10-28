import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env";

export type DeleteConfirmationPayload = {
  taskId: string;
  exp: number;
};

function signingSecret(): string {
  return env.TASK_DELETE_SECRET;
}

function encode(payload: DeleteConfirmationPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", signingSecret())
    .update(encodedPayload)
    .digest("base64url");
}

export function createDeleteConfirmationToken(
  taskId: string,
  ttlMs = 10 * 60 * 1000,
): string {
  const payload: DeleteConfirmationPayload = {
    taskId,
    exp: Date.now() + ttlMs,
  };
  const encodedPayload = encode(payload);
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyDeleteConfirmationToken(
  token: string,
  expectedTaskId: string,
): { valid: true } | { valid: false; reason: string } {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return { valid: false, reason: "Malformed confirmation token" };
  }

  const expectedSignature = sign(encodedPayload);
  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    return { valid: false, reason: "Invalid confirmation token signature" };
  }

  let payload: DeleteConfirmationPayload;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as DeleteConfirmationPayload;
  } catch {
    return { valid: false, reason: "Invalid confirmation token payload" };
  }

  if (payload.taskId !== expectedTaskId) {
    return { valid: false, reason: "Confirmation token task mismatch" };
  }

  if (typeof payload.exp !== "number" || Date.now() > payload.exp) {
    return { valid: false, reason: "Confirmation token expired" };
  }

  return { valid: true };
}
