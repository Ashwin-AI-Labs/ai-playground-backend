import path from "node:path";
import { env } from "../../config/env";
import { AppError } from "../../middleware/error-handler";
import {
  chunkText,
  extractDocumentText,
} from "../../services/document-processing";
import {
  embedQuery,
  embedTexts,
  getEmbeddingProvider,
} from "../../services/embeddings";
import { searchSimilarChunks } from "../../services/vector-search";
import type { EmbeddingProvider } from "../../services/ai";
import * as repository from "./semantic-search.repository";
import type {
  SearchDocumentDto,
  SearchResultDto,
} from "./semantic-search.types";

function toDocumentDto(
  record: repository.SearchDocumentRecord,
  extras?: { duplicateOf?: boolean },
): SearchDocumentDto {
  return {
    id: record.id,
    filename: record.filename,
    originalFilename: record.original_filename,
    mimeType: record.mime_type,
    fileSizeBytes: record.file_size_bytes,
    contentHash: record.content_hash,
    status: record.status,
    errorMessage: record.error_message,
    chunkCount: record.chunk_count,
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
    ...(extras?.duplicateOf ? { duplicateOf: true } : {}),
  };
}

function sanitizeStoredFilename(originalFilename: string): string {
  const base = path.basename(originalFilename).replace(/[^\w.\- ()[\]]+/g, "_");
  return base.slice(0, 200) || "document";
}

export function createSemanticSearchService(
  embeddingProvider: EmbeddingProvider | null = null,
) {
  const resolveEmbeddings = () =>
    embeddingProvider ?? getEmbeddingProvider();

  return {
    async ingestUpload(input: {
      buffer: Buffer;
      originalFilename: string;
      mimeType: string;
    }): Promise<SearchDocumentDto> {
      const maxBytes = Math.floor(
        env.SEMANTIC_SEARCH_MAX_FILE_SIZE_MB * 1024 * 1024,
      );

      const extracted = await extractDocumentText({
        buffer: input.buffer,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        maxBytes,
      });

      const existing = await repository.findCompletedByContentHash(
        extracted.contentHash,
      );
      if (existing) {
        return toDocumentDto(existing, { duplicateOf: true });
      }

      const filename = sanitizeStoredFilename(input.originalFilename);
      const document = await repository.createDocument({
        filename,
        originalFilename: input.originalFilename,
        mimeType: extracted.mimeType,
        fileSizeBytes: input.buffer.byteLength,
        contentHash: extracted.contentHash,
        status: "processing",
      });

      try {
        const chunks = chunkText(extracted.text, {
          chunkSize: env.SEMANTIC_SEARCH_CHUNK_SIZE,
          overlap: env.SEMANTIC_SEARCH_CHUNK_OVERLAP,
        });

        const embeddings = await embedTexts(
          chunks.map((chunk) => chunk.content),
          resolveEmbeddings(),
        );

        if (embeddings.length !== chunks.length) {
          throw new AppError(
            502,
            "Embedding provider returned an unexpected number of vectors",
          );
        }

        await repository.insertChunks(
          document.id,
          chunks.map((chunk, i) => ({
            index: chunk.index,
            content: chunk.content,
            embedding: embeddings[i],
          })),
        );

        const completed = await repository.updateDocumentStatus(document.id, {
          status: "completed",
          errorMessage: null,
          chunkCount: chunks.length,
        });

        if (!completed) {
          throw new AppError(500, "Failed to finalize document indexing");
        }

        return toDocumentDto(completed);
      } catch (error) {
        const message =
          error instanceof AppError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Document indexing failed";

        await repository.updateDocumentStatus(document.id, {
          status: "failed",
          errorMessage: message,
          chunkCount: 0,
        });
        // Remove any partial chunks left from a mid-flight failure.
        await repository.insertChunks(document.id, []).catch(() => undefined);

        throw error instanceof AppError
          ? error
          : new AppError(502, message);
      }
    },

    async listDocuments(input: { limit: number; offset: number }) {
      const result = await repository.listDocuments(input);
      return {
        documents: result.documents.map((doc) => toDocumentDto(doc)),
        total: result.total,
        limit: input.limit,
        offset: input.offset,
      };
    },

    async getDocument(documentId: string): Promise<SearchDocumentDto> {
      const document = await repository.getDocumentById(documentId);
      if (!document) {
        throw new AppError(404, "Document not found");
      }
      return toDocumentDto(document);
    },

    async deleteDocument(documentId: string): Promise<void> {
      const deleted = await repository.deleteDocument(documentId);
      if (!deleted) {
        throw new AppError(404, "Document not found");
      }
    },

    async search(input: {
      query: string;
      limit: number;
      documentIds: string[];
    }): Promise<{ results: SearchResultDto[]; query: string }> {
      const completedCount = await repository.countCompletedDocuments();
      if (completedCount === 0) {
        return { results: [], query: input.query };
      }

      const queryEmbedding = await embedQuery(
        input.query,
        resolveEmbeddings(),
      );

      const hits = await searchSimilarChunks({
        queryEmbedding,
        limit: input.limit,
        documentIds:
          input.documentIds.length > 0 ? input.documentIds : undefined,
      });

      const results: SearchResultDto[] = hits.map((hit, index) => ({
        rank: index + 1,
        documentId: hit.documentId,
        filename: hit.filename,
        originalFilename: hit.originalFilename,
        chunkId: hit.chunkId,
        chunkIndex: hit.chunkIndex,
        passage: hit.content,
        similarity: Number(hit.similarity.toFixed(6)),
        similarityPercent: Math.round(hit.similarity * 1000) / 10,
        documentCreatedAt: hit.documentCreatedAt,
      }));

      return { results, query: input.query };
    },
  };
}

export const semanticSearchService = createSemanticSearchService();
