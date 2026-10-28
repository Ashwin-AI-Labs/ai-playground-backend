import { env, hasTavilyApiKey } from "../../config/env";
import { AppError } from "../../middleware/error-handler";
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from "./search-provider.interface";

type TavilyResponse = {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    published_date?: string;
    score?: number;
  }>;
};

export function createTavilySearchProvider(): WebSearchProvider {
  return {
    name: "tavily",
    async search(request: WebSearchRequest): Promise<WebSearchResult[]> {
      if (!hasTavilyApiKey()) {
        throw new AppError(
          503,
          "Web search is not configured. Set TAVILY_API_KEY in the backend environment. Get a key at https://tavily.com",
        );
      }

      const body: Record<string, unknown> = {
        api_key: env.TAVILY_API_KEY,
        query: request.query,
        max_results: request.maxResults,
        search_depth: "basic",
        include_answer: false,
      };

      if (request.includeDomains && request.includeDomains.length > 0) {
        body.include_domains = request.includeDomains.slice(0, 10);
      }

      if (request.recencyDays && request.recencyDays > 0) {
        body.days = Math.min(request.recencyDays, 365);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);

      try {
        const response = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (response.status === 401 || response.status === 403) {
          throw new AppError(
            503,
            "Tavily rejected the API key. Check TAVILY_API_KEY.",
          );
        }
        if (response.status === 429) {
          throw new AppError(429, "Tavily rate limit exceeded. Try again shortly.");
        }
        if (!response.ok) {
          const detail = (await response.text()).slice(0, 200);
          throw new AppError(
            502,
            `Tavily search failed (${response.status}): ${detail}`,
          );
        }

        const payload = (await response.json()) as TavilyResponse;
        return (payload.results ?? [])
          .filter((item) => typeof item.url === "string" && item.url.trim())
          .map((item) => ({
            title: (item.title ?? "Untitled").trim() || "Untitled",
            url: item.url!.trim(),
            snippet: (item.content ?? "").trim(),
            publishedAt: item.published_date?.trim() || null,
            score: typeof item.score === "number" ? item.score : null,
            provider: "tavily",
          }));
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        if (error instanceof Error && error.name === "AbortError") {
          throw new AppError(504, "Tavily search timed out");
        }
        const message =
          error instanceof Error ? error.message : "Unknown search error";
        throw new AppError(502, `Web search failed: ${message}`);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
