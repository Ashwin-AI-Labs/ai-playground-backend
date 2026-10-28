import { env } from "../../config/env";
import { AppError } from "../../middleware/error-handler";
import type { AiProviderBundle } from "./ai-provider.interface";
import { createAnthropicTextProvider } from "./providers/anthropic.provider";
import {
  createOpenAiEmbeddingProvider,
  createOpenAiTextProvider,
  createOpenAiToolCallingProvider,
} from "./providers/openai.provider";

export function createAiProviderBundle(
  providerName: "openai" | "anthropic" = env.AI_PROVIDER,
): AiProviderBundle {
  if (providerName === "openai") {
    return {
      providerName: "openai",
      text: createOpenAiTextProvider(),
      tools: createOpenAiToolCallingProvider(),
      embeddings: createOpenAiEmbeddingProvider(),
    };
  }

  if (providerName === "anthropic") {
    return {
      providerName: "anthropic",
      text: createAnthropicTextProvider(),
      // Embeddings for semantic search currently require OpenAI.
      tools: null,
      embeddings: null,
    };
  }

  throw new AppError(500, `Unsupported AI provider: ${String(providerName)}`);
}

let cachedBundle: AiProviderBundle | null = null;

export function getAiProviderBundle(): AiProviderBundle {
  if (!cachedBundle) {
    cachedBundle = createAiProviderBundle();
  }
  return cachedBundle;
}

/** Test helper to inject providers without relying on process-wide env. */
export function setAiProviderBundleForTests(bundle: AiProviderBundle | null): void {
  cachedBundle = bundle;
}
