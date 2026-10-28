import { z } from "zod";
import { NUMERIC_ID_PATTERN } from "../../database/id";

export const numericIdSchema = z
  .string()
  .regex(NUMERIC_ID_PATTERN, "ID must be a decimal numeric string");

export const askSchema = z.object({
  question: z
    .string({ required_error: "question is required" })
    .trim()
    .min(1, "question cannot be empty")
    .max(2000, "question is too long"),
  documentIds: z.array(numericIdSchema).max(50).optional().default([]),
  sessionId: numericIdSchema.nullable().optional(),
  topK: z.coerce.number().int().min(1).max(10).optional(),
});

export const listSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});
