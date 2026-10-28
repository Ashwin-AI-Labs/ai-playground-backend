import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMock = vi.hoisted(() => ({
  findCompletedByContentHash: vi.fn(),
  createDocument: vi.fn(),
  updateDocumentStatus: vi.fn(),
  insertChunks: vi.fn(),
  deleteDocument: vi.fn(),
  getDocumentById: vi.fn(),
  listDocuments: vi.fn(),
  countCompletedDocuments: vi.fn(),
}));

const searchMock = vi.hoisted(() => ({
  searchSimilarChunks: vi.fn(),
}));

vi.mock("./semantic-search.repository", () => repositoryMock);
vi.mock("../../services/vector-search", () => searchMock);
vi.mock("../../config/env", () => ({
  env: {
    SEMANTIC_SEARCH_MAX_FILE_SIZE_MB: 10,
    SEMANTIC_SEARCH_CHUNK_SIZE: 20,
    SEMANTIC_SEARCH_CHUNK_OVERLAP: 5,
    OPENAI_EMBEDDING_DIMENSIONS: 8,
  },
}));

import type { EmbeddingProvider } from "../../services/ai";
import { createSemanticSearchService } from "./semantic-search.service";

function mockEmbeddingProvider(
  dimensions = 8,
): EmbeddingProvider & { embedTexts: ReturnType<typeof vi.fn> } {
  return {
    name: "mock",
    supportsEmbeddings: true as const,
    dimensions,
    model: "mock-model",
    embedTexts: vi.fn(async (texts: string[]) =>
      texts.map((_, index) => {
        const vector = Array.from({ length: dimensions }, (__, i) =>
          i === 0 ? (index + 1) / 10 : 0.01 * i,
        );
        return vector;
      }),
    ),
  };
}

describe("semantic search service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an existing completed duplicate without re-embedding", async () => {
    const now = new Date("2026-10-28T00:00:00.000Z");
    repositoryMock.findCompletedByContentHash.mockResolvedValue({
      id: "3",
      filename: "policy.txt",
      original_filename: "policy.txt",
      mime_type: "text/plain",
      file_size_bytes: "42",
      content_hash: "abc",
      status: "completed",
      error_message: null,
      chunk_count: 2,
      created_at: now,
      updated_at: now,
    });

    const embeddings = mockEmbeddingProvider();
    const service = createSemanticSearchService(embeddings);
    const result = await service.ingestUpload({
      buffer: Buffer.from("Our employees can work remotely.", "utf8"),
      originalFilename: "policy.txt",
      mimeType: "text/plain",
    });

    expect(result.duplicateOf).toBe(true);
    expect(result.id).toBe("3");
    expect(embeddings.embedTexts).not.toHaveBeenCalled();
    expect(repositoryMock.createDocument).not.toHaveBeenCalled();
  });

  it("indexes a new document and stores chunks", async () => {
    const now = new Date("2026-10-28T00:00:00.000Z");
    repositoryMock.findCompletedByContentHash.mockResolvedValue(null);
    repositoryMock.createDocument.mockResolvedValue({
      id: "7",
      filename: "policy.txt",
      original_filename: "policy.txt",
      mime_type: "text/plain",
      file_size_bytes: "100",
      content_hash: "hash",
      status: "processing",
      error_message: null,
      chunk_count: 0,
      created_at: now,
      updated_at: now,
    });
    repositoryMock.insertChunks.mockResolvedValue(undefined);
    repositoryMock.updateDocumentStatus.mockResolvedValue({
      id: "7",
      filename: "policy.txt",
      original_filename: "policy.txt",
      mime_type: "text/plain",
      file_size_bytes: "100",
      content_hash: "hash",
      status: "completed",
      error_message: null,
      chunk_count: 1,
      created_at: now,
      updated_at: now,
    });

    const embeddings = mockEmbeddingProvider();
    const service = createSemanticSearchService(embeddings);
    const result = await service.ingestUpload({
      buffer: Buffer.from(
        "Our employees can work remotely up to three days per week with manager approval.",
        "utf8",
      ),
      originalFilename: "policy.txt",
      mimeType: "text/plain",
    });

    expect(result.status).toBe("completed");
    expect(result.id).toBe("7");
    expect(embeddings.embedTexts).toHaveBeenCalled();
    expect(repositoryMock.insertChunks).toHaveBeenCalled();
  });

  it("marks documents failed when embeddings fail", async () => {
    const now = new Date("2026-10-28T00:00:00.000Z");
    repositoryMock.findCompletedByContentHash.mockResolvedValue(null);
    repositoryMock.createDocument.mockResolvedValue({
      id: "9",
      filename: "policy.txt",
      original_filename: "policy.txt",
      mime_type: "text/plain",
      file_size_bytes: "100",
      content_hash: "hash",
      status: "processing",
      error_message: null,
      chunk_count: 0,
      created_at: now,
      updated_at: now,
    });
    repositoryMock.updateDocumentStatus.mockResolvedValue({
      id: "9",
      filename: "policy.txt",
      original_filename: "policy.txt",
      mime_type: "text/plain",
      file_size_bytes: "100",
      content_hash: "hash",
      status: "failed",
      error_message: "boom",
      chunk_count: 0,
      created_at: now,
      updated_at: now,
    });
    repositoryMock.insertChunks.mockResolvedValue(undefined);

    const embeddings = mockEmbeddingProvider();
    embeddings.embedTexts.mockRejectedValue(new Error("boom"));

    const service = createSemanticSearchService(embeddings);
    await expect(
      service.ingestUpload({
        buffer: Buffer.from("Remote work policy text for indexing.", "utf8"),
        originalFilename: "policy.txt",
        mimeType: "text/plain",
      }),
    ).rejects.toThrow(/boom|failed/i);

    expect(repositoryMock.updateDocumentStatus).toHaveBeenCalledWith(
      "9",
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("returns empty results for an empty index", async () => {
    repositoryMock.countCompletedDocuments.mockResolvedValue(0);
    const service = createSemanticSearchService(mockEmbeddingProvider());
    const result = await service.search({
      query: "remote work",
      limit: 5,
      documentIds: [],
    });
    expect(result.results).toEqual([]);
    expect(searchMock.searchSimilarChunks).not.toHaveBeenCalled();
  });

  it("ranks search hits and respects limit filters", async () => {
    repositoryMock.countCompletedDocuments.mockResolvedValue(2);
    searchMock.searchSimilarChunks.mockResolvedValue([
      {
        chunkId: "11",
        documentId: "7",
        filename: "policy.txt",
        originalFilename: "policy.txt",
        chunkIndex: 0,
        content: "work remotely up to three days",
        similarity: 0.91,
        documentCreatedAt: "2026-10-28T00:00:00.000Z",
      },
    ]);

    const embeddings = mockEmbeddingProvider();
    const service = createSemanticSearchService(embeddings);
    const result = await service.search({
      query: "What is the company's work-from-home policy?",
      limit: 5,
      documentIds: ["7"],
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].rank).toBe(1);
    expect(result.results[0].similarityPercent).toBe(91);
    expect(searchMock.searchSimilarChunks).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 5,
        documentIds: ["7"],
      }),
    );
  });

  it("deletes documents", async () => {
    repositoryMock.deleteDocument.mockResolvedValue(true);
    const service = createSemanticSearchService(mockEmbeddingProvider());
    await service.deleteDocument("7");
    expect(repositoryMock.deleteDocument).toHaveBeenCalledWith("7");
  });
});
