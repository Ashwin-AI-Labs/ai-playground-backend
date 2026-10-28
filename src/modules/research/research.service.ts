import { env, hasTavilyApiKey } from "../../config/env";
import { AppError } from "../../middleware/error-handler";
import {
  getAiProviderBundle,
  type TextGenerationProvider,
} from "../../services/ai";
import {
  getWebSearchProvider,
  type WebSearchProvider,
} from "../../services/web-search";
import { fetchPublicPage } from "../../services/web-fetch";
import {
  normalizeAndDeduplicateSources,
  parseResearchModelOutput,
  validateResearchReport,
} from "./research.citations";
import {
  buildResearchUserPrompt,
  RESEARCH_SYSTEM_INSTRUCTIONS,
} from "./research.prompt";
import * as repository from "./research.repository";
import type {
  ResearchRunResult,
  ResearchSessionSummary,
  ResearchSourceDto,
} from "./research.types";

function deriveTitle(question: string): string {
  const cleaned = question.replace(/\s+/g, " ").trim();
  return cleaned.length <= 90 ? cleaned : `${cleaned.slice(0, 87)}...`;
}

function toSummary(
  session: repository.ResearchSessionRecord,
): ResearchSessionSummary {
  return {
    id: session.id,
    title: session.title,
    question: session.question,
    status: session.status,
    sourceCount: session.source_count,
    createdAt: session.created_at.toISOString(),
    updatedAt: session.updated_at.toISOString(),
  };
}

async function proposeFollowUpQueries(
  question: string,
  text: TextGenerationProvider,
): Promise<string[]> {
  const max = env.RESEARCH_MAX_FOLLOWUP_QUERIES;
  if (max <= 0) return [];

  try {
    const raw = await text.generateText({
      model: env.RESEARCH_MODEL?.trim() || undefined,
      instructions:
        "Propose additional web search queries for the research question. Return JSON only: {\"queries\": string[]}. Max 2 short queries. No commentary.",
      messages: [
        {
          role: "user",
          content: `Research question: ${question}`,
        },
      ],
    });
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const parsed = JSON.parse(fenced?.[1]?.trim() ?? raw.trim()) as {
      queries?: unknown;
    };
    if (!Array.isArray(parsed.queries)) return [];
    return parsed.queries
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length >= 3 && item.length <= 200)
      .slice(0, max);
  } catch {
    return [];
  }
}

export function createResearchService(deps?: {
  search?: WebSearchProvider;
  text?: TextGenerationProvider;
}) {
  const resolveSearch = () => deps?.search ?? getWebSearchProvider();
  const resolveText = () => deps?.text ?? getAiProviderBundle().text;

  return {
    async previewSearch(input: {
      query: string;
      maxResults?: number;
    }) {
      const search = resolveSearch();
      const results = await search.search({
        query: input.query,
        maxResults: input.maxResults ?? env.RESEARCH_MAX_RESULTS,
      });
      return normalizeAndDeduplicateSources(results).slice(
        0,
        input.maxResults ?? env.RESEARCH_MAX_RESULTS,
      );
    },

    async run(input: {
      question: string;
      maxResults?: number;
      recencyDays?: number | null;
      includeDomains?: string[];
    }): Promise<ResearchRunResult> {
      const started = Date.now();
      const question = input.question.trim();
      const maxResults = input.maxResults ?? env.RESEARCH_MAX_RESULTS;

      const search = resolveSearch();
      const text = resolveText();

      // Fail fast for the default Tavily provider before persisting a session.
      // Injected test mocks may omit a real API key.
      if (search.name === "tavily" && !hasTavilyApiKey()) {
        throw new AppError(
          503,
          "Web search is not configured. Set TAVILY_API_KEY in the backend environment. Get a key at https://tavily.com",
        );
      }

      const session = await repository.createSession({
        title: deriveTitle(question),
        question,
      });

      try {

        const queries = [question];
        const followUps = await proposeFollowUpQueries(question, text);
        for (const followUp of followUps) {
          if (!queries.includes(followUp)) {
            queries.push(followUp);
          }
        }

        const rawResults = [];
        for (const query of queries) {
          const batch = await search.search({
            query,
            maxResults,
            recencyDays: input.recencyDays,
            includeDomains: input.includeDomains,
          });
          rawResults.push(...batch);
        }

        const normalized = normalizeAndDeduplicateSources(rawResults).slice(
          0,
          maxResults,
        );

        const sources: ResearchSourceDto[] = [];
        for (let index = 0; index < normalized.length; index += 1) {
          const item = normalized[index];
          const fetched = await fetchPublicPage(item.url);
          const excerpt =
            fetched.fetchStatus === "fetched" && fetched.text
              ? fetched.text.slice(0, 3000)
              : item.snippet.slice(0, 1500);

          sources.push({
            id: index + 1,
            title: fetched.title || item.title,
            url: fetched.finalUrl || item.url,
            domain: item.domain,
            snippet: item.snippet,
            excerpt,
            publishedAt: item.publishedAt,
            retrievedAt: new Date().toISOString(),
            fetchStatus: fetched.fetchStatus,
            provider: item.provider,
          });
        }

        await repository.replaceSources(session.id, sources);

        if (sources.length === 0) {
          const durationMs = Date.now() - started;
          await repository.updateSession(session.id, {
            status: "completed",
            insufficientEvidence: true,
            report: {
              executiveSummary:
                "No usable web sources were found for this question.",
              keyFindings: [],
              detailedAnalysis: "",
              agreements: "",
              conflicts: "",
              limitations:
                "Search returned no results or all results were filtered.",
              conclusions: "Try a more specific query or different domains.",
              usedSourceIds: [],
            },
            durationMs,
            searchQueryCount: queries.length,
            searchQueries: queries,
            sourceCount: 0,
            errorMessage: null,
          });

          return {
            sessionId: session.id,
            question,
            status: "completed",
            insufficientEvidence: true,
            report: {
              executiveSummary:
                "No usable web sources were found for this question.",
              keyFindings: [],
              detailedAnalysis: "",
              agreements: "",
              conflicts: "",
              limitations:
                "Search returned no results or all results were filtered.",
              conclusions: "Try a more specific query or different domains.",
              usedSourceIds: [],
            },
            sources: [],
            searchQueries: queries,
            durationMs,
            errorMessage: null,
          };
        }

        const raw = await text.generateText({
          model: env.RESEARCH_MODEL?.trim() || undefined,
          instructions: RESEARCH_SYSTEM_INSTRUCTIONS,
          messages: [
            {
              role: "user",
              content: buildResearchUserPrompt({
                question,
                sources,
                searchQueries: queries,
              }),
            },
          ],
        });

        const parsed = parseResearchModelOutput(raw);
        if (!parsed) {
          throw new AppError(
            502,
            "Research model returned unusable structured output",
          );
        }

        const validated = validateResearchReport({
          modelOutput: parsed,
          sources,
        });

        const durationMs = Date.now() - started;
        await repository.updateSession(session.id, {
          status: "completed",
          report: validated.report,
          insufficientEvidence: validated.insufficientEvidence,
          durationMs,
          searchQueryCount: queries.length,
          searchQueries: queries,
          sourceCount: sources.length,
          errorMessage: null,
        });

        return {
          sessionId: session.id,
          question,
          status: "completed",
          insufficientEvidence: validated.insufficientEvidence,
          report: validated.report,
          sources,
          searchQueries: queries,
          durationMs,
          errorMessage: null,
        };
      } catch (error) {
        const message =
          error instanceof AppError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Research failed";
        const durationMs = Date.now() - started;
        await repository.updateSession(session.id, {
          status: "failed",
          errorMessage: message,
          durationMs,
        });

        if (error instanceof AppError) {
          throw error;
        }
        throw new AppError(502, message);
      }
    },

    async listSessions(input: { limit: number; offset: number }) {
      const result = await repository.listSessions(input);
      return {
        sessions: result.sessions.map(toSummary),
        total: result.total,
        limit: input.limit,
        offset: input.offset,
      };
    },

    async getSession(sessionId: string): Promise<ResearchRunResult> {
      const session = await repository.getSessionById(sessionId);
      if (!session) {
        throw new AppError(404, "Research session not found");
      }
      const sources = await repository.listSources(sessionId);
      return {
        sessionId: session.id,
        question: session.question,
        status: session.status,
        insufficientEvidence: session.insufficient_evidence,
        report: session.report,
        sources,
        searchQueries: session.search_queries,
        durationMs: session.duration_ms ?? 0,
        errorMessage: session.error_message,
      };
    },

    async deleteSession(sessionId: string): Promise<void> {
      const deleted = await repository.deleteSession(sessionId);
      if (!deleted) {
        throw new AppError(404, "Research session not found");
      }
    },
  };
}

export const researchService = createResearchService();
