import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  createConversation: vi.fn(),
  getConversationById: vi.fn(),
  listConversations: vi.fn(),
  listMessages: vi.fn(),
  addMessage: vi.fn(),
  touchConversation: vi.fn(),
  updateConversationTitle: vi.fn(),
}));

vi.mock("./chat.repository", () => repository);

import { createChatService } from "./chat.service";

describe("createChatService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a conversation and returns mocked assistant reply", async () => {
    const now = new Date("2026-10-26T12:00:00.000Z");
    const conversation = {
      id: "1",
      title: "Hello there",
      created_at: now,
      updated_at: now,
    };

    repository.createConversation.mockResolvedValue(conversation);
    repository.addMessage
      .mockResolvedValueOnce({
        id: "1",
        conversation_id: conversation.id,
        role: "user",
        content: "Hello there",
        created_at: now,
      })
      .mockResolvedValueOnce({
        id: "2",
        conversation_id: conversation.id,
        role: "assistant",
        content: "Mocked assistant reply",
        created_at: now,
      });
    repository.listMessages.mockResolvedValue([
      {
        id: "1",
        conversation_id: conversation.id,
        role: "user",
        content: "Hello there",
        created_at: now,
      },
    ]);
    repository.getConversationById.mockResolvedValue(conversation);

    const textProvider = {
      name: "mock",
      supportsTextGeneration: true as const,
      generateText: vi.fn().mockResolvedValue("Mocked assistant reply"),
    };

    const service = createChatService(textProvider);
    const result = await service.sendMessage("Hello there");

    expect(textProvider.generateText).toHaveBeenCalled();
    expect(result.assistantMessage.content).toBe("Mocked assistant reply");
    expect(result.conversation.id).toBe("1");
  });
});
