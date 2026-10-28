import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../../middleware/error-handler";
import {
  listSummariesQuerySchema,
  numericIdSchema,
  summarizeOptionsSchema,
} from "./summarizer.schemas";
import { documentSummarizerService } from "./summarizer.service";

export async function summarizeDocument(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const file = req.file;
    if (!file) {
      throw new AppError(400, "A file upload is required (field name: file)");
    }

    const options = summarizeOptionsSchema.parse({
      length: req.body?.length,
      style: req.body?.style,
      strategy: req.body?.strategy,
    });

    const result = await documentSummarizerService.summarize({
      buffer: file.buffer,
      originalFilename: file.originalname || "document",
      mimeType: file.mimetype || "application/octet-stream",
      length: options.length,
      style: options.style,
      strategy: options.strategy,
      userId: req.authUser!.id,
    });

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function listSummaries(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listSummariesQuerySchema.parse(req.query);
    const userId = req.authUser!.id;
    const result = await documentSummarizerService.list({ ...query, userId });
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

export async function getSummary(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = numericIdSchema.parse(req.params.id);
    const userId = req.authUser!.id;
    const data = await documentSummarizerService.get(id, userId);
    res.json({ success: true, data });
  } catch (error) {
    if (error instanceof ZodError) {
      next(new AppError(400, "Invalid summary id"));
      return;
    }
    next(error);
  }
}

export async function deleteSummary(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = numericIdSchema.parse(req.params.id);
    const userId = req.authUser!.id;
    await documentSummarizerService.delete(id, userId);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof ZodError) {
      next(new AppError(400, "Invalid summary id"));
      return;
    }
    next(error);
  }
}

export async function exportSummary(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = numericIdSchema.parse(req.params.id);
    const userId = req.authUser!.id;
    const exported = await documentSummarizerService.exportMarkdown(id, userId);
    res.setHeader("Content-Type", exported.contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${exported.filename.replace(/"/g, "")}"`,
    );
    res.send(exported.body);
  } catch (error) {
    if (error instanceof ZodError) {
      next(new AppError(400, "Invalid summary id"));
      return;
    }
    next(error);
  }
}
