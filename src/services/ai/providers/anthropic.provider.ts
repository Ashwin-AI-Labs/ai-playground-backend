import { env, hasAnthropicApiKey } from "../../../config/env";
import { AppError } from "../../../middleware/error-handler";
import type {
  AiTextGenerationRequest,
  TextGenerationProvider,
} from "../ai-provider.interface";

/**
 * Optional Anthropic text provider.
 * This does not silently fall back to OpenAI.
 * Tool calling for the Task Assistant remains OpenAI Responses-based for now.
 */
export function createAnthropicTextProvider(): TextGenerationProvider {
  return {
    name: "anthropic",
    supportsTextGeneration: true,
    async generateText(request: AiTextGenerationRequest) {
      if (!hasAnthropicApiKey()) {
        throw new AppError(
          503,
          "Anthropic API key is not configured. Set ANTHROPIC_API_KEY to enable the Anthropic provider.",
        );
      }

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: request.model ?? env.ANTHROPIC_MODEL,
          max_tokens: 1024,
          system:
            request.instructions ??
            request.messages.find((message) => message.role === "system")
              ?.content,
          messages: request.messages
            .filter((message) => message.role !== "system")
            .map((message) => ({
              role: message.role === "assistant" ? "assistant" : "user",
              content: message.content,
            })),
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new AppError(
          502,
          `Anthropic request failed (${response.status}): ${detail.slice(0, 200)}`,
        );
      }

      const payload = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };

      const text = (payload.content ?? [])
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n")
        .trim();

      if (!text) {
        throw new AppError(502, "Anthropic returned an empty response");
      }

      return text;
    },
  };
}
