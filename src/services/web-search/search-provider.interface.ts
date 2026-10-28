export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  publishedAt: string | null;
  score: number | null;
  provider: string;
};

export type WebSearchRequest = {
  query: string;
  maxResults: number;
  /** Prefer fresher results when the provider supports it. */
  recencyDays?: number | null;
  includeDomains?: string[];
};

export type WebSearchProvider = {
  readonly name: string;
  search: (request: WebSearchRequest) => Promise<WebSearchResult[]>;
};
