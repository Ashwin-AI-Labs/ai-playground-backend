import { Router } from "express";
import { authRouter } from "../modules/auth";
import { chatRouter } from "../modules/chat";
import { healthRouter } from "../modules/health";
import { documentSummarizerRouter } from "../modules/document-summarizer";
import { ragRouter } from "../modules/rag";
import { researchRouter } from "../modules/research";
import { semanticSearchRouter } from "../modules/semantic-search";
import { taskAssistantRouter, tasksRouter } from "../modules/tasks";
import { requireAuth } from "../middleware/require-auth";

export const apiRouter = Router();

apiRouter.get("/", (_req, res) => {
  res.json({
    success: true,
    name: "AI Playground API",
    version: "1.0.0",
    description: "Foundation REST API for the AI Playground application",
    endpoints: [
      { method: "GET", path: "/api", description: "API information" },
      { method: "GET", path: "/api/health", description: "API health check" },
      {
        method: "GET",
        path: "/api/health/db",
        description: "PostgreSQL health check",
      },
      // Auth
      { method: "POST", path: "/api/auth/register", description: "Register a new account (sends OTP)" },
      { method: "POST", path: "/api/auth/verify-email", description: "Verify email with OTP" },
      { method: "POST", path: "/api/auth/resend-otp", description: "Resend verification OTP" },
      { method: "POST", path: "/api/auth/login", description: "Login with email + password" },
      { method: "POST", path: "/api/auth/refresh", description: "Refresh access token using cookie" },
      { method: "POST", path: "/api/auth/logout", description: "Logout and clear refresh cookie" },
      { method: "GET", path: "/api/auth/me", description: "Get current user profile (requires auth)" },
      { method: "PATCH", path: "/api/auth/me", description: "Update display name (requires auth)" },
      {
        method: "POST",
        path: "/api/chat",
        description: "Send a chat message (creates or continues a conversation)",
      },
      {
        method: "GET",
        path: "/api/chat/conversations",
        description: "List chat conversations",
      },
      {
        method: "GET",
        path: "/api/chat/conversations/:id",
        description: "Get a conversation and its messages",
      },
      {
        method: "POST",
        path: "/api/task-assistant/chat",
        description: "Natural-language task assistant with OpenAI tool calling",
      },
      { method: "GET", path: "/api/tasks", description: "List tasks" },
      { method: "GET", path: "/api/tasks/:id", description: "Get a task" },
      { method: "POST", path: "/api/tasks", description: "Create a task" },
      { method: "PATCH", path: "/api/tasks/:id", description: "Update a task" },
      {
        method: "POST",
        path: "/api/tasks/:id/request-delete",
        description: "Request a confirmation token for task deletion",
      },
      {
        method: "POST",
        path: "/api/tasks/:id/confirm-delete",
        description: "Confirm and execute a pending task deletion",
      },
      {
        method: "POST",
        path: "/api/semantic-search/documents",
        description: "Upload and index a document for semantic search",
      },
      {
        method: "GET",
        path: "/api/semantic-search/documents",
        description: "List indexed documents",
      },
      {
        method: "GET",
        path: "/api/semantic-search/documents/:id",
        description: "Get document metadata",
      },
      {
        method: "DELETE",
        path: "/api/semantic-search/documents/:id",
        description: "Delete a document and its chunks",
      },
      {
        method: "POST",
        path: "/api/semantic-search/query",
        description: "Semantic similarity search over indexed passages",
      },
      {
        method: "POST",
        path: "/api/rag/ask",
        description: "Ask a question with retrieval-augmented generation",
      },
      {
        method: "GET",
        path: "/api/rag/documents",
        description: "List completed documents eligible for RAG",
      },
      {
        method: "GET",
        path: "/api/rag/sessions",
        description: "List recent RAG sessions",
      },
      {
        method: "GET",
        path: "/api/rag/sessions/:id",
        description: "Get a RAG session and message history",
      },
      {
        method: "DELETE",
        path: "/api/rag/sessions/:id",
        description: "Delete a RAG session",
      },
      {
        method: "POST",
        path: "/api/research/run",
        description: "Run AI research with web search and citations",
      },
      {
        method: "POST",
        path: "/api/research/search",
        description: "Preview web search results",
      },
      {
        method: "GET",
        path: "/api/research/sessions",
        description: "List research sessions",
      },
      {
        method: "GET",
        path: "/api/research/sessions/:id",
        description: "Get a research session",
      },
      {
        method: "DELETE",
        path: "/api/research/sessions/:id",
        description: "Delete a research session",
      },
      {
        method: "POST",
        path: "/api/document-summarizer/summarize",
        description: "Upload a document and generate a LangChain summary",
      },
      {
        method: "GET",
        path: "/api/document-summarizer/summaries",
        description: "List saved document summaries",
      },
      {
        method: "GET",
        path: "/api/document-summarizer/summaries/:id",
        description: "Get a saved document summary",
      },
      {
        method: "DELETE",
        path: "/api/document-summarizer/summaries/:id",
        description: "Delete a document summary",
      },
      {
        method: "GET",
        path: "/api/document-summarizer/summaries/:id/export",
        description: "Export a summary as Markdown",
      },
    ],
  });
});

apiRouter.use("/health", healthRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/chat", requireAuth, chatRouter);
apiRouter.use("/task-assistant", requireAuth, taskAssistantRouter);
apiRouter.use("/tasks", requireAuth, tasksRouter);
apiRouter.use("/semantic-search", requireAuth, semanticSearchRouter);
apiRouter.use("/rag", requireAuth, ragRouter);
apiRouter.use("/research", requireAuth, researchRouter);
apiRouter.use("/document-summarizer", requireAuth, documentSummarizerRouter);
