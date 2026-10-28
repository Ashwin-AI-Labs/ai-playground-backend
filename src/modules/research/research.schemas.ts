import { z } from "zod";
import { NUMERIC_ID_PATTERN } from "../../database/id";

export const numericIdSchema = z
  .string()
  .regex(NUMERIC_ID_PATTERN, "ID must be a decimal numeric string");

export const researchRunSchema = z.object({
  question: z
    .string({ required_error: "question is required" })
    .trim()
    .min(3, "question is too short")
    .max(1000, "question is too long"),
  maxResults: z.coerce.number().int().min(1).max(10).optional(),
  recencyDays: z.coerce.number().int().min(1).max(365).nullable().optional(),
  includeDomains: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
  sessionId: numericIdSchema.nullable().optional(),
});

export const researchSearchSchema = z.object({
  query: z.string().trim().min(2).max(500),
  maxResults: z.coerce.number().int().min(1).max(10).optional(),
});

export const listSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
