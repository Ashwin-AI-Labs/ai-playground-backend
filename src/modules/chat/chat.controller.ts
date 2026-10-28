import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../../middleware/error-handler";
import { chatService } from "./chat.service";
import { numericIdSchema, sendMessageSchema } from "./chat.schemas";

export async function listConversations(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = req.authUser!.id;
    const conversations = await chatService.listConversations(userId);
    res.json({ success: true, conversations });
  } catch (error) {
    next(error);
  }
}

export async function getConversation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = numericIdSchema.parse(req.params.id);
    const userId = req.authUser!.id;
    const result = await chatService.getConversation(id, userId);
    res.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof ZodError) {
      next(new AppError(400, "Invalid conversation id"));
      return;
    }
    next(error);
  }
}

export async function sendMessage(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = sendMessageSchema.parse(req.body);
    const userId = req.authUser!.id;
    const result = await chatService.sendMessage(
      body.message,
      userId,
      body.conversationId,
    );

    res.status(201).json({
      success: true,
      conversationId: result.conversation.id,
      conversation: result.conversation,
      userMessage: result.userMessage,
      assistantMessage: result.assistantMessage,
    });
  } catch (error) {
    next(error);
  }
}
