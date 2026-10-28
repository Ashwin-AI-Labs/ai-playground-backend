import type OpenAI from "openai";

export type AiTextRole = "user" | "assistant" | "system";

export type AiTextMessage = {
  role: AiTextRole;
  content: string;
};

export type AiTextGenerationRequest = {
  messages: AiTextMessage[];
  instructions?: string;
  model?: string;
};

export type AiToolDefinition = OpenAI.Responses.Tool;

export type AiResponsesCreateParams = {
  model?: string;
  instructions?: string;
  input: OpenAI.Responses.ResponseInput;
  tools?: AiToolDefinition[];
  previousResponseId?: string;
};

/**
 * Capability: plain conversational / instruction-following text generation.
 */
export type TextGenerationProvider = {
  readonly name: string;
  readonly supportsTextGeneration: true;
  generateText: (request: AiTextGenerationRequest) => Promise<string>;
};

/**
 * Capability: OpenAI Responses-style tool calling loop primitives.
 * Providers that do not support this must not advertise the capability.
 */
export type ToolCallingProvider = {
  readonly name: string;
  readonly supportsToolCalling: true;
  createResponse: (
    params: AiResponsesCreateParams,
  ) => Promise<OpenAI.Responses.Response>;
};

/**
 * Capability: dense text embeddings for semantic search / RAG.
 */
export type EmbeddingProvider = {
  readonly name: string;
  readonly supportsEmbeddings: true;
  readonly dimensions: number;
  readonly model: string;
  embedTexts: (texts: string[]) => Promise<number[][]>;
};

export type AiProviderBundle = {
  providerName: string;
  text: TextGenerationProvider;
  tools: ToolCallingProvider | null;
  embeddings: EmbeddingProvider | null;
};
