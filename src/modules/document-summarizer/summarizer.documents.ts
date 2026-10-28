import { Document } from "@langchain/core/documents";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { ExtractedDocument } from "../../services/document-processing/document-processing.service";
import { AppError } from "../../middleware/error-handler";

export type SummarizerDocMeta = {
  source: string;
  fileType: string;
  pageNumber?: number;
  pageStart?: number | null;
  pageEnd?: number | null;
  chunkIndex?: number;
};

/**
 * Build LangChain Document objects from extracted text.
 * PDF pages become separate source documents when page text is available.
 * TXT/Markdown become a single document without invented page numbers.
 */
export function buildLangchainDocuments(input: {
  extracted: ExtractedDocument;
  documentName: string;
}): Document[] {
  const { extracted, documentName } = input;

  if (extracted.pages.length > 0) {
    return extracted.pages.map(
      (page) =>
        new Document({
          pageContent: page.text,
          metadata: {
            source: documentName,
            fileType: extracted.extension,
            pageNumber: page.pageNumber,
          } satisfies SummarizerDocMeta,
        }),
    );
  }

  return [
    new Document({
      pageContent: extracted.text,
      metadata: {
        source: documentName,
        fileType: extracted.extension,
      } satisfies SummarizerDocMeta,
    }),
  ];
}

export async function splitLangchainDocuments(input: {
  documents: Document[];
  chunkSize: number;
  chunkOverlap: number;
  maxChunks: number;
}): Promise<Document[]> {
  if (input.documents.length === 0) {
    throw new AppError(400, "No documents to summarize");
  }

  const totalChars = input.documents.reduce(
    (sum, doc) => sum + doc.pageContent.length,
    0,
  );

  // Short docs: keep as-is (still LangChain Documents).
  if (totalChars <= input.chunkSize && input.documents.length === 1) {
    const only = input.documents[0];
    return [
      new Document({
        pageContent: only.pageContent,
        metadata: {
          ...only.metadata,
          chunkIndex: 0,
          pageStart: only.metadata.pageNumber ?? null,
          pageEnd: only.metadata.pageNumber ?? null,
        },
      }),
    ];
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: input.chunkSize,
    chunkOverlap: input.chunkOverlap,
  });

  const chunks = await splitter.splitDocuments(input.documents);
  if (chunks.length === 0) {
    throw new AppError(400, "Document produced no text chunks after splitting");
  }

  if (chunks.length > input.maxChunks) {
    throw new AppError(
      400,
      `Document is too large after splitting (${chunks.length} chunks). Maximum allowed is ${input.maxChunks}. Try a shorter document or a coarser summary.`,
    );
  }

  return chunks.map(
    (chunk, index) =>
      new Document({
        pageContent: chunk.pageContent,
        metadata: {
          ...chunk.metadata,
          chunkIndex: index,
          pageStart:
            typeof chunk.metadata.pageNumber === "number"
              ? chunk.metadata.pageNumber
              : (chunk.metadata.pageStart ?? null),
          pageEnd:
            typeof chunk.metadata.pageNumber === "number"
              ? chunk.metadata.pageNumber
              : (chunk.metadata.pageEnd ?? null),
        },
      }),
  );
}

export function estimateDirectContextChars(documents: Document[]): number {
  return documents.reduce((sum, doc) => sum + doc.pageContent.length, 0);
}
