import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { env, hasOpenAiApiKey } from "../../config/env";
import { AppError } from "../../middleware/error-handler";

export function resolveSummarizerModelId(): string {
  return env.SUMMARIZER_MODEL?.trim() || env.OPENAI_MODEL;
}

/**
 * Create the LangChain chat model used by the summarizer.
 * Reuses backend OPENAI_API_KEY / model config; optional SUMMARIZER_MODEL override.
 */
export function createSummarizerChatModel(): BaseChatModel {
  if (env.AI_PROVIDER !== "openai") {
    throw new AppError(
      503,
      "Document summarizer currently requires AI_PROVIDER=openai with LangChain ChatOpenAI",
    );
  }
  if (!hasOpenAiApiKey()) {
    throw new AppError(
      503,
      "OpenAI is not configured. Set OPENAI_API_KEY in the backend environment.",
    );
  }

  return new ChatOpenAI({
    apiKey: env.OPENAI_API_KEY,
    model: resolveSummarizerModelId(),
    temperature: 0,
    timeout: env.SUMMARIZER_TIMEOUT_MS,
    maxRetries: 1,
  });
}
