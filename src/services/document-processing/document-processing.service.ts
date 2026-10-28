import { createHash } from "node:crypto";
import { AppError } from "../../middleware/error-handler";

export type SupportedExtension = "pdf" | "txt" | "md";

export type ExtractedPage = {
  pageNumber: number;
  text: string;
};

export type ExtractedDocument = {
  text: string;
  extension: SupportedExtension;
  mimeType: string;
  contentHash: string;
  /** PDF page texts when available; empty for TXT/Markdown. */
  pages: ExtractedPage[];
};

export type TextChunk = {
  index: number;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
};

const EXTENSION_MIME: Record<SupportedExtension, string[]> = {
  pdf: ["application/pdf"],
  txt: ["text/plain", "application/octet-stream"],
  md: ["text/markdown", "text/x-markdown", "text/plain", "application/octet-stream"],
};

export function detectSupportedExtension(
  originalFilename: string,
): SupportedExtension | null {
  const lower = originalFilename.trim().toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "md";
  return null;
}

export function assertSupportedUpload(input: {
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  maxBytes: number;
}): SupportedExtension {
  const extension = detectSupportedExtension(input.originalFilename);
  if (!extension) {
    throw new AppError(
      400,
      "Unsupported file type. Allowed extensions: .pdf, .txt, .md",
    );
  }

  if (input.sizeBytes <= 0) {
    throw new AppError(400, "Uploaded file is empty");
  }

  if (input.sizeBytes > input.maxBytes) {
    const maxMb = Math.round(input.maxBytes / (1024 * 1024));
    throw new AppError(400, `File exceeds the maximum size of ${maxMb} MB`);
  }

  const normalizedMime = (input.mimeType || "").toLowerCase().split(";")[0].trim();
  const allowed = EXTENSION_MIME[extension];
  if (normalizedMime && !allowed.includes(normalizedMime)) {
    // Soft mismatch: extension is authoritative, but reject clearly wrong types
    // such as images claimed as PDF.
    if (
      normalizedMime.startsWith("image/") ||
      normalizedMime.startsWith("audio/") ||
      normalizedMime.startsWith("video/") ||
      normalizedMime === "application/zip" ||
      normalizedMime === "application/x-msdownload"
    ) {
      throw new AppError(
        400,
        `MIME type "${normalizedMime}" is not allowed for .${extension} uploads`,
      );
    }
  }

  return extension;
}

export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function hashContent(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function extractPdfPages(buffer: Buffer): Promise<{
  text: string;
  pages: ExtractedPage[];
}> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const pages: ExtractedPage[] = (result.pages ?? [])
      .map((page) => ({
        pageNumber: page.num,
        text: normalizeExtractedText(page.text ?? ""),
      }))
      .filter((page) => page.text.length > 0);

    const text =
      pages.length > 0
        ? pages.map((page) => page.text).join("\n\n")
        : normalizeExtractedText(
            typeof result?.text === "string" ? result.text : "",
          );

    return { text, pages };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

function extractPlainText(buffer: Buffer): string {
  return buffer.toString("utf8");
}

export async function extractDocumentText(input: {
  buffer: Buffer;
  originalFilename: string;
  mimeType: string;
  maxBytes: number;
}): Promise<ExtractedDocument> {
  const extension = assertSupportedUpload({
    originalFilename: input.originalFilename,
    mimeType: input.mimeType,
    sizeBytes: input.buffer.byteLength,
    maxBytes: input.maxBytes,
  });

  let text = "";
  let pages: ExtractedPage[] = [];

  try {
    if (extension === "pdf") {
      const extracted = await extractPdfPages(input.buffer);
      text = extracted.text;
      pages = extracted.pages;
    } else {
      text = normalizeExtractedText(extractPlainText(input.buffer));
      pages = [];
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      400,
      `Failed to extract text from ${extension.toUpperCase()} file`,
    );
  }

  text = normalizeExtractedText(text);
  if (!text) {
    throw new AppError(
      400,
      "Document contains no extractable text. Scanned PDFs without OCR are not supported.",
    );
  }

  return {
    text,
    extension,
    mimeType: EXTENSION_MIME[extension][0],
    contentHash: hashContent(text),
    pages,
  };
}

/**
 * Word-based chunking approximating tokens (1 word ≈ 1 token).
 * Prefer paragraph/sentence boundaries when they fall near the target size.
 *
 * Limitations:
 * - Not a true tokenizer; non-English scripts and punctuation inflate counts.
 * - Very long words are kept intact and may exceed the target size slightly.
 */
type WordToken = {
  word: string;
  pageNumber: number | null;
};

function chunkWordTokens(
  tokens: WordToken[],
  options: { chunkSize: number; overlap: number },
): TextChunk[] {
  const { chunkSize, overlap } = options;
  if (chunkSize < 1) {
    throw new AppError(500, "chunkSize must be positive");
  }
  if (overlap < 0 || overlap >= chunkSize) {
    throw new AppError(500, "overlap must be >= 0 and < chunkSize");
  }
  if (tokens.length === 0) {
    return [];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < tokens.length) {
    let end = Math.min(start + chunkSize, tokens.length);

    if (end < tokens.length) {
      const searchFrom = Math.max(start + Math.floor(chunkSize * 0.8), start + 1);
      const window = tokens.slice(searchFrom, end);
      let boundaryOffset = -1;
      for (let i = window.length - 1; i >= 0; i -= 1) {
        const token = window[i].word;
        if (
          token.endsWith(".") ||
          token.endsWith("!") ||
          token.endsWith("?") ||
          token.endsWith(":")
        ) {
          boundaryOffset = i;
          break;
        }
      }
      if (boundaryOffset >= 0) {
        end = searchFrom + boundaryOffset + 1;
      }
    }

    const slice = tokens.slice(start, end);
    const content = slice
      .map((token) => token.word)
      .join(" ")
      .trim();
    if (content) {
      const pageNumbers = slice
        .map((token) => token.pageNumber)
        .filter((value): value is number => value !== null);
      chunks.push({
        index,
        content,
        pageStart: pageNumbers.length > 0 ? Math.min(...pageNumbers) : null,
        pageEnd: pageNumbers.length > 0 ? Math.max(...pageNumbers) : null,
      });
      index += 1;
    }

    if (end >= tokens.length) {
      break;
    }

    const nextStart = end - overlap;
    start = nextStart <= start ? end : nextStart;
  }

  if (chunks.length === 0) {
    throw new AppError(400, "Document produced no searchable chunks");
  }

  return chunks;
}

/**
 * Word-based chunking approximating tokens (1 word ≈ 1 token).
 * Prefer paragraph/sentence boundaries when they fall near the target size.
 *
 * Limitations:
 * - Not a true tokenizer; non-English scripts and punctuation inflate counts.
 * - Very long words are kept intact and may exceed the target size slightly.
 */
export function chunkText(
  text: string,
  options: { chunkSize: number; overlap: number },
): TextChunk[] {
  const normalized = normalizeExtractedText(text);
  const words = normalized.split(/\s+/).filter(Boolean);
  return chunkWordTokens(
    words.map((word) => ({ word, pageNumber: null })),
    options,
  );
}

/**
 * Chunk page-aware PDF text so each chunk can cite page_start/page_end.
 * Falls back to plain chunking when pages are empty.
 */
export function chunkExtractedDocument(
  document: ExtractedDocument,
  options: { chunkSize: number; overlap: number },
): TextChunk[] {
  if (document.pages.length === 0) {
    return chunkText(document.text, options);
  }

  const tokens: WordToken[] = [];
  for (const page of document.pages) {
    const words = page.text.split(/\s+/).filter(Boolean);
    for (const word of words) {
      tokens.push({ word, pageNumber: page.pageNumber });
    }
  }

  return chunkWordTokens(tokens, options);
}
