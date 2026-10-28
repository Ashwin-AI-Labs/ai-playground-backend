import { beforeEach, describe, expect, it, vi } from "vitest";

const taskServiceMock = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  requestDelete: vi.fn(),
}));

vi.mock("./tasks.service", () => ({
  taskService: taskServiceMock,
}));

import { AppError } from "../../middleware/error-handler";
import type { ToolCallingProvider } from "../../services/ai";
import { executeTaskTool, MAX_TOOL_LOOP_ITERATIONS } from "./task-tools";
import { createTaskAssistantService } from "./task-assistant.service";

function mockToolsProvider(
  createResponse: ToolCallingProvider["createResponse"],
): ToolCallingProvider {
  return {
    name: "mock",
    supportsToolCalling: true,
    createResponse,
  };
}

describe("executeTaskTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a task with valid arguments", async () => {
    taskServiceMock.create.mockResolvedValue({
      id: "1",
      title: "Prepare demo",
      description: null,
      priority: "high",
      status: "pending",
      dueDate: null,
      createdAt: "2026-10-26T00:00:00.000Z",
      updatedAt: "2026-10-26T00:00:00.000Z",
    });

    const result = await executeTaskTool(
      "create_task",
      JSON.stringify({ title: "Prepare demo", priority: "high" }),
    );

    expect(result.action.ok).toBe(true);
    expect(result.toolResult).toMatchObject({
      ok: true,
      task: { id: "1", title: "Prepare demo" },
    });
  });

  it("rejects invalid create_task arguments", async () => {
    await expect(
      executeTaskTool("create_task", JSON.stringify({ title: "" })),
    ).rejects.toThrow();
  });

  it("lists tasks through the allowlisted tool", async () => {
    taskServiceMock.list.mockResolvedValue([
      { id: "1", title: "A", status: "pending" },
    ]);
    const result = await executeTaskTool(
      "list_tasks",
      JSON.stringify({ status: "pending" }),
    );
    expect(result.action.ok).toBe(true);
    expect(result.toolResult).toMatchObject({ ok: true, count: 1 });
  });

  it("updates a task", async () => {
    taskServiceMock.update.mockResolvedValue({
      id: "1",
      title: "Prepare demo",
      status: "completed",
    });
    const result = await executeTaskTool(
      "update_task",
      JSON.stringify({ taskId: "1", status: "completed" }),
    );
    expect(result.action.ok).toBe(true);
  });

  it("returns not-found style failure for update errors", async () => {
    taskServiceMock.update.mockRejectedValue(
      new AppError(404, "Task not found"),
    );
    const result = await executeTaskTool(
      "update_task",
      JSON.stringify({ taskId: "99", status: "completed" }),
    );
    expect(result.action.ok).toBe(false);
    expect(result.toolResult).toMatchObject({
      ok: false,
      error: "Task not found",
    });
  });

  it("requires confirmation for delete_task and never deletes immediately", async () => {
    taskServiceMock.requestDelete.mockResolvedValue({
      ok: true,
      requiresConfirmation: true,
      confirmationToken: "token",
      task: { id: "1", title: "Prepare demo" },
      message: "needs confirmation",
    });

    const result = await executeTaskTool(
      "delete_task",
      JSON.stringify({ taskId: "1" }),
    );

    expect(result.toolResult).toMatchObject({
      ok: true,
      requiresConfirmation: true,
      confirmationToken: "token",
    });
  });

  it("rejects unknown tools", async () => {
    const result = await executeTaskTool("drop_database", "{}");
    expect(result.action.ok).toBe(false);
    expect(result.toolResult).toMatchObject({ ok: false });
  });

  it("rejects malformed JSON arguments", async () => {
    await expect(executeTaskTool("create_task", "{bad")).rejects.toThrow(
      /Malformed JSON/,
    );
  });
});

describe("task assistant tool loop", () => {
  it("stops when the iteration limit is exceeded", async () => {
    const createResponse = vi.fn().mockResolvedValue({
      id: "resp_1",
      output_text: "",
      output: [
        {
          type: "function_call",
          call_id: "call_1",
          name: "list_tasks",
          arguments: "{}",
        },
      ],
    });

    taskServiceMock.list.mockResolvedValue([]);

    const service = createTaskAssistantService(
      mockToolsProvider(createResponse),
    );

    await expect(service.chat("list my tasks")).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringContaining(String(MAX_TOOL_LOOP_ITERATIONS)),
    });

    expect(createResponse.mock.calls.length).toBeGreaterThan(
      MAX_TOOL_LOOP_ITERATIONS,
    );
  });

  it("returns the final assistant reply after mocked tool calls", async () => {
    const createResponse = vi
      .fn()
      .mockResolvedValueOnce({
        id: "resp_1",
        output_text: "",
        output: [
          {
            type: "function_call",
            call_id: "call_1",
            name: "create_task",
            arguments: JSON.stringify({
              title: "Prepare demo",
              priority: "high",
            }),
          },
        ],
      })
      .mockResolvedValueOnce({
        id: "resp_2",
        output_text: "Created task #1: Prepare demo. Priority: High.",
        output: [],
      });

    taskServiceMock.create.mockResolvedValue({
      id: "1",
      title: "Prepare demo",
      priority: "high",
      status: "pending",
    });

    const service = createTaskAssistantService(
      mockToolsProvider(createResponse),
    );

    const result = await service.chat(
      "Create a task called Prepare demo with high priority.",
    );

    expect(result.reply).toContain("Created task #1");
    expect(result.actions[0]?.ok).toBe(true);
    expect(result.iterations).toBe(1);
  });
});
