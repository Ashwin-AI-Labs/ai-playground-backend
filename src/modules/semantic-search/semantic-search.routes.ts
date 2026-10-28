import { Router } from "express";
import multer from "multer";
import { env } from "../../config/env";
import { AppError } from "../../middleware/error-handler";
import {
  deleteDocument,
  getDocument,
  listDocuments,
  searchDocuments,
  uploadDocument,
} from "./semantic-search.controller";

const maxBytes = Math.floor(env.SEMANTIC_SEARCH_MAX_FILE_SIZE_MB * 1024 * 1024);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxBytes,
    files: 1,
  },
});

function handleMulter(req: Parameters<typeof uploadDocument>[0], res: Parameters<typeof uploadDocument>[1], next: Parameters<typeof uploadDocument>[2]) {
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
            `File exceeds the maximum size of ${env.SEMANTIC_SEARCH_MAX_FILE_SIZE_MB} MB`,
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

export const semanticSearchRouter = Router();

semanticSearchRouter.post("/documents", handleMulter, uploadDocument);
semanticSearchRouter.get("/documents", listDocuments);
semanticSearchRouter.get("/documents/:id", getDocument);
semanticSearchRouter.delete("/documents/:id", deleteDocument);
semanticSearchRouter.post("/query", searchDocuments);
