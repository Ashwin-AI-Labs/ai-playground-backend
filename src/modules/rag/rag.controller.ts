import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../../middleware/error-handler";
import { listDocuments as listSearchDocuments } from "../semantic-search/semantic-search.repository";
import { askSchema, listSessionsQuerySchema, numericIdSchema } from "./rag.schemas";
import { ragService } from "./rag.service";

export async function askQuestion(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = askSchema.parse(req.body);
    const result = await ragService.ask({
      question: body.question,
      documentIds: body.documentIds,
      sessionId: body.sessionId,
      topK: body.topK,
    });
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

export async function listEligibleDocuments(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await listSearchDocuments({ limit: 100, offset: 0 });
    const documents = result.documents
      .filter((doc) => doc.status === "completed")
      .map((doc) => ({
        id: doc.id,
        filename: doc.filename,
        originalFilename: doc.original_filename,
        mimeType: doc.mime_type,
        fileSizeBytes: doc.file_size_bytes,
        status: doc.status,
        chunkCount: doc.chunk_count,
        createdAt: doc.created_at.toISOString(),
        updatedAt: doc.updated_at.toISOString(),
      }));

    res.json({
      success: true,
      documents,
      total: documents.length,
    });
  } catch (error) {
    next(error);
  }
}

export async function listSessions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listSessionsQuerySchema.parse(req.query);
    const sessions = await ragService.listSessions(query.limit);
    res.json({ success: true, sessions });
  } catch (error) {
    next(error);
  }
}

export async function getSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = numericIdSchema.parse(req.params.id);
    const detail = await ragService.getSession(id);
    res.json({ success: true, ...detail });
  } catch (error) {
    if (error instanceof ZodError) {
      next(new AppError(400, "Invalid session id"));
      return;
    }
    next(error);
  }
}

export async function deleteSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = numericIdSchema.parse(req.params.id);
    await ragService.deleteSession(id);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof ZodError) {
      next(new AppError(400, "Invalid session id"));
      return;
    }
    next(error);
  }
}
