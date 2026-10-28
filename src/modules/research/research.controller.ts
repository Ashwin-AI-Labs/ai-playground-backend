import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../../middleware/error-handler";
import {
  listSessionsQuerySchema,
  numericIdSchema,
  researchRunSchema,
  researchSearchSchema,
} from "./research.schemas";
import { researchService } from "./research.service";

export async function runResearch(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = researchRunSchema.parse(req.body);
    const userId = req.authUser!.id;
    const result = await researchService.run({
      question: body.question,
      maxResults: body.maxResults,
      recencyDays: body.recencyDays,
      includeDomains: body.includeDomains,
      userId,
    });
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

export async function previewSearch(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = researchSearchSchema.parse(req.body);
    const results = await researchService.previewSearch({
      query: body.query,
      maxResults: body.maxResults,
    });
    res.json({ success: true, results });
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
    const userId = req.authUser!.id;
    const result = await researchService.listSessions({ ...query, userId });
    res.json({ success: true, ...result });
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
    const userId = req.authUser!.id;
    const data = await researchService.getSession(id, userId);
    res.json({ success: true, data });
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
    const userId = req.authUser!.id;
    await researchService.deleteSession(id, userId);
    res.json({ success: true });
  } catch (error) {
    if (error instanceof ZodError) {
      next(new AppError(400, "Invalid session id"));
      return;
    }
    next(error);
  }
}
