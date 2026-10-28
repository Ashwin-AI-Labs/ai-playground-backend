import type OpenAI from "openai";
import { ZodError } from "zod";
import { AppError } from "../../middleware/error-handler";
import {
  getAiProviderBundle,
  type ToolCallingProvider,
} from "../../services/ai";
import {
  executeTaskTool,
  MAX_TOOL_LOOP_ITERATIONS,
  taskAssistantTools,
  type ToolActionResult,
} from "./task-tools";

export type TaskAssistantHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

export type TaskAssistantResult = {
  reply: string;
  actions: ToolActionResult[];
  pendingDelete: {
    taskId: string;
    confirmationToken: string;
    task: unknown;
  } | null;
  iterations: number;
};

const SYSTEM_INSTRUCTIONS = `You are the AI Playground Task Management Assistant.
You manage real tasks stored in PostgreSQL through registered tools only.

Rules:
- Never invent task IDs, titles, statuses, or success claims.
- Only report outcomes that appear in tool results.
- Use create_task, list_tasks, update_task, and delete_task when needed.
- delete_task never deletes immediately; it returns a confirmation token.
- Tell the user deletion is pending confirmation and they must confirm in the UI.
- Be concise and include real task IDs from tool results (for example, task #12).
- If a tool returns an error, explain it clearly without fabricating a fix.`;

function extractOutputText(response: OpenAI.Responses.Response): string {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const chunks: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== "message") {
      continue;
    }
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && typeof part.text === "string") {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

function collectFunctionCalls(
  response: OpenAI.Responses.Response,
): OpenAI.Responses.ResponseFunctionToolCall[] {
  return (response.output ?? []).filter(
    (item): item is OpenAI.Responses.ResponseFunctionToolCall =>
      item.type === "function_call",
  );
}

function buildInput(
  message: string,
  history: TaskAssistantHistoryItem[],
): OpenAI.Responses.ResponseInput {
  return [
    ...history.slice(-12).map((entry) => ({
      role: entry.role,
      content: entry.content,
    })),
    {
      role: "user" as const,
      content: message,
    },
  ];
}

export function createTaskAssistantService(
  toolsProvider: ToolCallingProvider | null = getAiProviderBundle().tools,
) {
  return {
    async chat(
      message: string,
      history: TaskAssistantHistoryItem[] = [],
    ): Promise<TaskAssistantResult> {
      const trimmed = message.trim();
      if (!trimmed) {
        throw new AppError(400, "Message cannot be empty");
      }

      if (!toolsProvider) {
        throw new AppError(
          503,
          "The configured AI provider does not support tool calling. Set AI_PROVIDER=openai and OPENAI_API_KEY.",
        );
      }

      const actions: ToolActionResult[] = [];
      let pendingDelete: TaskAssistantResult["pendingDelete"] = null;
      let iterations = 0;

      let response = await toolsProvider.createResponse({
        instructions: SYSTEM_INSTRUCTIONS,
        input: buildInput(trimmed, history),
        tools: taskAssistantTools,
      });

      while (iterations < MAX_TOOL_LOOP_ITERATIONS) {
        const functionCalls = collectFunctionCalls(response);
        if (functionCalls.length === 0) {
          const reply = extractOutputText(response);
          if (!reply) {
            throw new AppError(502, "AI provider returned an empty response");
          }
          return { reply, actions, pendingDelete, iterations };
        }

        iterations += 1;
        const toolOutputs: OpenAI.Responses.ResponseInputItem[] = [];

        for (const call of functionCalls) {
          try {
            const executed = await executeTaskTool(call.name, call.arguments);
            actions.push(executed.action);

            if (
              executed.action.ok &&
              executed.action.data &&
              typeof executed.action.data === "object" &&
              executed.action.data !== null &&
              "requiresConfirmation" in executed.action.data &&
              (executed.action.data as { requiresConfirmation?: boolean })
                .requiresConfirmation === true
            ) {
              const data = executed.action.data as {
                confirmationToken?: string;
                task?: { id?: string };
              };
              if (data.confirmationToken && data.task?.id) {
                pendingDelete = {
                  taskId: data.task.id,
                  confirmationToken: data.confirmationToken,
                  task: data.task,
                };
              }
            }

            toolOutputs.push({
              type: "function_call_output",
              call_id: call.call_id,
              output: JSON.stringify(executed.toolResult),
            });
          } catch (error) {
            const detail =
              error instanceof ZodError
                ? error.issues.map((issue) => issue.message).join("; ")
                : error instanceof Error
                  ? error.message
                  : "Tool execution failed";

            actions.push({
              tool: call.name,
              ok: false,
              summary: detail,
            });

            toolOutputs.push({
              type: "function_call_output",
              call_id: call.call_id,
              output: JSON.stringify({ ok: false, error: detail }),
            });
          }
        }

        response = await toolsProvider.createResponse({
          previousResponseId: response.id,
          input: toolOutputs,
          tools: taskAssistantTools,
        });
      }

      throw new AppError(
        502,
        `Tool loop exceeded the safe iteration limit (${MAX_TOOL_LOOP_ITERATIONS}).`,
      );
    },
  };
}

export const taskAssistantService = createTaskAssistantService();
