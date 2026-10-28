import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { apiRouter } from "./api/router";
import { env } from "./config/env";
import { errorHandler } from "./middleware/error-handler";
import { notFoundHandler } from "./middleware/not-found";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: env.FRONTEND_URL,
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());

  app.get("/", (_req, res) => {
    res.json({
      success: true,
      message: "AI Playground backend is running",
      api: "/api",
    });
  });

  app.use("/api", apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
