import mongoose from 'mongoose';

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * MongoDB connection with bounded retry (README §10.3 step 2).
 *
 * Crashing on the first failed attempt makes container startup ordering a race:
 * under docker-compose the API frequently wins the race against Mongo's own boot.
 * Retrying with backoff absorbs that, while the bound ensures a genuinely wrong URI
 * still fails loudly rather than looping forever pretending to make progress.
 */

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 1_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function connectToDatabase(): Promise<void> {
  // Mongoose buffers operations against a dead connection by default, turning a
  // connection failure into a request that hangs until timeout instead of one that
  // errors. Fail the query instead — the error handler can then say something true.
  mongoose.set('bufferCommands', false);

  // Note: `sanitizeFilter` is deliberately NOT enabled. It rewrites *any* object
  // value containing `$` keys into an `$eq` literal at cast time, which silently
  // breaks the operator queries this backend legitimately builds — the refund
  // sweep's `{ expiresAt: { $lt: now } }` throws a CastError under it, meaning the
  // cron would fail every run and mark nothing.
  //
  // It protects against filters assembled from raw request objects, which is a shape
  // this codebase never produces: every filter is built from zod-validated
  // primitives (§10.6), so a value reaching a query is always already a string —
  // `{ $ne: null }` cannot survive a `z.string()` parse to become one.

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
      logger.info('MongoDB connected');
      registerConnectionListeners();
      return;
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) {
        logger.error({ err, attempt }, 'MongoDB connection failed; giving up');
        throw err;
      }

      const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
      logger.warn({ attempt, delay }, 'MongoDB connection failed; retrying');
      await sleep(delay);
    }
  }
}

/**
 * Mongoose reconnects on its own after the initial connection succeeds; these
 * listeners exist to make that visible in logs rather than to drive it.
 */
function registerConnectionListeners(): void {
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB connection error'));
}

export async function disconnectFromDatabase(): Promise<void> {
  await mongoose.connection.close();
  logger.info('MongoDB disconnected');
}
