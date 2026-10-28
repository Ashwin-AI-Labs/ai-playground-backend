import OpenAI from "openai";
import { env, hasOpenAiApiKey } from "../../../config/env";
import { AppError } from "../../../middleware/error-handler";
import type {
  AiResponsesCreateParams,
  AiTextGenerationRequest,
  EmbeddingProvider,
  TextGenerationProvider,
  ToolCallingProvider,
} from "../ai-provider.interface";

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

function ensureConfigured(): void {
  if (!hasOpenAiApiKey()) {
    throw new AppError(
      503,
      "OpenAI API key is not configured. Set OPENAI_API_KEY in the backend environment.",
    );
  }
}

export function createOpenAiTextProvider(
  clientFactory: () => OpenAI = () =>
    new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    }),
): TextGenerationProvider {
  return {
    name: "openai",
    supportsTextGeneration: true,
    async generateText(request: AiTextGenerationRequest) {
      ensureConfigured();

      try {
        const client = clientFactory();
        const response = await client.responses.create({
          model: request.model ?? env.OPENAI_MODEL,
          instructions: request.instructions,
          input: request.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        });

        const text = extractOutputText(response);
        if (!text) {
          throw new AppError(502, "OpenAI returned an empty response");
        }
        return text;
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        const message =
          error instanceof Error ? error.message : "Unknown OpenAI error";
        throw new AppError(502, `OpenAI request failed: ${message}`);
      }
    },
  };
}

export function createOpenAiToolCallingProvider(
  clientFactory: () => OpenAI = () =>
    new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    }),
): ToolCallingProvider {
  return {
    name: "openai",
    supportsToolCalling: true,
    async createResponse(params: AiResponsesCreateParams) {
      ensureConfigured();

      try {
        const client = clientFactory();
        return await client.responses.create({
          model: params.model ?? env.OPENAI_MODEL,
          instructions: params.instructions,
          input: params.input,
          tools: params.tools,
          previous_response_id: params.previousResponseId,
        });
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        const message =
          error instanceof Error ? error.message : "Unknown OpenAI error";
        throw new AppError(502, `OpenAI request failed: ${message}`);
      }
    },
  };
}

const EMBEDDING_BATCH_SIZE = 64;

function validateEmbeddingVector(
  values: number[],
  expectedDimensions: number,
  index: number,
): number[] {
  if (values.length !== expectedDimensions) {
    throw new AppError(
      502,
      `Embedding dimension mismatch for input ${index}: expected ${expectedDimensions}, got ${values.length}`,
    );
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new AppError(
      502,
      `Embedding for input ${index} contains non-finite values`,
    );
  }
  return values;
}

/**
 * OpenAI embeddings provider.
 * Model: env.OPENAI_EMBEDDING_MODEL (default text-embedding-3-small).
 * Dimensions: env.OPENAI_EMBEDDING_DIMENSIONS (default 1536).
 */
export function createOpenAiEmbeddingProvider(
  clientFactory: () => OpenAI = () =>
    new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    }),
): EmbeddingProvider {
  const dimensions = env.OPENAI_EMBEDDING_DIMENSIONS;
  const model = env.OPENAI_EMBEDDING_MODEL;

  return {
    name: "openai",
    supportsEmbeddings: true,
    dimensions,
    model,
    async embedTexts(texts: string[]) {
      ensureConfigured();

      if (texts.length === 0) {
        return [];
      }

      const client = clientFactory();
      const results: number[][] = new Array(texts.length);

      try {
        for (let offset = 0; offset < texts.length; offset += EMBEDDING_BATCH_SIZE) {
          const batch = texts.slice(offset, offset + EMBEDDING_BATCH_SIZE);
          const response = await client.embeddings.create({
            model,
            input: batch,
            dimensions,
          });

          for (const item of response.data) {
            results[offset + item.index] = validateEmbeddingVector(
              item.embedding,
              dimensions,
              offset + item.index,
            );
          }
        }
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        const message =
          error instanceof Error ? error.message : "Unknown OpenAI error";
        throw new AppError(502, `OpenAI embedding request failed: ${message}`);
      }

      for (let i = 0; i < results.length; i += 1) {
        if (!results[i]) {
          throw new AppError(
            502,
            `OpenAI embedding response missing vector for input ${i}`,
          );
        }
      }

      return results;
    },
  };
}
