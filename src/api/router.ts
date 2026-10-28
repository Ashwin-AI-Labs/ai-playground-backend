import { Router } from "express";
import { chatRouter } from "../modules/chat";
import { healthRouter } from "../modules/health";
import { semanticSearchRouter } from "../modules/semantic-search";
import { taskAssistantRouter, tasksRouter } from "../modules/tasks";

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
    ],
  });
});

apiRouter.use("/health", healthRouter);
apiRouter.use("/chat", chatRouter);
apiRouter.use("/task-assistant", taskAssistantRouter);
apiRouter.use("/tasks", tasksRouter);
apiRouter.use("/semantic-search", semanticSearchRouter);
