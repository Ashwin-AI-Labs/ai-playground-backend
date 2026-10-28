export type SummaryLength = "short" | "medium" | "detailed";
export type SummaryStyle =
  | "general"
  | "executive"
  | "technical"
  | "academic"
  | "meeting_notes";
export type SummaryStrategy = "direct" | "map_reduce" | "refine";
export type SummaryStatus = "pending" | "processing" | "completed" | "failed";

export type ActionItem = {
  text: string;
  owner: string | null;
  dueDate: string | null;
};

export type ImportantDate = {
  label: string;
  date: string;
};

/** Key point with optional near-verbatim source excerpt for traceability. */
export type GroundedKeyPoint = {
  text: string;
  sourceExcerpt: string | null;
  page: number | null;
};

export type StructuredSummary = {
  title: string;
  executiveSummary: string;
  summary: string;
  keyPoints: GroundedKeyPoint[];
  decisions: string[];
  actionItems: ActionItem[];
  importantDates: ImportantDate[];
  /** Cautious inferences — never mixed into keyPoints/decisions. */
  interpretations: string[];
  limitations: string;
};

export type SummarizeResult = {
  id: string;
  documentName: string;
  fileType: "pdf" | "txt" | "md";
  fileSizeBytes: string;
  contentHash: string;
  status: SummaryStatus;
  length: SummaryLength;
  style: SummaryStyle;
  strategy: SummaryStrategy;
  chunkCount: number;
  pageCount: number | null;
  modelId: string | null;
  durationMs: number;
  summary: StructuredSummary | null;
  warnings: string[];
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SummaryListItem = {
  id: string;
  documentName: string;
  fileType: "pdf" | "txt" | "md";
  status: SummaryStatus;
  length: SummaryLength;
  style: SummaryStyle;
  strategy: SummaryStrategy;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
};
