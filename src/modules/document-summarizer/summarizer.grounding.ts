import type { StructuredSummaryParsed } from "./summarizer.schemas";
import type { GroundedKeyPoint } from "./summarizer.types";

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Soft grounding check: an excerpt is supported when a substantial contiguous
 * substring appears in the evidence corpus (case/punctuation insensitive).
 * This does not independently fact-check paraphrases — it only validates quotes.
 */
export function excerptSupportedByEvidence(
  excerpt: string,
  evidence: string,
): boolean {
  const needle = normalizeForMatch(excerpt);
  const haystack = normalizeForMatch(evidence);
  if (!needle || !haystack) return false;
  if (needle.length < 12) {
    return haystack.includes(needle);
  }
  if (haystack.includes(needle)) return true;

  // Allow minor truncation by checking a long contiguous window.
  const window = Math.min(80, needle.length);
  for (let i = 0; i + window <= needle.length; i += Math.max(10, Math.floor(window / 4))) {
    const slice = needle.slice(i, i + window);
    if (slice.length >= 12 && haystack.includes(slice)) {
      return true;
    }
  }
  return false;
}

export function normalizeKeyPoints(
  keyPoints: Array<
    | string
    | {
        text: string;
        sourceExcerpt?: string | null;
        page?: number | null;
      }
  >,
): GroundedKeyPoint[] {
  return keyPoints.map((item) => {
    if (typeof item === "string") {
      return { text: item.trim(), sourceExcerpt: null, page: null };
    }
    return {
      text: item.text.trim(),
      sourceExcerpt: item.sourceExcerpt?.trim() || null,
      page:
        typeof item.page === "number" && Number.isFinite(item.page)
          ? item.page
          : null,
    };
  });
}

/**
 * Validate source excerpts against the evidence actually passed to the model.
 * Unsupported excerpts are cleared (claim text retained) and a warning is added.
 * Does not rewrite paraphrased claim text — prompts must prevent strengthening.
 */
/**
 * Detect common obligation-strengthening paraphrases when the evidence does not
 * support the stronger wording. Emits warnings; does not silently rewrite prose.
 */
export function detectClaimStrengthening(
  summary: StructuredSummaryParsed,
  evidence: string,
): string[] {
  const warnings: string[] = [];
  const evidenceNorm = normalizeForMatch(evidence);
  const summaryText = [
    summary.executiveSummary,
    summary.summary,
    ...summary.keyPoints.map((point) => point.text),
    ...summary.decisions,
    ...summary.actionItems.map((item) => item.text),
    ...(summary.interpretations ?? []),
  ].join("\n");

  const checks: Array<{
    summaryPattern: RegExp;
    evidenceMustMatch?: RegExp;
    evidenceMustNotBeOnly?: RegExp;
    message: string;
  }> = [
    {
      summaryPattern: /\b(manager|advance)\s+approval\b|\brequir(?:e|es|ed)\s+approval\b/i,
      evidenceMustMatch: /\bapprov/i,
      message:
        "Summary uses “approval” wording that was not found in the source. The source may only require submission/notification — treat approval language cautiously.",
    },
    {
      summaryPattern: /\bmust get (?:manager )?approval\b/i,
      evidenceMustMatch: /\bapprov/i,
      message:
        "Summary strengthens a requirement to “must get approval” without matching source wording.",
    },
  ];

  for (const check of checks) {
    if (!check.summaryPattern.test(summaryText)) continue;
    if (check.evidenceMustMatch && check.evidenceMustMatch.test(evidenceNorm)) {
      continue;
    }
    warnings.push(check.message);
  }

  // Soften known unsafe phrase in structured fields when evidence only has submit.
  if (
    /\bapprov/i.test(summaryText) &&
    !/\bapprov/i.test(evidenceNorm) &&
    /\bsubmit/.test(evidenceNorm)
  ) {
    warnings.push(
      "Source describes submission to a manager, not explicit approval. Prefer “submit to manager” wording.",
    );
  }

  return warnings;
}

function softenApprovalLanguage(text: string, evidence: string): string {
  const evidenceNorm = normalizeForMatch(evidence);
  if (/\bapprov/i.test(evidenceNorm)) return text;
  if (!/\bsubmit/.test(evidenceNorm)) return text;
  return text
    .replace(/\brequire(?:s|d)?\s+advance\s+approval\b/gi, "must be submitted in advance")
    .replace(/\brequire(?:s|d)?\s+approval\b/gi, "must be submitted")
    .replace(/\bmanager\s+approval\b/gi, "submission to the manager")
    .replace(/\badvance\s+approval\b/gi, "advance submission");
}

export function groundStructuredSummary(
  summary: StructuredSummaryParsed,
  evidence: string,
): { summary: StructuredSummaryParsed; warnings: string[] } {
  const warnings: string[] = [];
  const keyPoints = normalizeKeyPoints(summary.keyPoints).map((point) => {
    if (!point.sourceExcerpt) {
      return point;
    }
    if (excerptSupportedByEvidence(point.sourceExcerpt, evidence)) {
      return point;
    }
    warnings.push(
      `Removed an unsupported source excerpt for key point: “${point.text.slice(0, 80)}”`,
    );
    return { ...point, sourceExcerpt: null };
  });

  const missingExcerpts = keyPoints.filter((point) => !point.sourceExcerpt).length;
  if (keyPoints.length > 0 && missingExcerpts === keyPoints.length) {
    warnings.push(
      "Key points were returned without verifiable source excerpts. Treat them as paraphrases, not quotations.",
    );
  }

  const softened: StructuredSummaryParsed = {
    ...summary,
    executiveSummary: softenApprovalLanguage(summary.executiveSummary, evidence),
    summary: softenApprovalLanguage(summary.summary, evidence),
    keyPoints: keyPoints.map((point) => ({
      ...point,
      text: softenApprovalLanguage(point.text, evidence),
    })),
    decisions: summary.decisions.map((item) =>
      softenApprovalLanguage(item, evidence),
    ),
    actionItems: summary.actionItems.map((item) => ({
      ...item,
      text: softenApprovalLanguage(item.text, evidence),
    })),
    interpretations: (summary.interpretations ?? [])
      .map((item) => item.trim())
      .filter(Boolean),
  };

  warnings.push(...detectClaimStrengthening(softened, evidence));

  return {
    summary: softened,
    warnings,
  };
}

export function formatChunkCount(count: number): string {
  return count === 1 ? "1 chunk" : `${count} chunks`;
}
