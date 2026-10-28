import { z } from "zod";

export const genderEnum = z.enum([
  "female",
  "male",
  "non_binary",
  "prefer_not_to_say",
  "other",
]);

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(120, "Name must be 120 characters or fewer"),
  gender: genderEnum.optional(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Must be a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .refine(
      (val) => /[a-zA-Z]/.test(val) && /\d/.test(val),
      "Password must contain at least one letter and one number",
    ),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Must be a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export const verifyEmailSchema = z.object({
  email: z.string().trim().toLowerCase().email("Must be a valid email address"),
  otp: z
    .string()
    .length(6, "OTP must be exactly 6 digits")
    .regex(/^\d{6}$/, "OTP must be 6 numeric digits"),
});

export const resendOtpSchema = z.object({
  email: z.string().trim().toLowerCase().email("Must be a valid email address"),
});

export const updateNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(120, "Name must be 120 characters or fewer"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendOtpInput = z.infer<typeof resendOtpSchema>;
export type UpdateNameInput = z.infer<typeof updateNameSchema>;
