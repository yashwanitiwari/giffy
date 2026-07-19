import type { Server } from 'node:http';

// Imported first, for its side effect: parsing and validating the environment before
// any other module reads it (README §10.3 step 1, §16.4). @giffy/chain validates its
// own config at import time too, so a bad Horizon URL must be caught by this parse
// first, alongside every other config error, rather than separately and later.
import { env } from './config/env.js';

import { createApp } from './app.js';
import { connectToDatabase, disconnectFromDatabase } from './db/mongoose.js';
import { startPoolIndexerCron, stopPoolIndexerCron } from './jobs/poolIndexerCron.js';
import { startReconciliationCron, stopReconciliationCron } from './jobs/reconciliationCron.js';
import { startRefundCron, stopRefundCron } from './jobs/refundCron.js';
import { logger } from './utils/logger.js';

/**
 * Process entry point (README §10.3).
 *
 * Bootstraps strictly in order: validate config, connect to Mongo, build the app,
 * schedule the sweep, then listen. Listening last is the point — a process that
 * accepts traffic before its database is up answers its first requests with errors it
 * did not need to produce.
 */

async function main(): Promise<void> {
  await connectToDatabase();

  const app = createApp();

  startRefundCron();
  startReconciliationCron();
  startPoolIndexerCron();

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, `Listening on port ${env.PORT}`);
  });

  registerShutdownHandlers(server);
}

/**
 * Graceful shutdown.
 *
 * Worth the ceremony here specifically because of what an in-flight request may be
 * doing: `POST /api/gifts/:id/submit` can be mid-flight to the Soroban RPC, and
 * killing the process between the network accepting that invocation and Mongo
 * recording its `contractGiftId` would strand a real, funded on-chain gift with no
 * row pointing at it. Draining first makes that window as small as the runtime
 * allows.
 */
function registerShutdownHandlers(server: Server): void {
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'Shutting down');

    // Force-exit backstop: if a hung upstream keeps a connection open, exiting late is
    // better than an orchestrator SIGKILLing us at an arbitrary moment instead.
    const timeout = setTimeout(() => {
      logger.error('Shutdown timed out; forcing exit');
      process.exit(1);
    }, 10_000);
    timeout.unref();

    server.close(() => {
      void (async () => {
        try {
          await stopRefundCron();
          await stopReconciliationCron();
          await stopPoolIndexerCron();
          await disconnectFromDatabase();
          clearTimeout(timeout);
          process.exit(0);
        } catch (err) {
          logger.error({ err }, 'Error during shutdown');
          process.exit(1);
        }
      })();
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled rejection');
  });

  process.on('uncaughtException', (err) => {
    // The process state is unknowable after this; log it and let the supervisor
    // restart us rather than continuing to serve from a corrupted runtime.
    logger.fatal({ err }, 'Uncaught exception; exiting');
    process.exit(1);
  });
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
