import type { NextFunction, Request, Response } from "express";
import { AppError } from "./error-handler";
import { verifyAccessToken } from "../modules/auth/auth.tokens";
import { findUserById } from "../modules/auth/auth.repository";

/**
 * Reads the `Authorization: Bearer <token>` header, verifies the JWT,
 * and attaches `req.authUser = { id, email, name }`.
 * Throws 401 if the token is missing or invalid.
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new AppError(401, "Authentication required");
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      throw new AppError(401, "Authentication required");
    }

    const claims = await verifyAccessToken(token);

    // Minimal user load — just enough for req.authUser
    const user = await findUserById(claims.sub);
    if (!user || !user.email_verified_at) {
      throw new AppError(401, "User not found or not verified");
    }

    req.authUser = {
      id: user.id,
      email: user.email,
      name: user.name,
    };

    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }
    // JWT verification errors → 401
    next(new AppError(401, "Invalid or expired token"));
  }
}
