import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { DomainError, AppError, StateError } from '@dark-storage/shared';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  const requestId = req.requestId || (req.headers['x-request-id'] as string) || 'unknown';

  if (err instanceof DomainError) {
    res.status(err.httpStatus).json({
      error: err.message,
      code: err.code,
      details: err.details,
      request_id: requestId
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json({
      error: err.message,
      code: err.code,
      details: err.details,
      request_id: requestId
    });
    return;
  }

  if (err instanceof StateError) {
    res.status(err.status).json({
      error: err.message,
      code: err.code,
      details: {
        machine: err.machine,
        fromState: err.fromState,
        event: err.event
      },
      request_id: requestId
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'VALIDATION_ERROR',
      details: { issues: err.issues },
      request_id: requestId
    });
    return;
  }

  console.error(`[Gateway Error] [${requestId}]`, err);

  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    request_id: requestId
  });
}
