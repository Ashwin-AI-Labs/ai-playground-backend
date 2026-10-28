import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../../middleware/error-handler";
import {
  listDocumentsQuerySchema,
  numericIdSchema,
  searchQuerySchema,
} from "./semantic-search.schemas";
import { semanticSearchService } from "./semantic-search.service";

export async function uploadDocument(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const file = req.file;
    if (!file) {
      throw new AppError(400, "A file upload is required (field name: file)");
    }

    const document = await semanticSearchService.ingestUpload({
      buffer: file.buffer,
      originalFilename: file.originalname || "upload",
      mimeType: file.mimetype || "application/octet-stream",
    });

    const statusCode = document.duplicateOf ? 200 : 201;
    res.status(statusCode).json({
      success: true,
      document,
      duplicate: Boolean(document.duplicateOf),
      message: document.duplicateOf
        ? "Identical content was already indexed; returning the existing document."
        : undefined,
    });
  } catch (error) {
    next(error);
  }
}

export async function listDocuments(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listDocumentsQuerySchema.parse(req.query);
    const result = await semanticSearchService.listDocuments(query);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function getDocument(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = numericIdSchema.parse(req.params.id);
    const document = await semanticSearchService.getDocument(id);
    res.json({ success: true, document });
  } catch (error) {
    if (error instanceof ZodError) {
      next(new AppError(400, "Invalid document id"));
      return;
    }
    next(error);
  }
}

export async function deleteDocument(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = numericIdSchema.parse(req.params.id);
    await semanticSearchService.deleteDocument(id);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof ZodError) {
      next(new AppError(400, "Invalid document id"));
      return;
    }
    next(error);
  }
}

export async function searchDocuments(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = searchQuerySchema.parse(req.body);
    const result = await semanticSearchService.search({
      query: body.query,
      limit: body.limit,
      documentIds: body.documentIds,
    });
    res.json({
      success: true,
      query: result.query,
      results: result.results,
      note: "Similarity scores are model-dependent cosine similarities, not calibrated probabilities of correctness.",
    });
  } catch (error) {
    next(error);
  }
}
