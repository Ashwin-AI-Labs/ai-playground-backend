import { Router } from "express";
import { checkDatabaseHealth } from "../../database/pool";

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  res.json({
    success: true,
    status: "ok",
    service: "ai-playground-backend",
    timestamp: new Date().toISOString(),
  });
});

healthRouter.get("/db", async (_req, res) => {
  const result = await checkDatabaseHealth();

  if (!result.healthy) {
    res.status(503).json({
      success: false,
      status: "unhealthy",
      database: "disconnected",
      latencyMs: result.latencyMs,
      error: result.error,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  res.json({
    success: true,
    status: "ok",
    database: "connected",
    latencyMs: result.latencyMs,
    timestamp: new Date().toISOString(),
  });
});
