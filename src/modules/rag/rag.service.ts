import { env } from "../../config/env";
import { AppError } from "../../middleware/error-handler";
import {
  getAiProviderBundle,
  type EmbeddingProvider,
  type TextGenerationProvider,
} from "../../services/ai";
import { embedQuery, getEmbeddingProvider } from "../../services/embeddings";
import { searchSimilarChunks } from "../../services/vector-search";
import {
  parseRagModelOutput,
  truncateEvidence,
  validateCitations,
} from "./rag.citations";
import {
  buildRagUserPrompt,
  RAG_SYSTEM_INSTRUCTIONS,
} from "./rag.prompt";
import * as repository from "./rag.repository";
import type {
  RagAskResult,
  RagMessageDto,
  RagSessionDetailDto,
  RagSessionSummaryDto,
  RetrievedEvidence,
} from "./rag.types";

function toSessionSummary(
  session: repository.RagSessionRecord,
): RagSessionSummaryDto {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.created_at.toISOString(),
    updatedAt: session.updated_at.toISOString(),
  };
}

function deriveTitle(question: string): string {
  const cleaned = question.replace(/\s+/g, " ").trim();
  return cleaned.length <= 80 ? cleaned : `${cleaned.slice(0, 77)}...`;
}

const INSUFFICIENT_ANSWER =
  "I could not find enough supported evidence in the selected documents to answer that question.";

export function createRagService(deps?: {
  embeddings?: EmbeddingProvider | null;
  text?: TextGenerationProvider | null;
}) {
  const resolveEmbeddings = () =>
    deps?.embeddings === undefined
      ? getEmbeddingProvider()
      : deps.embeddings
        ? deps.embeddings
        : (() => {
            throw new AppError(
              503,
              "Embeddings are not available. Set AI_PROVIDER=openai and OPENAI_API_KEY.",
            );
          })();

  const resolveText = (): TextGenerationProvider => {
    if (deps?.text) {
      return deps.text;
    }
    if (deps?.text === null) {
      throw new AppError(503, "Text generation provider is not configured.");
    }
    return getAiProviderBundle().text;
  };

  return {
    async ask(input: {
      question: string;
      documentIds: string[];
      sessionId?: string | null;
      topK?: number;
    }): Promise<RagAskResult> {
      const question = input.question.trim();
      if (!question) {
        throw new AppError(400, "Question cannot be empty");
      }

      const topK = input.topK ?? env.RAG_DEFAULT_TOP_K;
      const minSimilarity = env.RAG_SIMILARITY_THRESHOLD;
      const documentIds = input.documentIds ?? [];

      let session =
        input.sessionId != null
          ? await repository.getSessionById(input.sessionId)
          : null;

      if (input.sessionId && !session) {
        throw new AppError(404, "RAG session not found");
      }

      if (!session) {
        session = await repository.createSession(deriveTitle(question));
      }

      await repository.addMessage({
        sessionId: session.id,
        role: "user",
        content: question,
      });

      const eligibleCount = await repository.countCompletedDocuments(
        documentIds.length > 0 ? documentIds : undefined,
      );

      if (eligibleCount === 0) {
        const answer = INSUFFICIENT_ANSWER;
        await repository.addMessage({
          sessionId: session.id,
          role: "assistant",
          content: answer,
          insufficientEvidence: true,
        });
        return {
          sessionId: session.id,
          answer,
          insufficientEvidence: true,
          citations: [],
          retrieval: {
            returnedChunks: 0,
            topK,
            minSimilarity,
            documentFilterApplied: documentIds.length > 0,
          },
        };
      }

      const queryEmbedding = await embedQuery(question, resolveEmbeddings());
      const hits = await searchSimilarChunks({
        queryEmbedding,
        limit: topK,
        documentIds: documentIds.length > 0 ? documentIds : undefined,
        minSimilarity,
      });

      let evidence: RetrievedEvidence[] = hits.map((hit, index) => ({
        citationId: index + 1,
        documentId: hit.documentId,
        filename: hit.originalFilename || hit.filename,
        chunkId: hit.chunkId,
        pageStart: hit.pageStart,
        pageEnd: hit.pageEnd,
        excerpt: hit.content,
        similarity: hit.similarity,
      }));

      evidence = truncateEvidence(evidence, env.RAG_MAX_CONTEXT_CHARS);

      if (evidence.length === 0) {
        const answer = INSUFFICIENT_ANSWER;
        await repository.addMessage({
          sessionId: session.id,
          role: "assistant",
          content: answer,
          insufficientEvidence: true,
        });
        return {
          sessionId: session.id,
          answer,
          insufficientEvidence: true,
          citations: [],
          retrieval: {
            returnedChunks: 0,
            topK,
            minSimilarity,
            documentFilterApplied: documentIds.length > 0,
          },
        };
      }

      const history = await repository.listRecentHistory(session.id, 6);
      // Exclude the user message we just inserted from prompt history duplication noise —
      // keep prior turns only.
      const priorHistory = history.slice(0, -1);

      const textProvider = resolveText();
      const model =
        env.RAG_MODEL?.trim() ||
        undefined;

      const raw = await textProvider.generateText({
        model,
        instructions: RAG_SYSTEM_INSTRUCTIONS,
        messages: [
          {
            role: "user",
            content: buildRagUserPrompt({
              question,
              evidence,
              history: priorHistory,
            }),
          },
        ],
      });

      const parsed = parseRagModelOutput(raw);
      const validated = parsed
        ? validateCitations({ modelOutput: parsed, evidence })
        : {
            answer:
              "The model returned an unusable response. Please try asking again.",
            citations: [],
            insufficientEvidence: true,
          };

      const assistantMessage = await repository.addMessage({
        sessionId: session.id,
        role: "assistant",
        content: validated.answer,
        insufficientEvidence: validated.insufficientEvidence,
      });

      if (validated.citations.length > 0) {
        await repository.insertCitations(
          assistantMessage.id,
          validated.citations,
        );
      }

      return {
        sessionId: session.id,
        answer: validated.answer,
        insufficientEvidence: validated.insufficientEvidence,
        citations: validated.citations,
        retrieval: {
          returnedChunks: evidence.length,
          topK,
          minSimilarity,
          documentFilterApplied: documentIds.length > 0,
        },
      };
    },

    async listSessions(limit: number): Promise<RagSessionSummaryDto[]> {
      const sessions = await repository.listSessions(limit);
      return sessions.map(toSessionSummary);
    },

    async getSession(sessionId: string): Promise<RagSessionDetailDto> {
      const session = await repository.getSessionById(sessionId);
      if (!session) {
        throw new AppError(404, "RAG session not found");
      }

      const messages = await repository.listMessages(sessionId);
      const citationRows = await repository.listCitationsForMessages(
        messages.map((message) => message.id),
      );
      const citationsByMessage = new Map<string, typeof citationRows>();
      for (const row of citationRows) {
        const list = citationsByMessage.get(row.message_id) ?? [];
        list.push(row);
        citationsByMessage.set(row.message_id, list);
      }

      const messageDtos: RagMessageDto[] = messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        insufficientEvidence: message.insufficient_evidence,
        citations:
          citationsByMessage
            .get(message.id)
            ?.map((row) => row.citation) ?? [],
        createdAt: message.created_at.toISOString(),
      }));

      return {
        session: toSessionSummary(session),
        messages: messageDtos,
      };
    },

    async deleteSession(sessionId: string): Promise<void> {
      const deleted = await repository.deleteSession(sessionId);
      if (!deleted) {
        throw new AppError(404, "RAG session not found");
      }
    },
  };
}

export const ragService = createRagService();
