import cron, { type ScheduledTask } from 'node-cron';
import { isShieldedPoolConfigured } from '@giffy/chain';

import { env } from '../config/env.js';
import { syncPoolDeposits } from '../services/poolIndexerService.js';
import { logger } from '../utils/logger.js';

/**
 * Periodic deposit-indexer sweep (sealed-gift flow). Pulls new `deposit` events
 * from the pool into the `poolleaves` cache so recipients can build Merkle paths.
 * A no-op (and never scheduled) when no pool is configured.
 */

let task: ScheduledTask | null = null;

export function startPoolIndexerCron(): void {
  if (!isShieldedPoolConfigured()) {
    logger.info('Shielded pool not configured; deposit indexer disabled');
    return;
  }

  // Kick an immediate sync at boot so the cache is warm without waiting a cycle.
  void runOnce();

  task = cron.schedule(env.POOL_INDEXER_CRON_SCHEDULE, () => {
    void runOnce();
  });
  logger.info({ schedule: env.POOL_INDEXER_CRON_SCHEDULE }, 'Deposit indexer scheduled');
}

async function runOnce(): Promise<void> {
  try {
    await syncPoolDeposits();
  } catch (err) {
    logger.error({ err }, 'Deposit indexer sweep failed');
  }
}

export async function stopPoolIndexerCron(): Promise<void> {
  if (task) {
    await task.stop();
    task = null;
  }
}
