import { z } from 'zod';
import { TASK_TYPES, TASK_STATUSES, TaskType, TaskStatus } from '../enums.js';

export const taskTypeSchema = z.enum(TASK_TYPES);
export const taskPrioritySchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4)
]);

export type TaskPriority = z.infer<typeof taskPrioritySchema>;

export const taskStatusSchema = z.enum(TASK_STATUSES);

export const createTaskSchema = z.object({

  type: taskTypeSchema,
  priority: taskPrioritySchema.default(2),
  idempotency_key: z.string().min(1),
  actor: z.object({
    id: z.number().int(),
    display_name: z.string(),
    role: z.string()
  }),
  payload: z.record(z.unknown()),
  resources: z.array(z.string()).default([])
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export interface TaskRecord {
  id: string;
  type: TaskType;
  priority: TaskPriority;
  idempotency_key: string;
  actor_json: string;
  payload_json: string;
  resources_json: string;
  status: TaskStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  http_status: number | null;
  result_json: string | null;
  error_code: string | null;
  error_message: string | null;
  error_details_json: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface TaskDto {
  id: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  attempts: number;
  http_status?: number;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}
