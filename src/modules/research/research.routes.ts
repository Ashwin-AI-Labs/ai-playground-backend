import { Router } from "express";
import {
  deleteSession,
  getSession,
  listSessions,
  previewSearch,
  runResearch,
} from "./research.controller";

export const researchRouter = Router();

researchRouter.post("/run", runResearch);
researchRouter.post("/search", previewSearch);
researchRouter.get("/sessions", listSessions);
researchRouter.get("/sessions/:id", getSession);
researchRouter.delete("/sessions/:id", deleteSession);
