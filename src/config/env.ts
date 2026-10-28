import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  DATABASE_URL: z
    .string({
      required_error:
        "DATABASE_URL is required (e.g. postgresql://user:pass@host:5432/db)",
    })
    .min(1, "DATABASE_URL cannot be empty")
    .refine(
      (value) =>
        value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "DATABASE_URL must be a valid PostgreSQL connection string",
    ),
  FRONTEND_URL: z
    .string({
      required_error: "FRONTEND_URL is required (e.g. http://localhost:5173)",
    })
    .url("FRONTEND_URL must be a valid URL"),
  AI_PROVIDER: z.enum(["openai", "anthropic"]).default("openai"),
  OPENAI_API_KEY: z.string().optional().default(""),
  OPENAI_MODEL: z.string().min(1).default("gpt-4.1-mini"),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-sonnet-4-5"),
  TASK_DELETE_SECRET: z
    .string()
    .min(8, "TASK_DELETE_SECRET must be at least 8 characters")
    .default("local-dev-task-delete-secret"),
  /** OpenAI embedding model. Must match VECTOR_DIMENSIONS / migration schema. */
  OPENAI_EMBEDDING_MODEL: z.string().min(1).default("text-embedding-3-small"),
  /**
   * Embedding output dimensions. text-embedding-3-small defaults to 1536.
   * Must match search_document_chunks.embedding VECTOR(n) in migrations.
   */
  OPENAI_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
  SEMANTIC_SEARCH_MAX_FILE_SIZE_MB: z.coerce
    .number()
    .positive()
    .max(50)
    .default(10),
  /** Approximate tokens per chunk (word-based approximation). */
  SEMANTIC_SEARCH_CHUNK_SIZE: z.coerce.number().int().min(50).max(4000).default(800),
  SEMANTIC_SEARCH_CHUNK_OVERLAP: z.coerce
    .number()
    .int()
    .min(0)
    .max(1000)
    .default(120),
  /** Optional dedicated generation model for RAG (defaults to OPENAI_MODEL). */
  RAG_MODEL: z.string().optional().default(""),
  RAG_DEFAULT_TOP_K: z.coerce.number().int().min(1).max(10).default(5),
  /**
   * Minimum cosine similarity to keep a retrieved chunk (0–1).
   * Default 0.22 is intentionally permissive for embedding-3-small;
   * it is not a calibrated confidence score.
   */
  RAG_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.22),
  RAG_MAX_CONTEXT_CHARS: z.coerce.number().int().min(1000).max(50000).default(12000),
  /** Tavily web search for Research Assistant (backend only). */
  TAVILY_API_KEY: z.string().optional().default(""),
  RESEARCH_MAX_RESULTS: z.coerce.number().int().min(1).max(10).default(6),
  RESEARCH_MAX_FOLLOWUP_QUERIES: z.coerce.number().int().min(0).max(3).default(2),
  RESEARCH_FETCH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(8000),
  RESEARCH_MAX_PAGE_BYTES: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(2_000_000)
    .default(500_000),
  RESEARCH_MODEL: z.string().optional().default(""),
  /** Document summarizer (Project 6) — LangChain.js pipeline. */
  SUMMARIZER_MODEL: z.string().optional().default(""),
  SUMMARIZER_MAX_FILE_SIZE_MB: z.coerce.number().positive().max(50).default(10),
  SUMMARIZER_CHUNK_SIZE: z.coerce.number().int().min(500).max(8000).default(3000),
  SUMMARIZER_CHUNK_OVERLAP: z.coerce.number().int().min(0).max(2000).default(300),
  SUMMARIZER_MAX_CHUNKS: z.coerce.number().int().min(1).max(40).default(24),
  SUMMARIZER_DIRECT_MAX_CHARS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(100_000)
    .default(12_000),
  SUMMARIZER_MAP_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(3),
  SUMMARIZER_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(5000)
    .max(180_000)
    .default(60_000),

  // ─── Auth ──────────────────────────────────────────────────────────────────
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, "JWT_ACCESS_SECRET must be at least 32 characters")
    .default(
      "local-dev-jwt-access-secret-please-change-in-production-min32chars",
    ),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(14),
  REFRESH_COOKIE_NAME: z.string().min(1).default("playground_refresh"),
  COOKIE_SECURE: z
    .union([z.boolean(), z.string()])
    .transform((val) =>
      val === "true" || val === true ? true : val === "false" || val === false ? false : Boolean(val),
    )
    .default(false),
  COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("none"),

  // ─── Email / SMTP ─────────────────────────────────────────────────────────
  EMAIL_PROVIDER: z.string().default("smtp"),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .union([z.boolean(), z.string()])
    .transform((val) =>
      val === "true" || val === true ? true : false,
    )
    .default(false),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),
  MAIL_FROM_NAME: z.string().default("AI Playground"),
  MAIL_FROM_EMAIL: z.string().default("noreply@ai-playground.local"),

  // ─── OTP ──────────────────────────────────────────────────────────────────
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),

  // ─── Auth rate limiting (in-memory) ──────────────────────────────────────
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("\n");

    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return parsed.data;
}

export const env = loadEnv();

export function hasOpenAiApiKey(): boolean {
  return Boolean(env.OPENAI_API_KEY?.trim());
}

export function hasAnthropicApiKey(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY?.trim());
}

export function hasTavilyApiKey(): boolean {
  return Boolean(env.TAVILY_API_KEY?.trim());
}
