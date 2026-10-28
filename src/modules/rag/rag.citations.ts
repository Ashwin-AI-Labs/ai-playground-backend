import type { RagCitationDto, RagModelOutput, RetrievedEvidence } from "./rag.types";

export function parseRagModelOutput(raw: string): RagModelOutput | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    const parsed = JSON.parse(candidate) as Partial<RagModelOutput>;
    if (typeof parsed.answer !== "string") {
      return null;
    }
    const usedCitationIds = Array.isArray(parsed.usedCitationIds)
      ? parsed.usedCitationIds.filter(
          (value): value is number =>
            typeof value === "number" && Number.isInteger(value) && value > 0,
        )
      : [];

    return {
      insufficientEvidence: Boolean(parsed.insufficientEvidence),
      answer: parsed.answer.trim(),
      usedCitationIds,
    };
  } catch {
    return null;
  }
}

/**
 * Keep only citations that were actually retrieved and referenced.
 * Strip fabricated citation markers from the answer text.
 */
export function validateCitations(input: {
  modelOutput: RagModelOutput;
  evidence: RetrievedEvidence[];
}): {
  answer: string;
  citations: RagCitationDto[];
  insufficientEvidence: boolean;
} {
  const evidenceById = new Map(
    input.evidence.map((item) => [item.citationId, item]),
  );

  const referencedFromText = new Set<number>();
  for (const match of input.modelOutput.answer.matchAll(/\[(\d+)\]/g)) {
    referencedFromText.add(Number(match[1]));
  }

  const requestedIds = new Set<number>([
    ...input.modelOutput.usedCitationIds,
    ...referencedFromText,
  ]);

  const validIds = [...requestedIds]
    .filter((id) => evidenceById.has(id))
    .sort((a, b) => a - b);

  let answer = input.modelOutput.answer;
  for (const match of answer.matchAll(/\[(\d+)\]/g)) {
    const id = Number(match[1]);
    if (!evidenceById.has(id)) {
      answer = answer.replaceAll(`[${id}]`, "");
    }
  }
  answer = answer.replace(/\s{2,}/g, " ").trim();

  const citations: RagCitationDto[] = validIds.map((id) => {
    const item = evidenceById.get(id)!;
    return {
      id,
      documentId: item.documentId,
      filename: item.filename,
      chunkId: item.chunkId,
      pageNumber: item.pageStart,
      pageEnd: item.pageEnd,
      pageAvailable: item.pageStart !== null,
      excerpt: item.excerpt,
      similarity: Number(item.similarity.toFixed(6)),
    };
  });

  const insufficientEvidence =
    input.modelOutput.insufficientEvidence ||
    input.evidence.length === 0 ||
    (citations.length === 0 &&
      /insufficient|not enough|cannot find|no (relevant )?information|do not contain/i.test(
        answer,
      ));

  if (!answer) {
    return {
      answer:
        "I could not find enough supported evidence in the selected documents to answer that question.",
      citations: [],
      insufficientEvidence: true,
    };
  }

  return {
    answer,
    citations,
    insufficientEvidence,
  };
}

export function truncateEvidence(
  evidence: RetrievedEvidence[],
  maxChars: number,
): RetrievedEvidence[] {
  const kept: RetrievedEvidence[] = [];
  let used = 0;
  for (const item of evidence) {
    const cost = item.excerpt.length + 80;
    if (kept.length > 0 && used + cost > maxChars) {
      break;
    }
    kept.push(item);
    used += cost;
  }
  return kept;
}
