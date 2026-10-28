# Project 6 — AI Document Summarizer (LangChain.js)

Production-minded document summarization using **real LangChain.js** abstractions — not a thin OpenAI SDK wrapper labeled as LangChain.

## Why LangChain.js

- `Document` objects carry source/page metadata through the pipeline
- `RecursiveCharacterTextSplitter` performs real chunking with overlap
- `ChatPromptTemplate` + `RunnableSequence` compose map / refine / final steps
- `ChatOpenAI` (`@langchain/openai`) invokes the configured model
- Structured results are validated with Zod on the backend

## Packages (installed versions)

| Package | Role |
| --- | --- |
| `@langchain/core` | `Document`, `ChatPromptTemplate`, `RunnableSequence`, `RunnableLambda`, `StringOutputParser`, testing fakes |
| `@langchain/openai` | `ChatOpenAI` |
| `@langchain/textsplitters` | `RecursiveCharacterTextSplitter` |

Exact versions are pinned in `package-lock.json` (see `package.json` dependencies).

## Pipeline composition

```text
upload → extractDocumentText (existing pdf-parse / UTF-8)
      → buildLangchainDocuments (Document[])
      → RecursiveCharacterTextSplitter.splitDocuments
      → strategy:
           direct      → final structured chain
           map_reduce  → mapChain.map (bounded concurrency) → final
           refine      → map first chunk → refineChain loop → final
      → Zod validate StructuredSummary
      → persist document_summaries
```

### Classes / runnables used

- `Document` (`@langchain/core/documents`)
- `RecursiveCharacterTextSplitter` (`@langchain/textsplitters`)
- `ChatPromptTemplate` (`@langchain/core/prompts`)
- `RunnableSequence`, `RunnableLambda` (`@langchain/core/runnables`)
- `StringOutputParser` (`@langchain/core/output_parsers`)
- `ChatOpenAI` (`@langchain/openai`) — production model
- `FakeListChatModel` (`@langchain/core/utils/testing`) — unit tests only
- Optional `model.withStructuredOutput(zodSchema)` when supported; otherwise JSON + Zod parse

### Strategies

| Strategy | Behavior | Tradeoff |
| --- | --- | --- |
| `direct` | One structured pass over all chunks | Best fidelity for short docs; can exceed context on long docs |
| `map_reduce` | Summarize chunks in parallel (bounded), then combine | Scales to long docs; may lose subtle cross-chunk nuance |
| `refine` | Seed summary, update sequentially with each chunk | Preserves running narrative; early-chunk bias possible |
| `auto` | `direct` when short enough, else `map_reduce` | Sensible default |

## API

- `POST /api/document-summarizer/summarize` multipart `file` + `length` / `style` / `strategy`
- `GET /api/document-summarizer/summaries`
- `GET /api/document-summarizer/summaries/:id`
- `DELETE /api/document-summarizer/summaries/:id`
- `GET /api/document-summarizer/summaries/:id/export`

## Migration

`0011_create_document_summaries` — summary metadata + JSON output (no original file bytes).

## Environment

Uses existing `OPENAI_API_KEY` / `OPENAI_MODEL`. Optional overrides:

- `SUMMARIZER_MODEL`
- `SUMMARIZER_MAX_FILE_SIZE_MB` (default 10)
- `SUMMARIZER_CHUNK_SIZE` / `SUMMARIZER_CHUNK_OVERLAP`
- `SUMMARIZER_MAX_CHUNKS`
- `SUMMARIZER_DIRECT_MAX_CHARS`
- `SUMMARIZER_MAP_CONCURRENCY`
- `SUMMARIZER_TIMEOUT_MS`

## Tests

```bash
npm test -- src/modules/document-summarizer/summarizer.test.ts
npm run typecheck
```

## Faithfulness & grounding

- Prompts forbid claim-strengthening (e.g. “submit to manager” ≠ “manager approval”).
- Key points are grounded objects: `{ text, sourceExcerpt, page }`.
- Backend soft-validates excerpts against the evidence corpus and clears unsupported quotes.
- `interpretations` is a separate field for cautious inferences.
- Map-reduce/refine keep bounded source anchors so final structuring is not paraphrase-only.

## Limitations

- Requires `AI_PROVIDER=openai` and a configured OpenAI key for live runs.
- Scanned PDFs without extractable text are rejected (no OCR).
- Excerpt grounding checks quote support; it does not independently rewrite paraphrased claims.
- Access model matches the playground (no multi-user auth).
