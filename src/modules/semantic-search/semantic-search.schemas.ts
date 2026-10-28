import { z } from "zod";
import { NUMERIC_ID_PATTERN } from "../../database/id";

export const numericIdSchema = z
  .string()
  .regex(NUMERIC_ID_PATTERN, "ID must be a decimal numeric string");

export const listDocumentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const searchQuerySchema = z.object({
  query: z
    .string({ required_error: "query is required" })
    .trim()
    .min(1, "query cannot be empty")
    .max(2000, "query is too long"),
  limit: z.coerce.number().int().min(1).max(10).optional().default(5),
  documentIds: z.array(numericIdSchema).max(50).optional().default([]),
});
