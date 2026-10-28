# AI Playground Backend

Express + TypeScript REST API and **main entry point** for running the full AI Playground stack with Docker Compose.

The frontend lives in the sibling repository `../ai-playground-frontend`. Both remain independent Git repositories. Compose in this directory orchestrates frontend, backend, PostgreSQL, Adminer, and a one-shot migration service.

## Technology stack

| Layer | Stack |
| --- | --- |
| Backend | Node.js, Express.js, TypeScript, Zod, OpenAI SDK |
| Frontend | React, Vite, TypeScript, Tailwind CSS, React Router |
| Database | PostgreSQL 16 + pgvector (`pgvector/pgvector:pg16`) |
| Admin | Adminer |
| Runtime | Docker Engine + Docker Compose CLI |

## Architecture

Feature-based modular monolith. Each feature owns routes, controllers, services, repositories, schemas, and tests. Shared infrastructure (config, database pool, migrations, AI providers, middleware) lives outside feature modules.

```text
AI-PROJECT-OCT-2026/
├── ai-playground-frontend/   # independent Git repo (React UI)
└── ai-playground-backend/    # independent Git repo + Compose entry point
    ├── docker-compose.yml
    ├── .env.example
    ├── Dockerfile
    └── src/
        ├── app.ts / index.ts
        ├── api/router.ts          # mounts module routers under /api
        ├── config/env.ts
        ├── database/              # pool, migrations, ID helpers
        ├── middleware/
        ├── services/ai/           # provider interface, factory, OpenAI/Anthropic
        ├── services/embeddings/
        ├── services/document-processing/
        ├── services/vector-search/
        ├── modules/
        │   ├── chat/
        │   ├── tasks/
        │   ├── semantic-search/
        │   ├── rag/
        │   ├── research/
        │   └── health/
        ├── services/web-search/
        ├── services/web-fetch/
        └── utils/logger.ts
```

### Module public interfaces

| Module | Public exports | Owns |
| --- | --- | --- |
| `modules/chat` | `chatRouter`, `chatService` | Conversations, messages, chat responses |
| `modules/tasks` | `tasksRouter`, `taskAssistantRouter`, `taskService`, `taskAssistantService` | Task CRUD, tool calling, delete confirmation |
| `modules/semantic-search` | `semanticSearchRouter`, `semanticSearchService` | Document ingest, embeddings, similarity search |
| `modules/rag` | `ragRouter`, `ragService` | Retrieval-augmented Q&A, citations, sessions |
| `modules/research` | `researchRouter`, `researchService` | Web research, citations, sessions |
| `modules/health` | `healthRouter` | API and DB health checks |
| `services/ai` | `getAiProviderBundle`, provider types | OpenAI / Anthropic clients — modules never instantiate SDKs directly |
| `services/web-search` | `getWebSearchProvider` | Tavily web search adapter |
| `services/web-fetch` | `fetchPublicPage` | SSRF-safe public page fetch |

### AI provider architecture

- Capability interfaces: `TextGenerationProvider`, `ToolCallingProvider`, `EmbeddingProvider`
- Factory: `AI_PROVIDER=openai|anthropic`
- OpenAI: text generation + Responses API tool calling + embeddings
- Anthropic: text generation only (no silent OpenAI fallback). Task Assistant and Semantic Search embeddings require `AI_PROVIDER=openai`
- API keys stay in backend env only; never logged

### Project 3 — Semantic Document Search

- **Postgres image:** `pgvector/pgvector:pg16` (PostgreSQL 16 + pgvector; existing named volume preserved)
- **Migration:** `0006_create_semantic_search` enables `vector`, creates `search_documents` and `search_document_chunks` (`VECTOR(1536)`), unique `(document_id, chunk_index)`, HNSW cosine index
- **Embedding model:** `text-embedding-3-small` (default), **1536 dimensions** (`OPENAI_EMBEDDING_MODEL` / `OPENAI_EMBEDDING_DIMENSIONS`)
- **Formats:** PDF, TXT, Markdown · default max **10 MB**
- **Chunking:** word-approximated tokens, default size **800** / overlap **120** (`SEMANTIC_SEARCH_CHUNK_*`)
- **Search:** query embedding + pgvector cosine distance (`<=>`); similarity = `1 - distance`
- **Endpoints:**
  - `POST /api/semantic-search/documents` (multipart `file`)
  - `GET /api/semantic-search/documents`
  - `GET /api/semantic-search/documents/:id`
  - `DELETE /api/semantic-search/documents/:id`
  - `POST /api/semantic-search/query`

Duplicate identical content (SHA-256) returns the existing completed document without re-embedding.

### Project 4 — PDF Question Answering (RAG)

Reuses Project 3 tables, embeddings, and pgvector retrieval. Adds:

- **Migrations:** `0007_add_chunk_page_metadata` (`page_start` / `page_end` on chunks), `0008_create_rag_sessions` (sessions, messages, citation snapshots)
- **Pipeline:** embed question → retrieve top-K completed chunks (optional document filter + similarity threshold) → bound context → LLM JSON answer → **backend citation validation**
- **Page numbers:** PDF page-level extraction via `pdf-parse`; TXT/Markdown cite without fake pages; older chunks may show page unavailable until re-index
- **Endpoints:**
  - `POST /api/rag/ask`
  - `GET /api/rag/documents`
  - `GET /api/rag/sessions`
  - `GET /api/rag/sessions/:id`
  - `DELETE /api/rag/sessions/:id`
- **Config:** `RAG_MODEL`, `RAG_DEFAULT_TOP_K`, `RAG_SIMILARITY_THRESHOLD` (default `0.22`, not a calibrated confidence), `RAG_MAX_CONTEXT_CHARS`

### Project 5 — AI Research Assistant

Live web research with validated citations. Details: `src/modules/research/README.md`.

- **Migrations:** `0009_create_research_sessions`, `0010_add_research_search_queries`
- **Search:** Tavily (`TAVILY_API_KEY`, backend-only). Missing key returns **503** with a clear configuration error — the API does not invent search results.
- **Fetch:** SSRF-safe HTTP(S) retrieval with private-network blocking, redirect revalidation, size/timeout/content-type limits; falls back to snippets
- **Pipeline:** search → normalize/dedupe/rank → optional page fetch → LLM structured report → citation ID validation → PostgreSQL persistence
- **Endpoints:**
  - `POST /api/research/run`
  - `POST /api/research/search`
  - `GET /api/research/sessions`
  - `GET /api/research/sessions/:id`
  - `DELETE /api/research/sessions/:id`
- **Config:** `TAVILY_API_KEY`, `RESEARCH_MAX_RESULTS`, `RESEARCH_MAX_FOLLOWUP_QUERIES`, `RESEARCH_FETCH_TIMEOUT_MS`, `RESEARCH_MAX_PAGE_BYTES`, `RESEARCH_MODEL`
- **UI:** `/features/research-agent`

### How to add a backend feature

1. Create `src/modules/<name>/` with routes, controller, service, schemas, types, and `index.ts` (export only the public surface)
2. Add a repository only when the feature needs persistence
3. Register the router in `src/api/router.ts`
4. Reuse `services/ai` for model calls; keep business rules in the feature service
5. Add module tests with mocked AI providers

- Browser → `http://localhost:3000/api`
- Backend container → PostgreSQL at `postgres:5432`
- Adminer → `http://localhost:8080`
- Application IDs → PostgreSQL `BIGINT GENERATED ALWAYS AS IDENTITY`, serialized in JSON as decimal strings (e.g. `"1"`)

## Prerequisites

- Docker Engine running
- Docker Compose plugin (`docker compose`)
- Node.js 22+ and npm (for local non-Docker builds/tests)

```bash
docker --version
docker compose version
```

## Environment configuration

From this repository:

```bash
copy .env.example .env
```

macOS/Linux:

```bash
cp .env.example .env
```

Preserve local credentials in `.env`. Never commit `.env` or real API keys.

| Variable | Purpose |
| --- | --- |
| `POSTGRES_*` | Database credentials and host port |
| `FRONTEND_URL` | CORS origin for the backend |
| `VITE_API_BASE_URL` | Browser-facing API URL for Vite |
| `AI_PROVIDER` | `openai` (default) or `anthropic` |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | Backend-only OpenAI configuration |
| `OPENAI_EMBEDDING_MODEL` / `OPENAI_EMBEDDING_DIMENSIONS` | Embeddings (must match `VECTOR(n)` migration) |
| `SEMANTIC_SEARCH_MAX_FILE_SIZE_MB` | Upload size limit (default 10) |
| `SEMANTIC_SEARCH_CHUNK_SIZE` / `SEMANTIC_SEARCH_CHUNK_OVERLAP` | Chunking defaults |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Optional Anthropic text provider |
| `TASK_DELETE_SECRET` | HMAC secret for delete confirmation tokens |
| `RAG_*` | PDF RAG generation / retrieval tunables |
| `TAVILY_API_KEY` | Research Assistant web search (required for live search) |
| `RESEARCH_*` | Research result/fetch limits and optional model override |

Compose injects `DATABASE_URL` using the `postgres` service hostname. Do not bake secrets into images.

## Start the full stack (from this directory)

```bash
docker compose config
docker compose up --build -d
docker compose ps
```

Startup order:

1. `postgres` becomes healthy
2. `migrate` runs `npm run db:migrate` once and exits successfully
3. `backend` starts only after migrations complete
4. `frontend` starts after backend is healthy

Follow logs:

```bash
docker compose logs -f
docker compose logs migrate
```

Stop containers (keeps the PostgreSQL named volume):

```bash
docker compose down
```

Do **not** use `docker compose down -v` for routine cleanup — it deletes persisted database data.

## Database migrations

### Location

`src/database/migrations/`

Files are registered explicitly in `src/database/migrations/index.ts` so they are included in the TypeScript build and available inside Docker images.

### Naming rules

- Filename: `NNNN_snake_case_description.ts`
- `version`: four-digit string (`0001`, `0002`, ...)
- `name`: snake_case matching the filename suffix
- Each migration exports `{ version, name, up, down? }`
- Versions must be unique and applied in ascending order

### Creating a new migration

1. Add the next numbered file, e.g. `src/database/migrations/0006_your_change.ts`
2. Register it in `src/database/migrations/index.ts`
3. Implement `up(client)`
4. Add `down(client)` only if rollback is safe and intentional
5. Never edit the historical meaning of an already-applied migration

### Commands

```bash
npm run db:migrate
npm run db:migrate:status
```

Inside Docker:

```bash
docker compose exec backend npm run db:migrate
docker compose exec backend npm run db:migrate:status
```

### Behavior

- Discovers migrations from the explicit registry
- Validates versions, names, uniqueness, and `up`
- Uses PostgreSQL table `schema_migrations` as the source of applied history
- Skips already-applied versions
- Runs each pending migration in a transaction
- Rolls back a failed migration and does **not** record it as applied
- Uses a PostgreSQL advisory lock to prevent concurrent runners
- Refuses to continue if tracking history references a missing migration file

Migrations are **not** auto-applied by the API process on every request/startup. Compose runs them through the dedicated `migrate` service before the API starts.

### Fresh database

1. Configure `.env`
2. `docker compose up --build -d`
3. The `migrate` service applies `0001` → `0008`
4. Confirm with `docker compose exec backend npm run db:migrate:status`

### Existing database

If chat tables already exist (including the earlier UUID schema), migrations inspect the live schema:

- `0002` / `0003` verify compatibility and do not recreate existing tables
- `0004` converts UUID application IDs to `BIGINT` identity values while preserving conversation/message rows and foreign keys
- Existing chat history is retained; IDs change from UUID strings to numeric decimal strings

Do not manually mark rows in `schema_migrations` as applied unless you have verified the corresponding schema objects exist.

### API ID contract

Chat conversation, message, and task IDs are PostgreSQL `BIGINT` identity values exposed as **decimal strings** in JSON responses and request bodies. Example: `"conversationId": "12"`, `"taskId": "3"`.

## Project 2 — AI Task Assistant

Migration: `0005_create_tasks`

`tasks` columns: `id`, `title`, `description`, `priority` (`low|medium|high`), `status` (`pending|in_progress|completed`), `due_date`, `created_at`, `updated_at`.

### Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/task-assistant/chat` | Natural-language requests with OpenAI tool calling |
| `GET` | `/api/tasks` | List/filter tasks |
| `GET` | `/api/tasks/:id` | Fetch one task |
| `POST` | `/api/tasks` | Create a task |
| `PATCH` | `/api/tasks/:id` | Update a task |
| `POST` | `/api/tasks/:id/confirm-delete` | Confirm a pending deletion |

### Tools

- `create_task`
- `list_tasks`
- `update_task`
- `delete_task` — returns a signed confirmation token; does **not** delete immediately

### Delete confirmation flow

1. Model calls `delete_task`
2. Backend returns `requiresConfirmation` + `confirmationToken`
3. Frontend shows a confirmation dialog
4. User confirms → `POST /api/tasks/:id/confirm-delete`
5. Backend verifies the token signature/expiry/task match, then deletes

Task-assistant chat history is kept in the frontend session (not mixed into Project 1 chat tables). Tasks themselves are persisted in PostgreSQL.

### Troubleshooting missing migration files

If status/migrate reports a missing migration that appears in `schema_migrations`:

1. Restore the missing source file from Git history
2. Re-register it in `migrations/index.ts` if needed
3. Re-run `npm run db:migrate:status`
4. Do not delete tracking rows unless performing a deliberate repair with a verified schema inventory

## Access URLs

| Service | URL |
| --- | --- |
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:3000/api |
| Health | http://localhost:3000/api/health |
| DB health | http://localhost:3000/api/health/db |
| Chat | `POST http://localhost:3000/api/chat` |
| Adminer | http://localhost:8080 |

### Adminer connection

| Field | Value |
| --- | --- |
| System | PostgreSQL |
| Server | `postgres` |
| Username | `POSTGRES_USER` |
| Password | `POSTGRES_PASSWORD` |
| Database | `POSTGRES_DB` |

## Backend scripts

```bash
npm install
npm run dev
npm run build
npm start
npm run typecheck
npm test
npm run db:migrate
npm run db:migrate:status
```

Integration DB tests (optional, uses the configured database):

```bash
set RUN_DB_INTEGRATION_TESTS=1
npm test
```

## Project 1 — AI Chat Assistant

- `POST /api/chat` uses the OpenAI Responses API
- Conversations and messages persist in PostgreSQL
- API keys stay on the backend only

## Tests

```bash
npm test
npm run typecheck
npm run build
```

## Troubleshooting

1. **Port in use** — change `FRONTEND_PORT` / `BACKEND_PORT` / `POSTGRES_PORT` / `ADMINER_PORT` in `.env`
2. **Compose validation** — `docker compose config`
3. **DB connection** — confirm `postgres` is healthy; backend must use host `postgres`, not `localhost`, inside Compose
4. **Frontend API unreachable** — keep `VITE_API_BASE_URL=http://localhost:3000/api` and restart frontend after changing Vite env vars
5. **Migration failed** — inspect `docker compose logs migrate`, fix the migration, then re-run `docker compose up migrate`
6. **Docker daemon stopped** — start the engine via CLI (`docker desktop start` on Windows), then retry Compose commands


cd ai-playground-backend
copy .env.example .env
# edit .env as needed

docker compose up --build -d
docker compose exec backend npm run db:migrate:status