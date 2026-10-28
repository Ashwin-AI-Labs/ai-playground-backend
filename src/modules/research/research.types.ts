export type ResearchStatus = "pending" | "running" | "completed" | "failed";

export type ResearchSourceDto = {
  id: number;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  excerpt: string;
  publishedAt: string | null;
  retrievedAt: string;
  fetchStatus: "fetched" | "snippet_only" | "blocked" | "failed";
  provider: string;
};

export type ResearchReport = {
  executiveSummary: string;
  keyFindings: string[];
  detailedAnalysis: string;
  agreements: string;
  conflicts: string;
  limitations: string;
  conclusions: string;
  usedSourceIds: number[];
};

export type ResearchRunResult = {
  sessionId: string;
  question: string;
  status: ResearchStatus;
  insufficientEvidence: boolean;
  report: ResearchReport | null;
  sources: ResearchSourceDto[];
  searchQueries: string[];
  durationMs: number;
  errorMessage: string | null;
};

export type ResearchSessionSummary = {
  id: string;
  title: string;
  question: string;
  status: ResearchStatus;
  sourceCount: number;
  createdAt: string;
  updatedAt: string;
};
