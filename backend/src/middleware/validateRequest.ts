import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema, ZodTypeDef } from 'zod';

/**
 * Schema-driven request validation (README §10.6).
 *
 * A single factory every route wraps itself in, so no controller ever reads raw
 * `req.body`. Validated output is attached to `req.validated` rather than written
 * back over `req.body`/`req.query`: Express 5 makes `req.query` a getter, and mutating
 * the request in place would leave two subtly different versions of the same input
 * for the next reader to choose wrongly between.
 */

declare module 'express-serve-static-core' {
  interface Request {
    validated?: unknown;
  }
}

export function validateRequest<T>(schema: ZodSchema<T, ZodTypeDef, unknown>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse({
      body: req.body,
      params: req.params,
      query: req.query,
    });

    if (!result.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'This request was rejected as invalid.',
          // Field-level detail is safe to return and is the difference between a
          // frontend that can highlight the bad input and one that can only shrug.
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
      return;
    }

    req.validated = result.data;
    next();
  };
}

/** Typed accessor, so controllers read validated input without re-asserting shape. */
export function validated<T>(req: Request): T {
  return req.validated as T;
}
