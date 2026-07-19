import cron, { type ScheduledTask } from 'node-cron';

import { env } from '../config/env.js';
import { GiftModel } from '../models/Gift.js';
import { reconcileGift } from '../services/reconciliationService.js';
import { logger } from '../utils/logger.js';

/**
 * The periodic full-sweep reconciliation (README §12.8).
 *
 * Because every gift's state can change via a `contribute` or `unlock_step` call
 * that a different session — or, in principle, an entirely different client
 * bypassing Giffy's backend altogether, since the contract itself has no access
 * control beyond `require_auth` on the calling address (§17.4) — initiated, this
 * sweep is worth running in a way that wouldn't have been strictly necessary in a
 * design where only a minority of gifts ever touched the contract at all.
 */

let task: ScheduledTask | null = null;

export async function runReconciliationSweep(): Promise<{ scanned: number; failed: number }> {
  const candidates = await GiftModel.find({
    status: { $in: ['active', 'refund_pending'] },
    contractGiftId: { $ne: null },
  }).exec();

  let failed = 0;
  for (const gift of candidates) {
    // Sequential, not Promise.all: this is a background sweep with no deadline, and
    // a burst of concurrent RPC calls is a poor trade against a user-facing request
    // sharing the same connection pool.
    try {
      await reconcileGift(gift.id);
    } catch (err) {
      failed += 1;
      logger.error({ err, giftId: gift.id }, 'Reconciliation sweep failed for gift');
    }
  }

  if (candidates.length > 0) {
    logger.info({ scanned: candidates.length, failed }, 'Reconciliation sweep complete');
  }

  return { scanned: candidates.length, failed };
}

export function startReconciliationCron(): void {
  if (!cron.validate(env.RECONCILIATION_CRON_SCHEDULE)) {
    throw new Error(`Invalid RECONCILIATION_CRON_SCHEDULE: "${env.RECONCILIATION_CRON_SCHEDULE}"`);
  }

  task = cron.schedule(env.RECONCILIATION_CRON_SCHEDULE, () => {
    // Errors are caught rather than left to reject: an unhandled rejection inside a
    // scheduled callback would take the whole API process down, and a failed sweep
    // is a retry-next-tick problem, not a restart-the-server problem.
    void runReconciliationSweep().catch((err: unknown) => {
      logger.error({ err }, 'Reconciliation sweep failed');
    });
  });

  logger.info({ schedule: env.RECONCILIATION_CRON_SCHEDULE }, 'Reconciliation cron scheduled');
}

export async function stopReconciliationCron(): Promise<void> {
  await task?.stop();
  task = null;
}
