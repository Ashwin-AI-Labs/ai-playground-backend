import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { AppError } from "./error-handler";

/**
 * Allows the request if:
 *  - No `Origin` header is present (same-site / server-to-server)
 *  - The `Origin` matches FRONTEND_URL exactly
 *
 * Use on cookie-based endpoints (refresh, logout) to defend against
 * cross-site request forgery from unknown origins.
 */
export function requireOrigin(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const origin = req.headers.origin;
  if (!origin) {
    // No origin header — same-site or non-browser caller; allow
    return next();
  }

  // Normalise trailing slash for comparison
  const normalise = (url: string) => url.replace(/\/$/, "");
  if (normalise(origin) === normalise(env.FRONTEND_URL)) {
    return next();
  }

  next(new AppError(403, "Origin not allowed"));
}
