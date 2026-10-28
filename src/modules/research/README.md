# Project 5 — AI Research Assistant

Server-side research pipeline with live web search (Tavily), SSRF-safe page fetch, LLM synthesis, citation validation, and PostgreSQL session persistence.

## Architecture

```text
POST /api/research/run
  → validate input
  → optional follow-up search queries (bounded)
  → Tavily search (backend-only key)
  → normalize / dedupe / rank sources
  → fetchPublicPage (http/https, block private nets, redirect revalidation)
  → LLM structured report
  → validate citation IDs against source registry
  → persist session + sources
```

Shared providers:

- `services/web-search` — `WebSearchProvider` + Tavily adapter
- `services/web-fetch` — URL safety + bounded HTML text extraction
- `services/ai` — existing text generation provider

## Environment

| Variable | Purpose |
| --- | --- |
| `TAVILY_API_KEY` | Required for live search. Get a key at https://tavily.com. Missing key → HTTP 503 with a clear message. |
| `RESEARCH_MAX_RESULTS` | Default max sources (1–10, default 6) |
| `RESEARCH_MAX_FOLLOWUP_QUERIES` | Extra LLM-proposed searches (0–3, default 2) |
| `RESEARCH_FETCH_TIMEOUT_MS` | Page fetch timeout (default 8000) |
| `RESEARCH_MAX_PAGE_BYTES` | Max downloaded page size (default 500000) |
| `RESEARCH_MODEL` | Optional override; defaults to `OPENAI_MODEL` |

Never put Tavily or OpenAI keys in the frontend.

## Migrations

- `0009_create_research_sessions` — `research_sessions`, `research_sources`
- `0010_add_research_search_queries` — `search_queries JSONB` on sessions

## API

### `POST /api/research/run`

```json
{
  "question": "Compare React and Angular for enterprise apps",
  "maxResults": 6,
  "recencyDays": 90,
  "includeDomains": ["react.dev", "angular.dev"]
}
```

Response `201`:

```json
{
  "success": true,
  "data": {
    "sessionId": "1",
    "question": "...",
    "status": "completed",
    "insufficientEvidence": false,
    "report": { "executiveSummary": "...", "usedSourceIds": [1] },
    "sources": [{ "id": 1, "url": "https://...", "fetchStatus": "fetched" }],
    "searchQueries": ["..."],
    "durationMs": 1234,
    "errorMessage": null
  }
}
```

### Other endpoints

- `POST /api/research/search` — search preview (normalized results only)
- `GET /api/research/sessions?limit=&offset=`
- `GET /api/research/sessions/:id`
- `DELETE /api/research/sessions/:id`

IDs are PostgreSQL `BIGINT` values serialized as decimal strings.

## Citations & security

- Trusted source registry is built only from search + fetch results.
- Model-emitted `[n]` markers and `usedSourceIds` are filtered to known IDs; fabricated IDs are removed.
- Webpage content is treated as untrusted evidence (prompt-injection resistant instructions).
- Fetch blocks localhost, private, link-local, and metadata hosts; revalidates redirects; limits size/timeout/content-type.
- Access model matches the rest of the playground: no multi-user auth; anyone who can reach the API can read/delete research sessions.

## Tests

```bash
npm test -- src/modules/research/research.test.ts
npm run typecheck
```

Live Tavily/OpenAI calls are mocked in automated tests.

## Limitations

- Live search is unverified until `TAVILY_API_KEY` is set.
- Page fetch falls back to snippets when blocked, timed out, or non-HTML.
- Citation validation checks ID membership (and scrubbing); it does not independently fact-check claims against evidence.
- Synchronous run with bounded result counts; long topics may time out at the HTTP client if the provider is slow.
