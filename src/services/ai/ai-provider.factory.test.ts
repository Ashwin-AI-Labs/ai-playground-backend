import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/env", () => ({
  env: {
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "gpt-4.1-mini",
    OPENAI_EMBEDDING_MODEL: "text-embedding-3-small",
    OPENAI_EMBEDDING_DIMENSIONS: 1536,
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_MODEL: "claude-sonnet-4-5",
  },
  hasOpenAiApiKey: () => true,
  hasAnthropicApiKey: () => false,
}));

import {
  createAiProviderBundle,
  setAiProviderBundleForTests,
} from "./ai-provider.factory";

describe("createAiProviderBundle", () => {
  afterEach(() => {
    setAiProviderBundleForTests(null);
  });

  it("returns OpenAI text, tool, and embedding capabilities", () => {
    const bundle = createAiProviderBundle("openai");
    expect(bundle.providerName).toBe("openai");
    expect(bundle.text.supportsTextGeneration).toBe(true);
    expect(bundle.tools?.supportsToolCalling).toBe(true);
    expect(bundle.embeddings?.supportsEmbeddings).toBe(true);
    expect(bundle.embeddings?.dimensions).toBe(1536);
  });

  it("returns Anthropic text without tool calling or embeddings", () => {
    const bundle = createAiProviderBundle("anthropic");
    expect(bundle.providerName).toBe("anthropic");
    expect(bundle.text.supportsTextGeneration).toBe(true);
    expect(bundle.tools).toBeNull();
    expect(bundle.embeddings).toBeNull();
  });
});
