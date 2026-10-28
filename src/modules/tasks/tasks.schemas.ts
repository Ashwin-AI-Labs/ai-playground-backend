import { z } from "zod";
import { NUMERIC_ID_PATTERN } from "../../database/id";

export const numericIdSchema = z
  .string()
  .regex(NUMERIC_ID_PATTERN, "ID must be a decimal numeric string");

export const prioritySchema = z.enum(["low", "medium", "high"]);
export const statusSchema = z.enum(["pending", "in_progress", "completed"]);

const isoDateSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid ISO date");

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  priority: prioritySchema.default("medium"),
  dueDate: isoDateSchema.optional(),
});

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    priority: prioritySchema.optional(),
    status: statusSchema.optional(),
    dueDate: isoDateSchema.nullable().optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    { message: "At least one field is required" },
  );

export const listTasksQuerySchema = z.object({
  status: z.enum(["all", "pending", "in_progress", "completed"]).optional(),
  priority: prioritySchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const confirmDeleteSchema = z.object({
  confirmationToken: z.string().min(10),
});

export const taskAssistantChatSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(8000),
      }),
    )
    .max(20)
    .optional(),
});
