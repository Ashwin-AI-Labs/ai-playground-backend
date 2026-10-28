import { migration as migration0001 } from "./0001_create_migration_tracking";
import { migration as migration0002 } from "./0002_create_chat_conversations";
import { migration as migration0003 } from "./0003_create_chat_messages";
import { migration as migration0004 } from "./0004_standardize_application_ids";
import { migration as migration0005 } from "./0005_create_tasks";
import { migration as migration0006 } from "./0006_create_semantic_search";
import { migration as migration0007 } from "./0007_add_chunk_page_metadata";
import { migration as migration0008 } from "./0008_create_rag_sessions";
import type { Migration } from "../types";

/**
 * Explicit registry keeps migration discovery deterministic in both
 * development (tsx) and production (compiled dist/) without relying on
 * filesystem globs that can miss files in Docker images.
 */
export const migrations: Migration[] = [
  migration0001,
  migration0002,
  migration0003,
  migration0004,
  migration0005,
  migration0006,
  migration0007,
  migration0008,
];
