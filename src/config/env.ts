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
