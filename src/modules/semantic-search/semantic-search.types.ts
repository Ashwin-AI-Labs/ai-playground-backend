export type DocumentStatus = "processing" | "completed" | "failed";

export type SearchDocumentDto = {
  id: string;
  filename: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: string;
  contentHash: string;
  status: DocumentStatus;
  errorMessage: string | null;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
  duplicateOf?: boolean;
};

export type SearchResultDto = {
  rank: number;
  documentId: string;
  filename: string;
  originalFilename: string;
  chunkId: string;
  chunkIndex: number;
  passage: string;
  similarity: number;
  similarityPercent: number;
  documentCreatedAt: string;
};
