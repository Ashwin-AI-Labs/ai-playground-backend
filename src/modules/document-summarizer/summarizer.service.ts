import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import path from "node:path";
import { env } from "../../config/env";
import { AppError } from "../../middleware/error-handler";
import { extractDocumentText } from "../../services/document-processing/document-processing.service";
import {
  buildLangchainDocuments,
  estimateDirectContextChars,
  splitLangchainDocuments,
} from "./summarizer.documents";
import { formatChunkCount, normalizeKeyPoints } from "./summarizer.grounding";
import { createSummarizerChatModel, resolveSummarizerModelId } from "./summarizer.model";
import { createSummarizationPipeline } from "./summarizer.pipeline";
import * as repository from "./summarizer.repository";
import { structuredSummarySchema } from "./summarizer.schemas";
import type {
  StructuredSummary,
  SummarizeResult,
  SummaryLength,
  SummaryListItem,
  SummaryStrategy,
  SummaryStyle,
} from "./summarizer.types";

function sanitizeFilename(original: string): string {
  const base = path.basename(original || "document").replace(/[<>:"|?*\u0000]/g, "_");
  const trimmed = base.trim() || "document";
  return trimmed.slice(0, 200);
}

function normalizeStoredSummary(
  value: StructuredSummary | null,
): StructuredSummary | null {
  if (!value) return null;
  const parsed = structuredSummarySchema.safeParse(value);
  if (parsed.success) return parsed.data;
  // Best-effort for unexpected legacy shapes.
  const legacyPoints = (value.keyPoints ?? []) as Array<
    string | { text: string; sourceExcerpt?: string | null; page?: number | null }
  >;
  return {
    ...value,
    keyPoints: normalizeKeyPoints(legacyPoints),
    interpretations: value.interpretations ?? [],
  };
}

function toResult(record: repository.DocumentSummaryRecord): SummarizeResult {
  return {
    id: record.id,
    documentName: record.document_name,
    fileType: record.file_type,
    fileSizeBytes: record.file_size_bytes,
    contentHash: record.content_hash,
    status: record.status,
    length: record.summary_length,
    style: record.summary_style,
    strategy: record.strategy,
    chunkCount: record.chunk_count,
    pageCount: record.page_count,
    modelId: record.model_id,
    durationMs: record.duration_ms ?? 0,
    summary: normalizeStoredSummary(record.summary_json),
    warnings: record.warnings,
    errorMessage: record.error_message,
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
  };
}

function toListItem(record: repository.DocumentSummaryRecord): SummaryListItem {
  return {
    id: record.id,
    documentName: record.document_name,
    fileType: record.file_type,
    status: record.status,
    length: record.summary_length,
    style: record.summary_style,
    strategy: record.strategy,
    chunkCount: record.chunk_count,
    createdAt: record.created_at.toISOString(),
    updatedAt: record.updated_at.toISOString(),
  };
}

function resolveStrategy(
  requested: "auto" | SummaryStrategy,
  chunkCount: number,
  totalChars: number,
): SummaryStrategy {
  if (requested !== "auto") return requested;
  if (
    chunkCount <= 1 &&
    totalChars <= env.SUMMARIZER_DIRECT_MAX_CHARS
  ) {
    return "direct";
  }
  return "map_reduce";
}

function toMarkdownExport(result: SummarizeResult): string {
  const summary = result.summary;
  if (!summary) {
    return `# Summary unavailable\n\nStatus: ${result.status}\n`;
  }

  const lines = [
    `# ${summary.title}`,
    "",
    `Document: ${result.documentName}`,
    `Length: ${result.length} · Style: ${result.style} · Strategy: ${result.strategy} · ${formatChunkCount(result.chunkCount)}`,
    "",
    "## Executive summary",
    summary.executiveSummary,
    "",
    "## Summary",
    summary.summary,
  ];

  if (summary.keyPoints.length) {
    lines.push(
      "",
      "## Key points",
      ...summary.keyPoints.map((item) => {
        const excerpt = item.sourceExcerpt
          ? `\n  - Source: “${item.sourceExcerpt}”${item.page != null ? ` (page ${item.page})` : ""}`
          : "";
        return `- ${item.text}${excerpt}`;
      }),
    );
  }
  if (summary.decisions.length) {
    lines.push("", "## Decisions", ...summary.decisions.map((item) => `- ${item}`));
  }
  if (summary.actionItems.length) {
    lines.push(
      "",
      "## Action items",
      ...summary.actionItems.map((item) => {
        const bits = [item.text];
        if (item.owner) bits.push(`owner: ${item.owner}`);
        if (item.dueDate) bits.push(`due: ${item.dueDate}`);
        return `- ${bits.join(" · ")}`;
      }),
    );
  }
  if (summary.importantDates.length) {
    lines.push(
      "",
      "## Important dates",
      ...summary.importantDates.map((item) => `- ${item.date}: ${item.label}`),
    );
  }
  if (summary.interpretations.length) {
    lines.push(
      "",
      "## Interpretations (not explicit source facts)",
      ...summary.interpretations.map((item) => `- ${item}`),
    );
  }
  if (summary.limitations) {
    lines.push("", "## Limitations", summary.limitations);
  }
  if (result.warnings.length) {
    lines.push("", "## Warnings", ...result.warnings.map((item) => `- ${item}`));
  }

  return `${lines.join("\n")}\n`;
}

export function createDocumentSummarizerService(deps?: {
  model?: BaseChatModel;
}) {
  const resolveModel = () => deps?.model ?? createSummarizerChatModel();

  return {
    async summarize(input: {
      buffer: Buffer;
      originalFilename: string;
      mimeType: string;
      length: SummaryLength;
      style: SummaryStyle;
      strategy: "auto" | SummaryStrategy;
      userId: string;
    }): Promise<SummarizeResult> {
      const started = Date.now();
      const documentName = sanitizeFilename(input.originalFilename);
      const maxBytes = Math.floor(env.SUMMARIZER_MAX_FILE_SIZE_MB * 1024 * 1024);

      const extracted = await extractDocumentText({
        buffer: input.buffer,
        originalFilename: documentName,
        mimeType: input.mimeType,
        maxBytes,
      });

      const sourceDocs = buildLangchainDocuments({
        extracted,
        documentName,
      });
      const splitDocs = await splitLangchainDocuments({
        documents: sourceDocs,
        chunkSize: env.SUMMARIZER_CHUNK_SIZE,
        chunkOverlap: env.SUMMARIZER_CHUNK_OVERLAP,
        maxChunks: env.SUMMARIZER_MAX_CHUNKS,
      });

      const totalChars = estimateDirectContextChars(splitDocs);
      const strategy = resolveStrategy(
        input.strategy,
        splitDocs.length,
        totalChars,
      );

      const record = await repository.createSummary({
        documentName,
        fileType: extracted.extension,
        fileSizeBytes: input.buffer.byteLength,
        contentHash: extracted.contentHash,
        length: input.length,
        style: input.style,
        strategy,
        userId: input.userId,
      });

      const warnings: string[] = [];
      if (extracted.extension === "pdf" && extracted.pages.length === 0) {
        warnings.push(
          "PDF page boundaries were unavailable; page references are limited.",
        );
      }
      if (strategy === "map_reduce") {
        warnings.push(
          "Map-reduce summarizes chunks independently then combines them; subtle cross-chunk nuance may be reduced.",
        );
      }
      if (strategy === "refine") {
        warnings.push(
          "Refine updates a working summary sequentially; early-chunk bias is possible on very long documents.",
        );
      }

      try {
        const model = resolveModel();
        const pipeline = createSummarizationPipeline(model);
        const options = {
          documentName,
          length: input.length,
          style: input.style,
          strategy,
          mapConcurrency: env.SUMMARIZER_MAP_CONCURRENCY,
        };

        const pipelineResult =
          strategy === "direct"
            ? await pipeline.runDirect(splitDocs, options)
            : strategy === "refine"
              ? await pipeline.runRefine(splitDocs, options)
              : await pipeline.runMapReduce(splitDocs, options);

        warnings.push(...pipelineResult.groundingWarnings);

        const durationMs = Date.now() - started;
        const completed = await repository.completeSummary(record.id, {
          summary: pipelineResult.summary,
          chunkCount: splitDocs.length,
          pageCount:
            extracted.pages.length > 0 ? extracted.pages.length : null,
          modelId: resolveSummarizerModelId(),
          durationMs,
          warnings,
          strategy,
        });

        if (!completed) {
          throw new AppError(500, "Failed to persist completed summary");
        }
        return toResult(completed);
      } catch (error) {
        const message =
          error instanceof AppError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Summarization failed";
        await repository.failSummary(record.id, {
          errorMessage: message,
          durationMs: Date.now() - started,
        });
        if (error instanceof AppError) throw error;
        throw new AppError(502, message);
      }
    },

    async list(input: { limit: number; offset: number; userId: string }) {
      const result = await repository.listSummaries(input);
      return {
        summaries: result.summaries.map(toListItem),
        total: result.total,
        limit: input.limit,
        offset: input.offset,
      };
    },

    async get(id: string, userId: string): Promise<SummarizeResult> {
      const record = await repository.getSummaryById(id, userId);
      if (!record) {
        throw new AppError(404, "Summary not found");
      }
      return toResult(record);
    },

    async delete(id: string, userId: string): Promise<void> {
      const deleted = await repository.deleteSummary(id, userId);
      if (!deleted) {
        throw new AppError(404, "Summary not found");
      }
    },

    async exportMarkdown(id: string, userId: string): Promise<{
      filename: string;
      contentType: string;
      body: string;
    }> {
      const result = await this.get(id, userId);
      if (result.status !== "completed" || !result.summary) {
        throw new AppError(400, "Only completed summaries can be exported");
      }
      const safeName = result.documentName.replace(/\.[^.]+$/, "") || "summary";
      return {
        filename: `${safeName}-summary.md`,
        contentType: "text/markdown; charset=utf-8",
        body: toMarkdownExport(result),
      };
    },
  };
}

export const documentSummarizerService = createDocumentSummarizerService();
