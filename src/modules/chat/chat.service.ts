import { AppError } from "../../middleware/error-handler";
import {
  getAiProviderBundle,
  type TextGenerationProvider,
} from "../../services/ai";
import {
  addMessage,
  createConversation,
  getConversationById,
  listConversations,
  listMessages,
  touchConversation,
  updateConversationTitle,
  type ConversationRecord,
  type MessageRecord,
} from "./chat.repository";
import type { ConversationDto, MessageDto } from "./chat.types";

function toConversationDto(conversation: ConversationRecord): ConversationDto {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.created_at.toISOString(),
    updatedAt: conversation.updated_at.toISOString(),
  };
}

function toMessageDto(message: MessageRecord): MessageDto {
  return {
    id: message.id,
    conversationId: message.conversation_id,
    role: message.role,
    content: message.content,
    createdAt: message.created_at.toISOString(),
  };
}

function deriveTitle(message: string): string {
  const cleaned = message.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 60) {
    return cleaned || "New chat";
  }
  return `${cleaned.slice(0, 57)}...`;
}

export function createChatService(
  textProvider: TextGenerationProvider = getAiProviderBundle().text,
) {
  return {
    async listConversations(userId: string) {
      const conversations = await listConversations(userId);
      return conversations.map(toConversationDto);
    },

    async getConversation(conversationId: string, userId: string) {
      const conversation = await getConversationById(conversationId, userId);
      if (!conversation) {
        throw new AppError(404, "Conversation not found");
      }

      const messages = await listMessages(conversationId);
      return {
        conversation: toConversationDto(conversation),
        messages: messages.map(toMessageDto),
      };
    },

    async sendMessage(message: string, userId: string, conversationId?: string) {
      const trimmed = message.trim();
      if (!trimmed) {
        throw new AppError(400, "Message cannot be empty");
      }

      let conversation: ConversationRecord;
      let isNewConversation = false;

      if (conversationId) {
        const existing = await getConversationById(conversationId, userId);
        if (!existing) {
          throw new AppError(404, "Conversation not found");
        }
        conversation = existing;
      } else {
        conversation = await createConversation(deriveTitle(trimmed), userId);
        isNewConversation = true;
      }

      const userMessage = await addMessage(conversation.id, "user", trimmed);
      const history = await listMessages(conversation.id);

      const assistantText = await textProvider.generateText({
        instructions:
          "You are the AI Playground chat assistant. Be concise, helpful, and clear.",
        messages: history
          .filter((entry) => entry.role === "user" || entry.role === "assistant")
          .map((entry) => ({
            role: entry.role as "user" | "assistant",
            content: entry.content,
          })),
      });

      const assistantMessage = await addMessage(
        conversation.id,
        "assistant",
        assistantText,
      );

      if (isNewConversation) {
        await updateConversationTitle(conversation.id, deriveTitle(trimmed), userId);
      } else {
        await touchConversation(conversation.id, userId);
      }

      const refreshed = await getConversationById(conversation.id, userId);
      if (!refreshed) {
        throw new AppError(500, "Conversation disappeared after save");
      }

      return {
        conversation: toConversationDto(refreshed),
        userMessage: toMessageDto(userMessage),
        assistantMessage: toMessageDto(assistantMessage),
      };
    },
  };
}

export const chatService = createChatService();
