import { Router } from "express";
import {
  askQuestion,
  deleteSession,
  getSession,
  listEligibleDocuments,
  listSessions,
} from "./rag.controller";

export const ragRouter = Router();

ragRouter.post("/ask", askQuestion);
ragRouter.get("/documents", listEligibleDocuments);
ragRouter.get("/sessions", listSessions);
ragRouter.get("/sessions/:id", getSession);
ragRouter.delete("/sessions/:id", deleteSession);
