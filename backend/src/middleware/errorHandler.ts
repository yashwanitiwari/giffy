import { ChainError } from '@giffy/chain';
import type { NextFunction, Request, Response } from 'express';
import { Error as MongooseError } from 'mongoose';
import { ZodError } from 'zod';

import { ApiError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * The single place thrown errors become HTTP responses (README §12.1, §12.9).
 *
 * Two jobs. First, keep §7.3 principle 5 ("fail loud, fail specific") true at the
 * boundary: a `ChainError` already carries a message written for a human and a code
 * the frontend maps to copy, so it is surfaced rather than flattened into "something
 * went wrong". Second, ensure the *specific* thing surfaced is never the internal
 * one — stack traces and raw Soroban/Horizon payloads are logged here and dropped
 * from the response, since a chain error's `details` field holds whatever the
 * network sent back verbatim.
 *
 * Must be registered last, after all routes.
 */

/**
 * Chain errors describe what the contract (or the classic trustline path) refused;
 * this maps that onto what HTTP calls it. Keyed loosely by `string` rather than
 * `@giffy/chain`'s `ChainErrorCode` union so this mapping stays valid across the
 * Soroban rewrite's error-code set (§11.5) without a hard type dependency on it; any
 * code not listed here falls back to 400. `GIFT_EXPIRED` gets 410 rather than 409:
 * the gift was real and is now permanently past claiming, which is precisely what
 * 410 means and what lets the frontend distinguish "too late" from "not yet".
 */
const CHAIN_ERROR_STATUS: Record<string, number> = {
  GIFT_NOT_FOUND: 404,
  GIFT_NOT_OPEN: 409,
  GIFT_EXPIRED: 410,
  GIFT_NOT_YET_EXPIRED: 409,
  NOT_RECEIVER: 403,
  WRONG_ANSWER: 409,
  STEPS_NOT_COMPLETE: 409,
  NOT_AUTHORIZED_UNLOCKER: 403,
  ALL_STEPS_ALREADY_COMPLETE: 409,
  INVALID_CONTRIBUTION_AMOUNT: 400,
  INVALID_EXPIRY: 400,
  NOT_STEP_GATED: 409,
  NOT_SENDER_OR_CONTRIBUTOR: 403,
  TRUSTLINE_MISSING: 400,
  ACCOUNT_NOT_FOUND: 404,
  BAD_SEQUENCE: 409,
  // The anchor is an upstream dependency; its failure is not the client's fault.
  ANCHOR_ERROR: 502,
  UNKNOWN_CONTRACT_ERROR: 400,
  CHAIN_ERROR: 400,
};

interface ErrorBody {
  error: {
    code: string;
    message: string;
    issues?: { path: string; message: string }[];
  };
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // Required for Express to recognize this as an error handler, despite being unused:
  // arity is how the framework tells the two middleware kinds apart.
  _next: NextFunction,
): void {
  const { status, body, logLevel } = toResponse(err);

  logger[logLevel](
    { err, status, code: body.error.code, method: req.method, path: req.originalUrl },
    'Request failed',
  );

  res.status(status).json(body);
}

function toResponse(err: unknown): {
  status: number;
  body: ErrorBody;
  logLevel: 'warn' | 'error';
} {
  // Giffy's own refusals: the message is written to be read by a user.
  if (err instanceof ApiError) {
    return {
      status: err.status,
      body: { error: { code: err.code, message: err.message } },
      logLevel: err.status >= 500 ? 'error' : 'warn',
    };
  }

  // The network's refusals. `err.details` deliberately does not travel.
  if (err instanceof ChainError) {
    const status = CHAIN_ERROR_STATUS[err.code] ?? 400;
    return {
      status,
      body: { error: { code: err.code, message: err.message } },
      logLevel: status >= 500 ? 'error' : 'warn',
    };
  }

  // Reachable only if a schema is bypassed — validateRequest normally catches these
  // first and returns field-level detail of its own.
  if (err instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'This request was rejected as invalid.',
          issues: err.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
      logLevel: 'warn',
    };
  }

  if (err instanceof MongooseError.ValidationError) {
    return {
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'This request was rejected as invalid.',
          issues: Object.entries(err.errors).map(([path, issue]) => ({
            path,
            message: issue.message,
          })),
        },
      },
      logLevel: 'warn',
    };
  }

  // Anything unrecognized is a bug, not a user error. It is logged in full and
  // answered with nothing: an unexpected error's message is as likely to be a driver
  // internal or a connection string as anything a client should read.
  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our end. Please try again.',
      },
    },
    logLevel: 'error',
  };
}

/** Terminal 404 for unmatched routes, shaped like every other error response. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Cannot ${req.method} ${req.path}` },
  });
}
