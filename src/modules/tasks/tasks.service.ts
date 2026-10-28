import { AppError } from "../../middleware/error-handler";
import {
  createTask,
  deleteTask,
  getTaskById,
  listTasks,
  updateTask,
  type CreateTaskInput,
  type ListTasksFilter,
  type TaskRecord,
  type UpdateTaskInput,
} from "./tasks.repository";
import {
  createDeleteConfirmationToken,
  verifyDeleteConfirmationToken,
} from "./delete-confirmation";

export function toTaskDto(task: TaskRecord) {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    priority: task.priority,
    status: task.status,
    dueDate: task.due_date ? task.due_date.toISOString() : null,
    createdAt: task.created_at.toISOString(),
    updatedAt: task.updated_at.toISOString(),
  };
}

export type TaskDto = ReturnType<typeof toTaskDto>;

export function createTaskService() {
  return {
    async create(input: CreateTaskInput) {
      const task = await createTask(input);
      return toTaskDto(task);
    },

    async getById(taskId: string) {
      const task = await getTaskById(taskId);
      if (!task) {
        throw new AppError(404, "Task not found");
      }
      return toTaskDto(task);
    },

    async list(filter: ListTasksFilter = {}) {
      const tasks = await listTasks(filter);
      return tasks.map(toTaskDto);
    },

    async update(taskId: string, input: UpdateTaskInput) {
      const task = await updateTask(taskId, input);
      if (!task) {
        throw new AppError(404, "Task not found");
      }
      return toTaskDto(task);
    },

    async requestDelete(taskId: string) {
      const task = await getTaskById(taskId);
      if (!task) {
        return {
          ok: false as const,
          error: "Task not found",
          task: null,
          confirmationToken: null,
        };
      }

      return {
        ok: true as const,
        requiresConfirmation: true as const,
        message:
          "Deletion requires explicit user confirmation. Do not claim the task was deleted yet.",
        task: toTaskDto(task),
        confirmationToken: createDeleteConfirmationToken(task.id),
      };
    },

    async confirmDelete(taskId: string, confirmationToken: string) {
      const verification = verifyDeleteConfirmationToken(
        confirmationToken,
        taskId,
      );
      if (!verification.valid) {
        throw new AppError(400, verification.reason);
      }

      const deleted = await deleteTask(taskId);
      if (!deleted) {
        throw new AppError(404, "Task not found");
      }

      return toTaskDto(deleted);
    },
  };
}

export const taskService = createTaskService();
