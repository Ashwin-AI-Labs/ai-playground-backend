import type { ResearchReport, ResearchSourceDto } from "./research.types";

export type ParsedResearchOutput = ResearchReport & {
  insufficientEvidence: boolean;
};

export function parseResearchModelOutput(
  raw: string,
): ParsedResearchOutput | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    const parsed = JSON.parse(candidate) as Partial<ParsedResearchOutput>;
    if (typeof parsed.executiveSummary !== "string") {
      return null;
    }

    const usedSourceIds = Array.isArray(parsed.usedSourceIds)
      ? parsed.usedSourceIds.filter(
          (value): value is number =>
            typeof value === "number" && Number.isInteger(value) && value > 0,
        )
      : [];

    return {
      insufficientEvidence: Boolean(parsed.insufficientEvidence),
      executiveSummary: parsed.executiveSummary.trim(),
      keyFindings: Array.isArray(parsed.keyFindings)
        ? parsed.keyFindings
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean)
        : [],
      detailedAnalysis:
        typeof parsed.detailedAnalysis === "string"
          ? parsed.detailedAnalysis.trim()
          : "",
      agreements:
        typeof parsed.agreements === "string" ? parsed.agreements.trim() : "",
      conflicts:
        typeof parsed.conflicts === "string" ? parsed.conflicts.trim() : "",
      limitations:
        typeof parsed.limitations === "string"
          ? parsed.limitations.trim()
          : "",
      conclusions:
        typeof parsed.conclusions === "string"
          ? parsed.conclusions.trim()
          : "",
      usedSourceIds,
    };
  } catch {
    return null;
  }
}

function scrubUnknownCitations(text: string, validIds: Set<number>): string {
  let result = text;
  for (const match of text.matchAll(/\[(\d+)\]/g)) {
    const id = Number(match[1]);
    if (!validIds.has(id)) {
      result = result.replaceAll(`[${id}]`, "");
    }
  }
  return result.replace(/\s{2,}/g, " ").trim();
}

export function validateResearchReport(input: {
  modelOutput: ParsedResearchOutput;
  sources: ResearchSourceDto[];
}): {
  report: ResearchReport;
  insufficientEvidence: boolean;
} {
  const validIds = new Set(input.sources.map((source) => source.id));
  const referenced = new Set<number>();

  const fields = [
    input.modelOutput.executiveSummary,
    input.modelOutput.detailedAnalysis,
    input.modelOutput.agreements,
    input.modelOutput.conflicts,
    input.modelOutput.limitations,
    input.modelOutput.conclusions,
    ...input.modelOutput.keyFindings,
  ];

  for (const field of fields) {
    for (const match of field.matchAll(/\[(\d+)\]/g)) {
      referenced.add(Number(match[1]));
    }
  }

  const used = [...new Set([...input.modelOutput.usedSourceIds, ...referenced])]
    .filter((id) => validIds.has(id))
    .sort((a, b) => a - b);

  const report: ResearchReport = {
    executiveSummary: scrubUnknownCitations(
      input.modelOutput.executiveSummary,
      validIds,
    ),
    keyFindings: input.modelOutput.keyFindings.map((item) =>
      scrubUnknownCitations(item, validIds),
    ),
    detailedAnalysis: scrubUnknownCitations(
      input.modelOutput.detailedAnalysis,
      validIds,
    ),
    agreements: scrubUnknownCitations(input.modelOutput.agreements, validIds),
    conflicts: scrubUnknownCitations(input.modelOutput.conflicts, validIds),
    limitations: scrubUnknownCitations(input.modelOutput.limitations, validIds),
    conclusions: scrubUnknownCitations(input.modelOutput.conclusions, validIds),
    usedSourceIds: used,
  };

  const insufficientEvidence =
    input.modelOutput.insufficientEvidence ||
    input.sources.length === 0 ||
    (!report.executiveSummary && used.length === 0);

  return { report, insufficientEvidence };
}

export type NormalizedSource = {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  publishedAt: string | null;
  provider: string;
  score: number | null;
};

function authorityBoost(domain: string, url: string): number {
  const host = domain.toLowerCase();
  let boost = 0;
  if (host.endsWith(".gov") || host.endsWith(".gov.uk")) boost += 0.35;
  if (host.endsWith(".edu")) boost += 0.25;
  if (
    host.includes("docs.") ||
    host.startsWith("developer.") ||
    /\/docs(\/|$)/i.test(url)
  ) {
    boost += 0.2;
  }
  if (
    host === "react.dev" ||
    host === "angular.dev" ||
    host === "nodejs.org" ||
    host === "postgresql.org" ||
    host === "mongodb.com" ||
    host.endsWith(".openai.com") ||
    host === "platform.openai.com"
  ) {
    boost += 0.25;
  }
  return boost;
}

/** Prefer authoritative domains while preserving provider relevance signals. */
export function rankSources(sources: NormalizedSource[]): NormalizedSource[] {
  return [...sources].sort((a, b) => {
    const scoreA = (a.score ?? 0) + authorityBoost(a.domain, a.url);
    const scoreB = (b.score ?? 0) + authorityBoost(b.domain, b.url);
    return scoreB - scoreA;
  });
}

export function normalizeAndDeduplicateSources(
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    publishedAt: string | null;
    provider: string;
    score?: number | null;
  }>,
): NormalizedSource[] {
  const seen = new Set<string>();
  const output: NormalizedSource[] = [];

  for (const item of results) {
    let canonical: string;
    let domain: string;
    try {
      const url = new URL(item.url);
      url.hash = "";
      [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "fbclid",
        "gclid",
      ].forEach((key) => url.searchParams.delete(key));
      canonical = url.toString();
      domain = url.hostname.replace(/^www\./, "");
    } catch {
      continue;
    }

    const key = canonical.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({
      title: item.title || domain,
      url: canonical,
      domain,
      snippet: item.snippet,
      publishedAt: item.publishedAt,
      provider: item.provider,
      score: typeof item.score === "number" ? item.score : null,
    });
  }

  return rankSources(output);
}
