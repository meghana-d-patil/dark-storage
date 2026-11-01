import { Router, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { DomainError } from '@dark-storage/shared';
import { runIdempotent } from '../domain/idempotency.js';
import { executePutaway, executeRelocate } from '../domain/putawayRepo.js';
import { executeReserveOrder } from '../domain/ordersRepo.js';
import { executePickConfirm, executeResolveException } from '../domain/pickingRepo.js';

export function createCommandsRouter(db: Database.Database): Router {
  const router = Router();

  router.post('/internal/v1/commands/:commandName', (req: Request, res: Response, next: NextFunction) => {
    try {
      const { commandName } = req.params;
      const { actor, idempotency_key, payload } = req.body;
      const taskId = req.header('X-Task-Id');

      if (!idempotency_key) {
        throw new DomainError('VALIDATION_ERROR', 'idempotency_key is required in command body');
      }
      if (!actor || !actor.id) {
        throw new DomainError('VALIDATION_ERROR', 'actor is required in command body');
      }
      if (!payload) {
        throw new DomainError('VALIDATION_ERROR', 'payload is required in command body');
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

      if (commandName === 'reserve-order') {
        const result = runIdempotent(
          db,
          {
            key: idempotency_key,
            scope: 'command:reserve-order',
            body: payload,
            actor
          },
          (txDb) => {
            const order = executeReserveOrder(txDb, {
              order_type: payload.order_type,
              priority: payload.priority,
              customer_ref: payload.customer_ref,
              notes: payload.notes,
              lines: payload.lines,
              actor
            });
            return { status: 201, body: order };
          }
        );
        res.status(result.status).json(result.body);
        return;
      }

      if (commandName === 'pick-confirm') {
        const result = runIdempotent(
          db,
          {
            key: idempotency_key,
            scope: `command:pick-confirm:${payload.stop_ref}`,
            body: payload,
            actor
          },
          (txDb) => {
            const pickRes = executePickConfirm(txDb, {
              stop_ref: payload.stop_ref,
              scanned_bin: payload.scanned_bin,
              scanned_sku: payload.scanned_sku,
              picked_qty: payload.picked_qty,
              exception: payload.exception,
              actor
            });
            return { status: 200, body: pickRes };
          }
        );
        res.status(result.status).json(result.body);
        return;
      }

      if (commandName === 'exception-resolve') {
        const result = runIdempotent(
          db,
          {
            key: idempotency_key,
            scope: `command:exception-resolve:${payload.exception_ref}`,
            body: payload,
            actor
          },
          (txDb) => {
            const resolveRes = executeResolveException(txDb, {
              exception_ref: payload.exception_ref,
              action: payload.action,
              notes: payload.notes,
              recount: payload.recount,
              actor
            });
            return { status: 200, body: resolveRes };
          }
        );
        res.status(result.status).json(result.body);
        return;
      }

      throw new DomainError('NOT_FOUND', `Unknown command ${commandName}`);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
