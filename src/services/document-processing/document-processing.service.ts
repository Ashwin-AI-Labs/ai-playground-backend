import { createHash } from "node:crypto";
import { AppError } from "../../middleware/error-handler";

export type SupportedExtension = "pdf" | "txt" | "md";

export type ExtractedDocument = {
  text: string;
  extension: SupportedExtension;
  mimeType: string;
  contentHash: string;
};

export type TextChunk = {
  index: number;
  content: string;
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

async function extractPdfText(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return typeof result?.text === "string" ? result.text : "";
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

  let rawText = "";
  try {
    if (extension === "pdf") {
      rawText = await extractPdfText(input.buffer);
    } else {
      rawText = extractPlainText(input.buffer);
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

  const text = normalizeExtractedText(rawText);
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
export function chunkText(
  text: string,
  options: { chunkSize: number; overlap: number },
): TextChunk[] {
  const { chunkSize, overlap } = options;
  if (chunkSize < 1) {
    throw new AppError(500, "chunkSize must be positive");
  }
  if (overlap < 0 || overlap >= chunkSize) {
    throw new AppError(500, "overlap must be >= 0 and < chunkSize");
  }

  const normalized = normalizeExtractedText(text);
  if (!normalized) {
    return [];
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < words.length) {
    let end = Math.min(start + chunkSize, words.length);

    // Prefer ending near a paragraph or sentence boundary within the last 20%.
    if (end < words.length) {
      const searchFrom = Math.max(start + Math.floor(chunkSize * 0.8), start + 1);
      const window = words.slice(searchFrom, end);
      let boundaryOffset = -1;
      for (let i = window.length - 1; i >= 0; i -= 1) {
        const token = window[i];
        if (token.endsWith(".") || token.endsWith("!") || token.endsWith("?") || token.endsWith(":")) {
          boundaryOffset = i;
          break;
        }
      }
      if (boundaryOffset >= 0) {
        end = searchFrom + boundaryOffset + 1;
      }
    }

    const content = words.slice(start, end).join(" ").trim();
    if (content) {
      chunks.push({ index, content });
      index += 1;
    }

    if (end >= words.length) {
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
