import { describe, expect, it } from "vitest";
import {
  assertSupportedUpload,
  chunkText,
  detectSupportedExtension,
  extractDocumentText,
  hashContent,
  normalizeExtractedText,
} from "./document-processing.service";

describe("document processing", () => {
  it("detects supported extensions", () => {
    expect(detectSupportedExtension("policy.pdf")).toBe("pdf");
    expect(detectSupportedExtension("notes.TXT")).toBe("txt");
    expect(detectSupportedExtension("readme.markdown")).toBe("md");
    expect(detectSupportedExtension("photo.png")).toBeNull();
  });

  it("rejects oversized and empty uploads", () => {
    expect(() =>
      assertSupportedUpload({
        originalFilename: "a.txt",
        mimeType: "text/plain",
        sizeBytes: 0,
        maxBytes: 1000,
      }),
    ).toThrow(/empty/i);

    expect(() =>
      assertSupportedUpload({
        originalFilename: "a.txt",
        mimeType: "text/plain",
        sizeBytes: 2000,
        maxBytes: 1000,
      }),
    ).toThrow(/maximum size/i);
  });

  it("extracts and hashes plain text", async () => {
    const extracted = await extractDocumentText({
      buffer: Buffer.from("Hello world policy text", "utf8"),
      originalFilename: "policy.txt",
      mimeType: "text/plain",
      maxBytes: 10_000,
    });

    expect(extracted.text).toContain("Hello world");
    expect(extracted.contentHash).toBe(hashContent(extracted.text));
    expect(extracted.extension).toBe("txt");
  });

  it("extracts markdown", async () => {
    const extracted = await extractDocumentText({
      buffer: Buffer.from("# Title\n\nRemote work is allowed.", "utf8"),
      originalFilename: "handbook.md",
      mimeType: "text/markdown",
      maxBytes: 10_000,
    });
    expect(extracted.text).toContain("Remote work");
  });

  it("rejects textless buffers", async () => {
    await expect(
      extractDocumentText({
        buffer: Buffer.from("   \n\n  ", "utf8"),
        originalFilename: "empty.txt",
        mimeType: "text/plain",
        maxBytes: 10_000,
      }),
    ).rejects.toThrow(/no extractable text/i);
  });

  it("chunks text with overlap and stable indexes", () => {
    const words = Array.from({ length: 50 }, (_, i) => `word${i + 1}`);
    const text = words.join(" ");
    const chunks = chunkText(text, { chunkSize: 20, overlap: 5 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].pageStart).toBeNull();
    expect(chunks.every((chunk) => chunk.content.trim().length > 0)).toBe(true);

    const firstWords = chunks[0].content.split(/\s+/);
    const secondWords = chunks[1].content.split(/\s+/);
    expect(firstWords.slice(-5)).toEqual(secondWords.slice(0, 5));
  });

  it("normalizes whitespace conservatively", () => {
    expect(normalizeExtractedText("a  \n\n\nb\r\nc")).toBe("a\n\nb\nc");
  });
});
