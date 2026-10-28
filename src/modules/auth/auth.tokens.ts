import { createHash, randomBytes } from "crypto";
import { jwtVerify, SignJWT } from "jose";
import { env } from "../../config/env";

type AccessTokenClaims = {
  sub: string;
  email: string;
  typ: "access";
};

function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(env.JWT_ACCESS_SECRET);
}

export async function createAccessToken(payload: {
  userId: string;
  email: string;
}): Promise<string> {
  const ttl = env.JWT_ACCESS_TTL_SECONDS;
  const now = Math.floor(Date.now() / 1000);

  return new SignJWT({
    email: payload.email,
    typ: "access",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(getSecretKey());
}

export async function verifyAccessToken(
  token: string,
): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, getSecretKey(), {
    algorithms: ["HS256"],
  });

  if (
    typeof payload.sub !== "string" ||
    typeof payload.email !== "string" ||
    payload.typ !== "access"
  ) {
    throw new Error("Invalid access token claims");
  }

  return {
    sub: payload.sub,
    email: payload.email,
    typ: "access",
  };
}

export function createRefreshTokenValue(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
