import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth";
import { requireOrigin } from "../../middleware/require-origin";
import {
  getMe,
  login,
  logout,
  refresh,
  register,
  resendOtp,
  updateMe,
  verifyEmail,
} from "./auth.controller";

export const authRouter = Router();

// Public endpoints
authRouter.post("/register", register);
authRouter.post("/verify-email", verifyEmail);
authRouter.post("/resend-otp", resendOtp);
authRouter.post("/login", login);

// Cookie-based endpoints — require Origin check to protect against CSRF
authRouter.post("/refresh", requireOrigin, refresh);
authRouter.post("/logout", requireOrigin, logout);

// Protected endpoints
authRouter.get("/me", requireAuth, getMe);
authRouter.patch("/me", requireAuth, updateMe);
