import { Router } from "express";
import {
  getConversation,
  listConversations,
  sendMessage,
} from "./chat.controller";

export const chatRouter = Router();

chatRouter.get("/conversations", listConversations);
chatRouter.get("/conversations/:id", getConversation);
chatRouter.post("/", sendMessage);
