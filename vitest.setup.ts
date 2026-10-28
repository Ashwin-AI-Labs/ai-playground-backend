process.env.NODE_ENV = "test";
process.env.PORT = "3000";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://playground:playground@localhost:5432/ai_playground";
process.env.FRONTEND_URL =
  process.env.FRONTEND_URL ?? "http://localhost:5173";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "test-key";
process.env.OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
process.env.TASK_DELETE_SECRET =
  process.env.TASK_DELETE_SECRET ?? "test-task-delete-secret";
