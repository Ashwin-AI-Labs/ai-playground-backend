import type OpenAI from "openai";
import { z } from "zod";
import { NUMERIC_ID_PATTERN } from "../../database/id";
import { taskService } from "./tasks.service";

export const MAX_TOOL_LOOP_ITERATIONS = 6;

const prioritySchema = z.enum(["low", "medium", "high"]);
const statusSchema = z.enum(["pending", "in_progress", "completed"]);
const taskIdSchema = z.string().regex(NUMERIC_ID_PATTERN, "taskId must be numeric");
const optionalIsoDate = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid ISO date");

const createTaskArgsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  priority: prioritySchema.default("medium"),
  dueDate: optionalIsoDate.optional(),
});

const listTasksArgsSchema = z.object({
  status: z.enum(["all", "pending", "in_progress", "completed"]).optional(),
  priority: prioritySchema.optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const updateTaskArgsSchema = z
  .object({
    taskId: taskIdSchema,
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    priority: prioritySchema.optional(),
    dueDate: optionalIsoDate.nullable().optional(),
    status: statusSchema.optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.description !== undefined ||
      value.priority !== undefined ||
      value.dueDate !== undefined ||
      value.status !== undefined,
    { message: "At least one updatable field is required" },
  );

const deleteTaskArgsSchema = z.object({
  taskId: taskIdSchema,
});

export const taskAssistantTools: OpenAI.Responses.Tool[] = [
  {
    type: "function",
    name: "create_task",
    description: "Create a new task in PostgreSQL and return the saved record.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: ["low", "medium", "high"] },
        dueDate: { type: "string", description: "ISO 8601 datetime" },
      },
      required: ["title"],
    },
  },
  {
    type: "function",
    name: "list_tasks",
    description: "List real tasks from PostgreSQL with optional filters.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: {
          type: "string",
          enum: ["all", "pending", "in_progress", "completed"],
        },
        priority: { type: "string", enum: ["low", "medium", "high"] },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
    },
  },
  {
    type: "function",
    name: "update_task",
    description: "Update an existing task by ID. Only provided fields change.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        taskId: { type: "string" },
        title: { type: "string" },
        description: { type: ["string", "null"] },
        priority: { type: "string", enum: ["low", "medium", "high"] },
        dueDate: { type: ["string", "null"] },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed"],
        },
      },
      required: ["taskId"],
    },
  },
  {
    type: "function",
    name: "delete_task",
    description:
      "Request deletion of a task. This never deletes immediately; it returns a confirmation token the user must approve.",
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        taskId: { type: "string" },
      },
      required: ["taskId"],
    },
  },
];
export type ToolActionResult = {
  tool: string;
  ok: boolean;
  summary: string;
  data?: unknown;
};

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("Malformed JSON tool arguments");
  }
}

export async function executeTaskTool(
  name: string,
  rawArguments: string,
  userId: string,
): Promise<{ toolResult: Record<string, unknown>; action: ToolActionResult }> {
  switch (name) {
    case "create_task": {
      const args = createTaskArgsSchema.parse(parseArgs(rawArguments));
      const task = await taskService.create({
        title: args.title,
        description: args.description,
        priority: args.priority,
        dueDate: args.dueDate ? new Date(args.dueDate) : null,
        userId,
      });
      return {
        toolResult: { ok: true, task },
        action: {
          tool: name,
          ok: true,
          summary: `Created task #${task.id}: ${task.title}`,
          data: { task },
        },
      };
    }
    case "list_tasks": {
      const args = listTasksArgsSchema.parse(parseArgs(rawArguments));
      const tasks = await taskService.list(userId, {
        status: args.status,
        priority: args.priority,
        limit: args.limit,
      });
      return {
        toolResult: { ok: true, count: tasks.length, tasks },
        action: {
          tool: name,
          ok: true,
          summary: `Listed ${tasks.length} task(s)`,
          data: { tasks },
        },
      };
    }
    case "update_task": {
      const args = updateTaskArgsSchema.parse(parseArgs(rawArguments));
      try {
        const task = await taskService.update(args.taskId, userId, {
          title: args.title,
          description: args.description,
          priority: args.priority,
          status: args.status,
          dueDate:
            args.dueDate === undefined
              ? undefined
              : args.dueDate === null
                ? null
                : new Date(args.dueDate),
        });
        return {
          toolResult: { ok: true, task },
          action: {
            tool: name,
            ok: true,
            summary: `Updated task #${task.id}`,
            data: { task },
          },
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to update task";
        return {
          toolResult: { ok: false, error: message },
          action: {
            tool: name,
            ok: false,
            summary: message,
          },
        };
      }
    }
    case "delete_task": {
      const args = deleteTaskArgsSchema.parse(parseArgs(rawArguments));
      const result = await taskService.requestDelete(args.taskId, userId);
      if (!result.ok) {
        return {
          toolResult: { ok: false, error: result.error },
          action: {
            tool: name,
            ok: false,
            summary: result.error ?? "Task not found",
          },
        };
      }

      return {
        toolResult: {
          ok: true,
          requiresConfirmation: true,
          confirmationToken: result.confirmationToken,
          task: result.task,
          message: result.message,
        },
        action: {
          tool: name,
          ok: true,
          summary: `Delete confirmation required for task #${result.task?.id}`,
          data: {
            requiresConfirmation: true,
            confirmationToken: result.confirmationToken,
            task: result.task,
          },
        },
      };
    }
    default:
      return {
        toolResult: { ok: false, error: `Unknown tool: ${name}` },
        action: {
          tool: name,
          ok: false,
          summary: `Unknown tool: ${name}`,
        },
      };
  }
}
