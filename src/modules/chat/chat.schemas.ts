import { z } from "zod";
import { NUMERIC_ID_PATTERN } from "../../database/id";

export const numericIdSchema = z
  .string()
  .regex(NUMERIC_ID_PATTERN, "ID must be a decimal numeric string");

export const sendMessageSchema = z.object({
  message: z
    .string({ required_error: "message is required" })
    .trim()
    .min(1, "message cannot be empty")
    .max(8000, "message is too long"),
  conversationId: numericIdSchema.optional(),
});
