import type { CookieOptions, NextFunction, Request, Response } from "express";
import { env } from "../../config/env";
import { AppError } from "../../middleware/error-handler";
import {
  loginSchema,
  registerSchema,
  resendOtpSchema,
  updateNameSchema,
  verifyEmailSchema,
} from "./auth.schemas";
import { authService } from "./auth.service";
import { isRateLimited } from "./auth.rate-limit";

// ─── Cookie helpers ───────────────────────────────────────────────────────────

function refreshCookieOptions(): CookieOptions {
  const ttlMs = env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE as CookieOptions["sameSite"],
    path: "/api/auth",
    maxAge: ttlMs,
  };
}

export function setRefreshCookie(res: Response, tokenValue: string): void {
  res.cookie(env.REFRESH_COOKIE_NAME, tokenValue, refreshCookieOptions());
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(env.REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE as CookieOptions["sameSite"],
    path: "/api/auth",
  });
}

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress ?? "unknown";
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function register(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ip = getClientIp(req);
    if (isRateLimited(ip, "register")) {
      throw new AppError(429, "Too many registration attempts. Try again later.");
    }

    const body = registerSchema.parse(req.body);
    const result = await authService.register(body);

    res.status(201).json({
      success: true,
      message: "Check your email for your verification code.",
      email: result.email,
      expiresAt: result.expiresAt,
      resendAvailableAt: result.resendAvailableAt,
    });
  } catch (error) {
    next(error);
  }
}

export async function verifyEmail(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ip = getClientIp(req);
    if (isRateLimited(ip, "verify-email")) {
      throw new AppError(429, "Too many verification attempts. Try again later.");
    }

    const body = verifyEmailSchema.parse(req.body);
    const result = await authService.verifyEmail(body, {
      userAgent: req.headers["user-agent"],
      ipAddress: ip,
    });

    setRefreshCookie(res, result.refreshTokenValue);

    res.json({
      success: true,
      user: result.user,
      accessToken: result.accessToken,
    });
  } catch (error) {
    next(error);
  }
}

export async function resendOtp(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ip = getClientIp(req);
    if (isRateLimited(ip, "resend-otp")) {
      throw new AppError(429, "Too many requests. Try again later.");
    }

    const body = resendOtpSchema.parse(req.body);
    const result = await authService.resendOtp(body);

    res.json({
      success: true,
      message: "If that email is pending verification, a new code has been sent.",
      email: result.email,
      expiresAt: result.expiresAt,
      resendAvailableAt: result.resendAvailableAt,
    });
  } catch (error) {
    next(error);
  }
}

export async function login(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ip = getClientIp(req);
    if (isRateLimited(ip, "login")) {
      throw new AppError(429, "Too many login attempts. Try again later.");
    }

    const body = loginSchema.parse(req.body);
    const result = await authService.login(body, {
      userAgent: req.headers["user-agent"],
      ipAddress: ip,
    });

    setRefreshCookie(res, result.refreshTokenValue);

    res.json({
      success: true,
      user: result.user,
      accessToken: result.accessToken,
    });
  } catch (error) {
    next(error);
  }
}

export async function refresh(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ip = getClientIp(req);
    const tokenValue: string | undefined = req.cookies?.[env.REFRESH_COOKIE_NAME];

    if (!tokenValue) {
      throw new AppError(401, "No refresh token");
    }

    const result = await authService.refresh(
      { refreshTokenValue: tokenValue },
      { userAgent: req.headers["user-agent"], ipAddress: ip },
    );

    setRefreshCookie(res, result.refreshTokenValue);

    res.json({
      success: true,
      user: result.user,
      accessToken: result.accessToken,
    });
  } catch (error) {
    next(error);
  }
}

export async function logout(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const tokenValue: string | undefined = req.cookies?.[env.REFRESH_COOKIE_NAME];
    await authService.logout({ refreshTokenValue: tokenValue });
    clearRefreshCookie(res);
    res.json({ success: true, message: "Logged out" });
  } catch (error) {
    next(error);
  }
}

export async function getMe(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await authService.getMe(req.authUser!.id);
    res.json({ success: true, user });
  } catch (error) {
    next(error);
  }
}

export async function updateMe(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = updateNameSchema.parse(req.body);
    const user = await authService.updateName(req.authUser!.id, body.name);
    res.json({ success: true, user });
  } catch (error) {
    next(error);
  }
}
