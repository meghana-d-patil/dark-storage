import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { DomainError } from '@dark-storage/shared';
import { runIdempotent } from '../domain/idempotency.js';
import { executePutaway, executeRelocate } from '../domain/putawayRepo.js';

export function createCommandsRouter(db: Database.Database): Router {
  const router = Router();

  router.post('/internal/v1/commands/:commandName', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { commandName } = req.params;
      const { actor, idempotency_key, payload } = req.body;
      const taskId = req.header('X-Task-Id');

      if (!idempotency_key) {
        throw new DomainError('VALIDATION_ERROR', 'idempotency_key is required in command body', 400);
      }
      if (!actor || !actor.id) {
        throw new DomainError('VALIDATION_ERROR', 'actor is required in command body', 400);
      }
      if (!payload) {
        throw new DomainError('VALIDATION_ERROR', 'payload is required in command body', 400);
      }

      if (commandName === 'putaway') {
        const result = runIdempotent(
          db,
          {
            key: idempotency_key,
            scope: 'command:putaway',
            body: payload,
            actor
          },
          (txDb) => {
            const putaway = executePutaway(txDb, {
              receipt_line_id: payload.receipt_line_id,
              dest_bin: payload.dest_bin,
              qty: payload.qty,
              recommended_bin: payload.recommended_bin,
              actor,
              taskId
            });
            return { status: 201, body: putaway };
          }
        );
        res.status(result.status).json(result.body);
        return;
      }

      if (commandName === 'relocate') {
        const result = runIdempotent(
          db,
          {
            key: idempotency_key,
            scope: 'command:relocate',
            body: payload,
            actor
          },
          (txDb) => {
            const relocate = executeRelocate(txDb, {
              from_bin: payload.from_bin,
              to_bin: payload.to_bin,
              qty: payload.qty,
              actor,
              taskId
            });
            return { status: 200, body: relocate };
          }
        );
        res.status(result.status).json(result.body);
        return;
      }

      throw new DomainError('NOT_FOUND', `Unknown command ${commandName}`, 404);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
