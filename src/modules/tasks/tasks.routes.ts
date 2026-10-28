import { Router } from "express";
import {
  confirmDeleteTask,
  createTask,
  getTask,
  listTasks,
  requestDeleteTask,
  taskAssistantChat,
  updateTask,
} from "./tasks.controller";

export const tasksRouter = Router();
export const taskAssistantRouter = Router();

tasksRouter.get("/", listTasks);
tasksRouter.get("/:id", getTask);
tasksRouter.post("/", createTask);
tasksRouter.patch("/:id", updateTask);
tasksRouter.post("/:id/request-delete", requestDeleteTask);
tasksRouter.post("/:id/confirm-delete", confirmDeleteTask);

taskAssistantRouter.post("/chat", taskAssistantChat);
