import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { Document } from "@langchain/core/documents";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableLambda, RunnableSequence } from "@langchain/core/runnables";
import { AppError } from "../../middleware/error-handler";
import {
  lengthGuidance,
  mapChunkPrompt,
  refinePrompt,
  finalStructuredPrompt,
  styleGuidance,
} from "./summarizer.prompts";
import { groundStructuredSummary } from "./summarizer.grounding";
import {
  structuredSummaryLlmSchema,
  structuredSummarySchema,
  type StructuredSummaryParsed,
} from "./summarizer.schemas";
import type {
  SummaryLength,
  SummaryStrategy,
  SummaryStyle,
} from "./summarizer.types";

export type PipelineOptions = {
  documentName: string;
  length: SummaryLength;
  style: SummaryStyle;
  strategy: SummaryStrategy;
  mapConcurrency: number;
};

function pageMeta(doc: Document): string {
  const start = doc.metadata.pageStart ?? doc.metadata.pageNumber;
  const end = doc.metadata.pageEnd ?? doc.metadata.pageNumber;
  if (typeof start === "number" && typeof end === "number") {
    return start === end ? `page ${start}` : `pages ${start}-${end}`;
  }
  return "page unavailable";
}

function extractTextContent(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object" && "content" in output) {
    const content = (output as { content: unknown }).content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === "string") return part;
          if (part && typeof part === "object" && "text" in part) {
            return String((part as { text: unknown }).text ?? "");
          }
          return "";
        })
        .join("");
    }
  }
  return String(output ?? "");
}

export function parseStructuredSummary(raw: string): StructuredSummaryParsed {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new AppError(502, "Summarization model returned invalid JSON");
  }
  const result = structuredSummarySchema.safeParse(parsed);
  if (!result.success) {
    throw new AppError(502, "Summarization model returned an invalid summary schema");
  }
  return result.data;
}

function finalizeWithGrounding(
  summary: StructuredSummaryParsed,
  evidence: string,
): { summary: StructuredSummaryParsed; groundingWarnings: string[] } {
  const grounded = groundStructuredSummary(summary, evidence);
  return {
    summary: grounded.summary,
    groundingWarnings: grounded.warnings,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function runWorker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runWorker(),
  );
  await Promise.all(workers);
  return results;
}

/**
 * Genuine LangChain.js summarization pipeline.
 *
 * Composition:
 * - ChatPromptTemplate (map / refine / final)
 * - BaseChatModel (ChatOpenAI in production)
 * - StringOutputParser for intermediate text
 * - RunnableSequence / RunnableLambda for orchestration
 * - Zod schema validation for structured final output
 */
export function createSummarizationPipeline(model: BaseChatModel) {
  const textParser = new StringOutputParser();

  const mapChain = RunnableSequence.from([
    mapChunkPrompt,
    model,
    textParser,
  ]).withConfig({ runName: "summarizer-map-chunk" });

  const refineChain = RunnableSequence.from([
    refinePrompt,
    model,
    textParser,
  ]).withConfig({ runName: "summarizer-refine-step" });

  const finalFromText = RunnableSequence.from([
    finalStructuredPrompt,
    model,
    textParser,
    RunnableLambda.from((text: string) => parseStructuredSummary(text)),
  ]).withConfig({ runName: "summarizer-final-structured" });

  async function finalize(input: {
    documentName: string;
    strategy: SummaryStrategy;
    length: SummaryLength;
    style: SummaryStyle;
    evidence: string;
  }): Promise<{
    summary: StructuredSummaryParsed;
    groundingWarnings: string[];
  }> {
    // Prefer ChatOpenAI.withStructuredOutput in production.
    // Skip for FakeListChatModel / test doubles that only return plain text JSON.
    const isChatOpenAI = model.constructor?.name === "ChatOpenAI";
    const maybeStructured = (
      model as BaseChatModel & {
        withStructuredOutput?: (
          schema: typeof structuredSummaryLlmSchema,
          options?: { name?: string; strict?: boolean },
        ) => {
          invoke: (messages: unknown) => Promise<unknown>;
        };
      }
    ).withStructuredOutput;

    let rawSummary: StructuredSummaryParsed | null = null;

    if (isChatOpenAI && typeof maybeStructured === "function") {
      try {
        const structuredModel = maybeStructured.call(
          model,
          structuredSummaryLlmSchema,
          {
            name: "document_summary",
            strict: true,
          },
        );
        const structuredChain = RunnableSequence.from([
          finalStructuredPrompt,
          RunnableLambda.from(async (promptValue) => {
            const messages =
              typeof (promptValue as { toChatMessages?: () => unknown })
                .toChatMessages === "function"
                ? (promptValue as { toChatMessages: () => unknown }).toChatMessages()
                : promptValue;
            return structuredModel.invoke(messages);
          }),
          RunnableLambda.from((value: unknown) => {
            const parsed = structuredSummarySchema.safeParse(value);
            if (!parsed.success) {
              throw new AppError(
                502,
                "Summarization model returned an invalid summary schema",
              );
            }
            return parsed.data;
          }),
        ]).withConfig({ runName: "summarizer-final-withStructuredOutput" });

        rawSummary = (await structuredChain.invoke({
          documentName: input.documentName,
          strategy: input.strategy,
          lengthGuidance: lengthGuidance(input.length),
          styleGuidance: styleGuidance(input.style),
          evidence: input.evidence,
        })) as StructuredSummaryParsed;
      } catch (error) {
        if (error instanceof AppError) throw error;
        // Fall back to JSON-in-text parsing if structured tools fail.
      }
    }

    if (!rawSummary) {
      rawSummary = await finalFromText.invoke({
        documentName: input.documentName,
        strategy: input.strategy,
        lengthGuidance: lengthGuidance(input.length),
        styleGuidance: styleGuidance(input.style),
        evidence: input.evidence,
      });
    }

    return finalizeWithGrounding(rawSummary, input.evidence);
  }

  return {
    mapChain,
    refineChain,
    finalFromText,

    async runDirect(docs: Document[], options: PipelineOptions) {
      const evidence = docs
        .map(
          (doc, index) =>
            `[chunk ${index + 1} | ${pageMeta(doc)}]\n${doc.pageContent}`,
        )
        .join("\n\n");
      return finalize({
        documentName: options.documentName,
        strategy: "direct",
        length: options.length,
        style: options.style,
        evidence,
      });
    },

    async runMapReduce(docs: Document[], options: PipelineOptions) {
      const partials = await mapWithConcurrency(
        docs,
        options.mapConcurrency,
        async (doc, index) => {
          const text = await mapChain.invoke({
            documentName: options.documentName,
            chunkIndex: index + 1,
            chunkTotal: docs.length,
            pageMeta: pageMeta(doc),
            chunkText: doc.pageContent,
            lengthGuidance: lengthGuidance(options.length),
            styleGuidance: styleGuidance(options.style),
          });
          // Keep a bounded source slice so the final pass can ground excerpts
          // instead of relying only on paraphrased intermediate summaries.
          const sourceSlice = doc.pageContent.slice(0, 1200);
          return [
            `[chunk ${index + 1} | ${pageMeta(doc)}]`,
            "Intermediate summary:",
            text,
            "Source excerpt:",
            sourceSlice,
          ].join("\n");
        },
      );

      return finalize({
        documentName: options.documentName,
        strategy: "map_reduce",
        length: options.length,
        style: options.style,
        evidence: partials.join("\n\n"),
      });
    },

    async runRefine(docs: Document[], options: PipelineOptions) {
      let working = "";
      const sourceAnchors: string[] = [];
      for (let index = 0; index < docs.length; index += 1) {
        const doc = docs[index];
        sourceAnchors.push(
          `[chunk ${index + 1} | ${pageMeta(doc)}]\n${doc.pageContent.slice(0, 800)}`,
        );
        if (index === 0) {
          working = await mapChain.invoke({
            documentName: options.documentName,
            chunkIndex: 1,
            chunkTotal: docs.length,
            pageMeta: pageMeta(doc),
            chunkText: doc.pageContent,
            lengthGuidance: lengthGuidance(options.length),
            styleGuidance: styleGuidance(options.style),
          });
        } else {
          working = await refineChain.invoke({
            documentName: options.documentName,
            currentSummary: working,
            chunkIndex: index + 1,
            pageMeta: pageMeta(doc),
            chunkText: doc.pageContent,
            lengthGuidance: lengthGuidance(options.length),
            styleGuidance: styleGuidance(options.style),
          });
        }
      }

      return finalize({
        documentName: options.documentName,
        strategy: "refine",
        length: options.length,
        style: options.style,
        evidence: [
          "Working summary:",
          working,
          "",
          "Source anchors:",
          sourceAnchors.join("\n\n"),
        ].join("\n"),
      });
    },
  };
}

export type SummarizationPipeline = ReturnType<typeof createSummarizationPipeline>;

/** Exported for tests that assert intermediate content parsing. */
export function coerceModelText(output: unknown): string {
  return extractTextContent(output);
}
