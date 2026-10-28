import { z } from "zod";
import { NUMERIC_ID_PATTERN } from "../../database/id";
import { normalizeKeyPoints } from "./summarizer.grounding";

export const numericIdSchema = z
  .string()
  .regex(NUMERIC_ID_PATTERN, "ID must be a decimal numeric string");

export const summaryLengthSchema = z.enum(["short", "medium", "detailed"]);
export const summaryStyleSchema = z.enum([
  "general",
  "executive",
  "technical",
  "academic",
  "meeting_notes",
]);
export const summaryStrategySchema = z.enum([
  "auto",
  "direct",
  "map_reduce",
  "refine",
]);

export const summarizeOptionsSchema = z.object({
  length: summaryLengthSchema.optional().default("medium"),
  style: summaryStyleSchema.optional().default("general"),
  strategy: summaryStrategySchema.optional().default("auto"),
});

export const listSummariesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const actionItemSchema = z.object({
  text: z.string().trim().min(1).max(500),
  owner: z.string().trim().max(200).nullable().optional().default(null),
  dueDate: z.string().trim().max(100).nullable().optional().default(null),
});

export const importantDateSchema = z.object({
  label: z.string().trim().min(1).max(300),
  date: z.string().trim().min(1).max(100),
});

export const groundedKeyPointSchema = z.object({
  text: z.string().trim().min(1).max(500),
  sourceExcerpt: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .optional()
    .default(null),
  page: z.number().int().positive().nullable().optional().default(null),
});

/** Accepts new grounded objects or legacy plain strings from older saved rows. */
const keyPointInputSchema = z.union([
  z.string().trim().min(1).max(500),
  groundedKeyPointSchema,
]);

/**
 * Plain object schema for ChatOpenAI.withStructuredOutput
 * (avoid Zod transforms — structured-output adapters need a clean object schema).
 */
export const structuredSummaryLlmSchema = z.object({
  title: z.string().describe("Short document title"),
  executiveSummary: z.string().describe("2-4 sentence faithful overview"),
  summary: z.string().describe("Main summary body"),
  keyPoints: z
    .array(groundedKeyPointSchema)
    .describe("Explicit source-supported key points with excerpts"),
  decisions: z
    .array(z.string())
    .describe("Only explicit decisions stated in the document"),
  actionItems: z.array(actionItemSchema),
  importantDates: z.array(importantDateSchema),
  interpretations: z
    .array(z.string())
    .describe("Cautious inferences only; empty when unsure"),
  limitations: z.string().describe("Gaps and uncertainty"),
});

/** Backend validation schema — accepts LLM objects or legacy string keyPoints. */
export const structuredSummarySchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    executiveSummary: z.string().trim().min(1).max(4000),
    summary: z.string().trim().min(1).max(20000),
    keyPoints: z.array(keyPointInputSchema).max(30).default([]),
    decisions: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
    actionItems: z.array(actionItemSchema).max(30).default([]),
    importantDates: z.array(importantDateSchema).max(30).default([]),
    interpretations: z
      .array(z.string().trim().min(1).max(500))
      .max(20)
      .optional()
      .default([]),
    limitations: z.string().trim().max(4000).default(""),
  })
  .transform((value) => ({
    ...value,
    keyPoints: normalizeKeyPoints(value.keyPoints),
    interpretations: value.interpretations ?? [],
    actionItems: value.actionItems.map((item) => ({
      text: item.text,
      owner: item.owner ?? null,
      dueDate: item.dueDate ?? null,
    })),
  }));

export type StructuredSummaryParsed = z.output<typeof structuredSummarySchema>;
