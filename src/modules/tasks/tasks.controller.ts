import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../../middleware/error-handler";
import { taskAssistantService } from "./task-assistant.service";
import {
  confirmDeleteSchema,
  createTaskSchema,
  listTasksQuerySchema,
  numericIdSchema,
  taskAssistantChatSchema,
  updateTaskSchema,
} from "./tasks.schemas";
import { taskService } from "./tasks.service";

export async function listTasks(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = listTasksQuerySchema.parse(req.query);
    const tasks = await taskService.list(query);
    res.json({ success: true, tasks });
  } catch (error) {
    next(error);
  }
}

export async function getTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = numericIdSchema.parse(req.params.id);
    const task = await taskService.getById(id);
    res.json({ success: true, task });
  } catch (error) {
    if (error instanceof ZodError) {
      next(new AppError(400, "Invalid task id"));
      return;
    }
    next(error);
  }
}

export async function createTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = createTaskSchema.parse(req.body);
    const task = await taskService.create({
      title: body.title,
      description: body.description,
      priority: body.priority,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
    });
    res.status(201).json({ success: true, task });
  } catch (error) {
    next(error);
  }
}

export async function updateTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = numericIdSchema.parse(req.params.id);
    const body = updateTaskSchema.parse(req.body);
    const task = await taskService.update(id, {
      title: body.title,
      description: body.description,
      priority: body.priority,
      status: body.status,
      dueDate:
        body.dueDate === undefined
          ? undefined
          : body.dueDate === null
            ? null
            : new Date(body.dueDate),
    });
    res.json({ success: true, task });
  } catch (error) {
    if (error instanceof ZodError) {
      next(new AppError(400, "Invalid task update request"));
      return;
    }
    next(error);
  }
}

export async function requestDeleteTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = numericIdSchema.parse(req.params.id);
    const result = await taskService.requestDelete(id);
    if (!result.ok || !result.task || !result.confirmationToken) {
      next(new AppError(404, result.error ?? "Task not found"));
      return;
    }

    res.json({
      success: true,
      requiresConfirmation: true,
      confirmationToken: result.confirmationToken,
      task: result.task,
      message: result.message,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      next(new AppError(400, "Invalid task id"));
      return;
    }
    next(error);
  }
}

export async function confirmDeleteTask(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = numericIdSchema.parse(req.params.id);
    const body = confirmDeleteSchema.parse(req.body);
    const task = await taskService.confirmDelete(id, body.confirmationToken);
    res.json({ success: true, task });
  } catch (error) {
    if (error instanceof ZodError) {
      next(new AppError(400, "Invalid delete confirmation request"));
      return;
    }
    next(error);
  }
}

export async function taskAssistantChat(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = taskAssistantChatSchema.parse(req.body);
    const result = await taskAssistantService.chat(
      body.message,
      body.history ?? [],
    );
    res.json({
      success: true,
      reply: result.reply,
      actions: result.actions,
      pendingDelete: result.pendingDelete,
      iterations: result.iterations,
    });
  } catch (error) {
    next(error);
  }
}
