import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { DomainError } from '@dark-storage/shared';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  const requestId = (req as any).requestId || (req.headers['x-request-id'] as string) || 'unknown';

  if (err instanceof DomainError) {
    res.status(err.httpStatus).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
        request_id: requestId
      }
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: { issues: err.issues },
        request_id: requestId
      }
    });
    return;
  }

  console.error(`[Engine 2 Internal Error] [${requestId}]`, err);

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      request_id: requestId
    }
  });
}
