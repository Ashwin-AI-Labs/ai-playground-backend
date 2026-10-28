import { createTavilySearchProvider } from "./tavily.provider";
import type { WebSearchProvider } from "./search-provider.interface";

export type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from "./search-provider.interface";
export { createTavilySearchProvider } from "./tavily.provider";

let cached: WebSearchProvider | null = null;

export function getWebSearchProvider(): WebSearchProvider {
  if (!cached) {
    cached = createTavilySearchProvider();
  }
  return cached;
}

/** Test helper */
export function setWebSearchProviderForTests(
  provider: WebSearchProvider | null,
): void {
  cached = provider;
}
