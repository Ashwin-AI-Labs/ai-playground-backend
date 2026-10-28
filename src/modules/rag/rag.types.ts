export type RagCitationDto = {
  id: number;
  documentId: string;
  filename: string;
  chunkId: string;
  pageNumber: number | null;
  pageEnd: number | null;
  pageAvailable: boolean;
  excerpt: string;
  similarity: number;
};

export type RagAskResult = {
  sessionId: string;
  answer: string;
  insufficientEvidence: boolean;
  citations: RagCitationDto[];
  retrieval: {
    returnedChunks: number;
    topK: number;
    minSimilarity: number;
    documentFilterApplied: boolean;
  };
};

export type RagSessionSummaryDto = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type RagMessageDto = {
  id: string;
  role: "user" | "assistant";
  content: string;
  insufficientEvidence: boolean;
  citations: RagCitationDto[];
  createdAt: string;
};

export type RagSessionDetailDto = {
  session: RagSessionSummaryDto;
  messages: RagMessageDto[];
};

export type RetrievedEvidence = {
  citationId: number;
  documentId: string;
  filename: string;
  chunkId: string;
  pageStart: number | null;
  pageEnd: number | null;
  excerpt: string;
  similarity: number;
};

export type RagModelOutput = {
  insufficientEvidence: boolean;
  answer: string;
  usedCitationIds: number[];
};
