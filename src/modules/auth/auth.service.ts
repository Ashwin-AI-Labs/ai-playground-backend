import { randomInt } from "crypto";
import { env } from "../../config/env";
import { AppError } from "../../middleware/error-handler";
import { logger } from "../../utils/logger";
import { hashPassword, verifyPassword } from "./auth.password";
import { hashToken } from "./auth.tokens";
import { sendVerificationEmail } from "./auth.mail";
import {
  createChallenge,
  createRefreshSession,
  createUser,
  findLatestChallenge,
  findRefreshSessionByHash,
  findUserByEmail,
  findUserById,
  incrementChallengeAttempts,
  consumeChallenge,
  revokeFamilySessions,
  revokeSessionByHash,
  rotateRefreshSession,
  setEmailVerified,
  updateChallengeSentAt,
  updateUserName,
  updateUserPasswordAndName,
} from "./auth.repository";
import {
  createAccessToken,
  createRefreshTokenValue,
} from "./auth.tokens";
import type { AuthUser } from "./auth.types";

function toAuthUser(user: {
  id: string;
  name: string;
  gender: string | null;
  email: string;
  email_verified_at: Date | null;
}): AuthUser {
  return {
    id: user.id,
    name: user.name,
    gender: user.gender,
    email: user.email,
    emailVerifiedAt: user.email_verified_at
      ? user.email_verified_at.toISOString()
      : null,
  };
}

function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export type RegisterResult = {
  email: string;
  expiresAt: string;
  resendAvailableAt: string;
};

export type VerifyEmailResult = {
  user: AuthUser;
  accessToken: string;
  refreshTokenValue: string;
};

export type LoginResult = {
  user: AuthUser;
  accessToken: string;
  refreshTokenValue: string;
};

export type RefreshResult = {
  user: AuthUser;
  accessToken: string;
  refreshTokenValue: string;
};

export const authService = {
  async register(input: {
    name: string;
    gender?: string | null;
    email: string;
    password: string;
  }): Promise<RegisterResult> {
    const email = input.email.trim().toLowerCase();

    const existing = await findUserByEmail(email);

    if (existing) {
      if (existing.email_verified_at) {
        // Generic error — don't reveal that the email is taken
        throw new AppError(409, "Unable to create account with that email");
      }

      // Unverified user — update credentials and reissue OTP
      const passwordHash = await hashPassword(input.password);
      await updateUserPasswordAndName(existing.id, {
        name: input.name.trim(),
        gender: input.gender ?? null,
        passwordHash,
      });

      const otp = generateOtp();
      const otpHash = hashToken(otp);

      const challenge = await findLatestChallenge(existing.id);

      let expiresAt: Date;
      let lastSentAt: Date;

      if (challenge) {
        const updated = await updateChallengeSentAt(challenge.id, otpHash);
        expiresAt = updated?.expires_at ?? new Date(Date.now() + env.OTP_TTL_SECONDS * 1000);
        lastSentAt = new Date();
      } else {
        const created = await createChallenge({
          userId: existing.id,
          otpHash,
        });
        expiresAt = created.expires_at;
        lastSentAt = created.last_sent_at;
      }

      await sendVerificationEmail(email, input.name.trim(), otp);

      return {
        email,
        expiresAt: expiresAt.toISOString(),
        resendAvailableAt: new Date(
          lastSentAt.getTime() + env.OTP_RESEND_COOLDOWN_SECONDS * 1000,
        ).toISOString(),
      };
    }

    // New user
    const passwordHash = await hashPassword(input.password);
    const user = await createUser({
      name: input.name.trim(),
      gender: input.gender ?? null,
      email,
      passwordHash,
    });

    const otp = generateOtp();
    const otpHash = hashToken(otp);
    const challenge = await createChallenge({ userId: user.id, otpHash });

    await sendVerificationEmail(email, input.name.trim(), otp);

    return {
      email,
      expiresAt: challenge.expires_at.toISOString(),
      resendAvailableAt: new Date(
        challenge.last_sent_at.getTime() +
          env.OTP_RESEND_COOLDOWN_SECONDS * 1000,
      ).toISOString(),
    };
  },

  async verifyEmail(
    input: { email: string; otp: string },
    context: { userAgent?: string; ipAddress?: string },
  ): Promise<VerifyEmailResult> {
    const email = input.email.trim().toLowerCase();
    const user = await findUserByEmail(email);

    if (!user) {
      throw new AppError(400, "Invalid verification code");
    }

    if (user.email_verified_at) {
      throw new AppError(400, "Email is already verified");
    }

    const challenge = await findLatestChallenge(user.id);

    if (!challenge) {
      throw new AppError(400, "No active verification code found");
    }

    if (challenge.attempt_count >= challenge.max_attempts) {
      throw new AppError(
        429,
        "Too many failed attempts. Please register again to get a new code.",
      );
    }

    if (new Date() > challenge.expires_at) {
      throw new AppError(400, "Verification code has expired");
    }

    const providedHash = hashToken(input.otp);
    if (providedHash !== challenge.otp_hash) {
      await incrementChallengeAttempts(challenge.id);
      const remaining =
        challenge.max_attempts - challenge.attempt_count - 1;
      throw new AppError(
        400,
        remaining > 0
          ? `Invalid code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`
          : "Too many failed attempts. Please register again to get a new code.",
      );
    }

    // Consume challenge and mark verified
    await consumeChallenge(challenge.id);
    await setEmailVerified(user.id);

    const [accessToken, refreshTokenValue] = await Promise.all([
      createAccessToken({ userId: user.id, email: user.email }),
      Promise.resolve(createRefreshTokenValue()),
    ]);

    await createRefreshSession({
      userId: user.id,
      tokenHash: hashToken(refreshTokenValue),
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
    });

    logger.info("User verified email", { userId: user.id });

    const freshUser = await findUserById(user.id);
    return {
      user: toAuthUser(freshUser ?? user),
      accessToken,
      refreshTokenValue,
    };
  },

  async resendOtp(input: { email: string }): Promise<RegisterResult> {
    const email = input.email.trim().toLowerCase();
    const user = await findUserByEmail(email);

    // Respond identically whether the email exists or not (prevent enumeration)
    const genericResult = (): RegisterResult => ({
      email,
      expiresAt: new Date(Date.now() + env.OTP_TTL_SECONDS * 1000).toISOString(),
      resendAvailableAt: new Date(
        Date.now() + env.OTP_RESEND_COOLDOWN_SECONDS * 1000,
      ).toISOString(),
    });

    if (!user || user.email_verified_at) {
      return genericResult();
    }

    const challenge = await findLatestChallenge(user.id);

    if (challenge) {
      const cooldownMs = env.OTP_RESEND_COOLDOWN_SECONDS * 1000;
      const nextAllowedAt = new Date(
        challenge.last_sent_at.getTime() + cooldownMs,
      );
      if (new Date() < nextAllowedAt) {
        throw new AppError(
          429,
          `Please wait before requesting a new code. Try again after ${nextAllowedAt.toISOString()}`,
        );
      }
    }

    const otp = generateOtp();
    const otpHash = hashToken(otp);

    let expiresAt: Date;
    let lastSentAt: Date;

    if (challenge) {
      const updated = await updateChallengeSentAt(challenge.id, otpHash);
      expiresAt = updated?.expires_at ?? new Date(Date.now() + env.OTP_TTL_SECONDS * 1000);
      lastSentAt = new Date();
    } else {
      const created = await createChallenge({ userId: user.id, otpHash });
      expiresAt = created.expires_at;
      lastSentAt = created.last_sent_at;
    }

    await sendVerificationEmail(email, user.name, otp);

    return {
      email,
      expiresAt: expiresAt.toISOString(),
      resendAvailableAt: new Date(
        lastSentAt.getTime() + env.OTP_RESEND_COOLDOWN_SECONDS * 1000,
      ).toISOString(),
    };
  },

  async login(
    input: { email: string; password: string },
    context: { userAgent?: string; ipAddress?: string },
  ): Promise<LoginResult> {
    const email = input.email.trim().toLowerCase();
    const GENERIC_ERROR = "Invalid email or password";

    const user = await findUserByEmail(email);

    if (!user) {
      // Constant-time-ish: still hash to avoid timing attacks
      await hashPassword(input.password).catch(() => null);
      throw new AppError(401, GENERIC_ERROR);
    }

    const passwordValid = await verifyPassword(user.password_hash, input.password);

    if (!passwordValid) {
      throw new AppError(401, GENERIC_ERROR);
    }

    if (!user.email_verified_at) {
      throw new AppError(403, "Please verify your email before signing in.");
    }

    const [accessToken, refreshTokenValue] = await Promise.all([
      createAccessToken({ userId: user.id, email: user.email }),
      Promise.resolve(createRefreshTokenValue()),
    ]);

    await createRefreshSession({
      userId: user.id,
      tokenHash: hashToken(refreshTokenValue),
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
    });

    logger.info("User logged in", { userId: user.id });

    return {
      user: toAuthUser(user),
      accessToken,
      refreshTokenValue,
    };
  },

  async refresh(
    input: { refreshTokenValue: string },
    context: { userAgent?: string; ipAddress?: string },
  ): Promise<RefreshResult> {
    const tokenHash = hashToken(input.refreshTokenValue);
    const session = await findRefreshSessionByHash(tokenHash);

    if (!session) {
      throw new AppError(401, "Session not found");
    }

    // Reuse detection: token already used/revoked
    if (session.revoked_at) {
      // Revoke the entire family (token theft)
      await revokeFamilySessions(session.family_id);
      logger.warn("Refresh token reuse detected — family revoked", {
        familyId: session.family_id,
        userId: session.user_id,
      });
      throw new AppError(401, "Session is no longer valid. Please sign in again.");
    }

    if (new Date() > session.expires_at) {
      throw new AppError(401, "Session expired. Please sign in again.");
    }

    const user = await findUserById(session.user_id);
    if (!user || !user.email_verified_at) {
      throw new AppError(401, "User not found or not verified");
    }

    const newRefreshTokenValue = createRefreshTokenValue();
    const newSession = await rotateRefreshSession({
      oldSessionId: session.id,
      newTokenHash: hashToken(newRefreshTokenValue),
      familyId: session.family_id,
      userId: session.user_id,
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
    });

    const accessToken = await createAccessToken({
      userId: user.id,
      email: user.email,
    });

    logger.info("Refresh token rotated", {
      userId: user.id,
      newSessionId: newSession.id,
    });

    return {
      user: toAuthUser(user),
      accessToken,
      refreshTokenValue: newRefreshTokenValue,
    };
  },

  async logout(input: { refreshTokenValue?: string }): Promise<void> {
    if (input.refreshTokenValue) {
      const tokenHash = hashToken(input.refreshTokenValue);
      await revokeSessionByHash(tokenHash);
    }
  },

  async getMe(userId: string): Promise<AuthUser> {
    const user = await findUserById(userId);
    if (!user) {
      throw new AppError(401, "User not found");
    }
    return toAuthUser(user);
  },

  async updateName(userId: string, name: string): Promise<AuthUser> {
    const user = await updateUserName(userId, name.trim());
    if (!user) {
      throw new AppError(404, "User not found");
    }
    return toAuthUser(user);
  },
};
