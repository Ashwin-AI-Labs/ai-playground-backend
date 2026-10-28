import { AppError } from "../../middleware/error-handler";
import {
  getAiProviderBundle,
  type EmbeddingProvider,
} from "../ai";

export function getEmbeddingProvider(
  provider: EmbeddingProvider | null = getAiProviderBundle().embeddings,
): EmbeddingProvider {
  if (!provider) {
    throw new AppError(
      503,
      "Embeddings are not available for the configured AI provider. Set AI_PROVIDER=openai and OPENAI_API_KEY.",
    );
  }
  return provider;
}

export async function embedTexts(
  texts: string[],
  provider: EmbeddingProvider = getEmbeddingProvider(),
): Promise<number[][]> {
  return provider.embedTexts(texts);
}

export async function embedQuery(
  query: string,
  provider: EmbeddingProvider = getEmbeddingProvider(),
): Promise<number[]> {
  const [vector] = await provider.embedTexts([query]);
  if (!vector) {
    throw new AppError(502, "Embedding provider returned no vector for the query");
  }
  return vector;
}

/** Serialize a vector for parameterized pgvector inserts: '[1,2,3]'::vector */
export function toPgVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}
