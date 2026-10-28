import { Router } from "express";
import multer from "multer";
import { env } from "../../config/env";
import { AppError } from "../../middleware/error-handler";
import {
  deleteSummary,
  exportSummary,
  getSummary,
  listSummaries,
  summarizeDocument,
} from "./summarizer.controller";

const maxBytes = Math.floor(env.SUMMARIZER_MAX_FILE_SIZE_MB * 1024 * 1024);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxBytes,
    files: 1,
  },
});

function handleMulter(
  req: Parameters<typeof summarizeDocument>[0],
  res: Parameters<typeof summarizeDocument>[1],
  next: Parameters<typeof summarizeDocument>[2],
) {
  upload.single("file")(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }

    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        next(
          new AppError(
            400,
            `File exceeds the maximum size of ${env.SUMMARIZER_MAX_FILE_SIZE_MB} MB`,
          ),
        );
        return;
      }
      next(new AppError(400, error.message));
      return;
    }

    next(error);
  });
}

export const documentSummarizerRouter = Router();

documentSummarizerRouter.post("/summarize", handleMulter, summarizeDocument);
documentSummarizerRouter.get("/summaries", listSummaries);
documentSummarizerRouter.get("/summaries/:id", getSummary);
documentSummarizerRouter.delete("/summaries/:id", deleteSummary);
documentSummarizerRouter.get("/summaries/:id/export", exportSummary);
