import { Router } from 'express';
import mongoose from 'mongoose';

import { claimRoutes } from './claim.js';
import { conditionRoutes } from './condition.js';
import { contributeRoutes } from './contribute.js';
import { giftRoutes } from './gifts.js';
import { onrampRoutes } from './onramp.js';
import { poolRoutes } from './pool.js';

/** Route aggregator, mounted under `/api` by server.ts (README §12.9). */

export const apiRoutes = Router();

/**
 * Liveness plus database reachability. Reports 503 when Mongo is down rather than a
 * cheerful 200: a process that is listening but cannot read a gift is not healthy,
 * and an orchestrator should be told the difference.
 */
apiRoutes.get('/health', (_req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;

  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? 'ok' : 'degraded',
    db: dbConnected ? 'connected' : 'disconnected',
  });
});

// `contributeRoutes` and `conditionRoutes` are both mounted under `/gifts` too:
// contribution and step-unlock are actions against an existing gift, not resources
// of their own (README §12.9's `/gifts/:id/...` route shapes).
apiRoutes.use('/gifts', giftRoutes);
apiRoutes.use('/gifts', contributeRoutes);
apiRoutes.use('/gifts', conditionRoutes);
apiRoutes.use('/claim', claimRoutes);
apiRoutes.use('/onramp', onrampRoutes);
apiRoutes.use('/pool', poolRoutes);
