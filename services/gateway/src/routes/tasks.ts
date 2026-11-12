import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { requirePerm } from '../middleware/rbac.js';
import { getTaskFromEngine1, listTasksFromEngine1, getLocksFromEngine1, getQueueFromEngine1 } from '../clients/engine1.js';

export const tasksRouter = Router();

tasksRouter.use(authMiddleware);

// GET /api/tasks/locks (control:view)
tasksRouter.get('/locks', requirePerm('control:view'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getLocksFromEngine1();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/tasks/queue (control:view)
tasksRouter.get('/queue', requirePerm('control:view'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await getQueueFromEngine1();
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/tasks (control:view)
tasksRouter.get('/', requirePerm('control:view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = await listTasksFromEngine1({
      status: req.query.status as string | undefined,
      type: req.query.type as string | undefined,
      page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
});

// GET /api/tasks/:id
tasksRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const taskId = req.params.id;
    const task = await getTaskFromEngine1(taskId, 0);

    res.json({
      id: task.id,
      type: task.type,
      status: task.status,
      priority: task.priority,
      attempts: task.attempts,
      http_status: task.http_status,
      result: task.result,
      error: task.error,
      created_at: task.created_at,
      started_at: task.started_at,
      finished_at: task.finished_at
    });
  } catch (err) {
    next(err);
  }
});
