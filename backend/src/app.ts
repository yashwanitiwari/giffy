import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { apiRoutes } from './routes/index.js';

/**
 * Express app assembly (README §10.3 steps 3-5).
 *
 * Separated from `server.ts` so tests can mount the app without binding a port,
 * connecting to Mongo, or starting a cron.
 */

export function createApp(): Express {
  const app = express();

  // Giffy is a JSON API with no cookies and no same-origin HTML, so CSRF is not a
  // vector here and no browser is asked to render anything this server returns.
  app.use(helmet());

  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
      methods: ['GET', 'POST'],
    }),
  );

  // Every body this API accepts is a small JSON object; the largest field is a signed
  // XDR envelope. The default 100kb limit is already generous — stating it keeps an
  // oversized body a cheap 413 rather than something this process buffers.
  app.use(express.json({ limit: '100kb' }));

  app.use(requestLogger);

  app.use('/api', apiRoutes);

  app.use(notFoundHandler);

  // Last, per Express convention: only middleware registered after every route can
  // catch errors thrown from within them (§10.3 step 5).
  app.use(errorHandler);

  return app;
}
