import { toApiId } from "../../database/id";
import { pool } from "../../database/pool";

export type TaskPriority = "low" | "medium" | "high";
export type TaskStatus = "pending" | "in_progress" | "completed";

export type TaskRecord = {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: Date | null;
  created_at: Date;
  updated_at: Date;
};

type TaskRow = {
  id: string | number | bigint;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type CreateTaskInput = {
  title: string;
  description?: string | null;
  priority: TaskPriority;
  dueDate?: Date | null;
};

export type UpdateTaskInput = {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  dueDate?: Date | null;
};

export type ListTasksFilter = {
  status?: TaskStatus | "all";
  priority?: TaskPriority;
  limit?: number;
};

function mapTask(row: TaskRow): TaskRecord {
  return {
    id: toApiId(row.id),
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    due_date: row.due_date,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function createTask(input: CreateTaskInput): Promise<TaskRecord> {
  const result = await pool.query<TaskRow>(
    `INSERT INTO tasks (title, description, priority, due_date)
     VALUES ($1, $2, $3, $4)
     RETURNING id, title, description, priority, status, due_date, created_at, updated_at`,
    [
      input.title,
      input.description ?? null,
      input.priority,
      input.dueDate ?? null,
    ],
  );

  return mapTask(result.rows[0]);
}

export async function getTaskById(taskId: string): Promise<TaskRecord | null> {
  const result = await pool.query<TaskRow>(
    `SELECT id, title, description, priority, status, due_date, created_at, updated_at
     FROM tasks
     WHERE id = $1`,
    [taskId],
  );

  const row = result.rows[0];
  return row ? mapTask(row) : null;
}

export async function listTasks(filter: ListTasksFilter = {}): Promise<TaskRecord[]> {
  const clauses: string[] = [];
  const values: unknown[] = [];

  if (filter.status && filter.status !== "all") {
    values.push(filter.status);
    clauses.push(`status = $${values.length}`);
  }

  if (filter.priority) {
    values.push(filter.priority);
    clauses.push(`priority = $${values.length}`);
  }

  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 100);
  values.push(limit);

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  const result = await pool.query<TaskRow>(
    `SELECT id, title, description, priority, status, due_date, created_at, updated_at
     FROM tasks
     ${where}
     ORDER BY created_at DESC
     LIMIT $${values.length}`,
    values,
  );

  return result.rows.map(mapTask);
}

export async function updateTask(
  taskId: string,
  input: UpdateTaskInput,
): Promise<TaskRecord | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.title !== undefined) {
    values.push(input.title);
    sets.push(`title = $${values.length}`);
  }
  if (input.description !== undefined) {
    values.push(input.description);
    sets.push(`description = $${values.length}`);
  }
  if (input.priority !== undefined) {
    values.push(input.priority);
    sets.push(`priority = $${values.length}`);
  }
  if (input.status !== undefined) {
    values.push(input.status);
    sets.push(`status = $${values.length}`);
  }
  if (input.dueDate !== undefined) {
    values.push(input.dueDate);
    sets.push(`due_date = $${values.length}`);
  }

  if (sets.length === 0) {
    return getTaskById(taskId);
  }

  sets.push("updated_at = NOW()");
  values.push(taskId);

  const result = await pool.query<TaskRow>(
    `UPDATE tasks
     SET ${sets.join(", ")}
     WHERE id = $${values.length}
     RETURNING id, title, description, priority, status, due_date, created_at, updated_at`,
    values,
  );

  const row = result.rows[0];
  return row ? mapTask(row) : null;
}

export async function deleteTask(taskId: string): Promise<TaskRecord | null> {
  const result = await pool.query<TaskRow>(
    `DELETE FROM tasks
     WHERE id = $1
     RETURNING id, title, description, priority, status, due_date, created_at, updated_at`,
    [taskId],
  );

  const row = result.rows[0];
  return row ? mapTask(row) : null;
}
