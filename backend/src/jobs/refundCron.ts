import cron, { type ScheduledTask } from 'node-cron';

import { env } from '../config/env.js';
import * as refundService from '../services/refundService.js';
import { logger } from '../utils/logger.js';

/**
 * The refund-eligibility sweep (README §10.7, §6.3).
 *
 * This job deliberately submits nothing. The backend cannot sign for the sender
 * (§15.3), so a reclaim transaction is not something a cron *could* produce even if
 * the design wanted it to. All it does is flip expired gifts from `active` to
 * `refund_pending`, surfacing a "Reclaim" action in the sender's dashboard that they
 * then sign themselves.
 *
 * Keeping the side effect to a status flag is what makes the job safe to run often:
 * it is idempotent (the flip is conditioned on still being `active`), it leaves an
 * inspectable trace that it ran, and there is no transaction it could double-submit.
 */

let task: ScheduledTask | null = null;

export async function runRefundSweep(): Promise<{ scanned: number; marked: number }> {
  const expired = await refundService.findExpiredActiveGifts();

  let marked = 0;
  for (const gift of expired) {
    // Sequential, not Promise.all: this is a background sweep with no deadline, and a
    // burst of concurrent writes is a poor trade against a user-facing request that
    // is waiting on the same connection pool.
    if (await refundService.markRefundPending(gift.id)) {
      marked += 1;
    }
  }

  if (expired.length > 0) {
    logger.info({ scanned: expired.length, marked }, 'Refund sweep complete');
  }

  return { scanned: expired.length, marked };
}

export function startRefundCron(): void {
  if (!cron.validate(env.REFUND_CRON_SCHEDULE)) {
    throw new Error(`Invalid REFUND_CRON_SCHEDULE: "${env.REFUND_CRON_SCHEDULE}"`);
  }

  task = cron.schedule(env.REFUND_CRON_SCHEDULE, () => {
    // Errors are caught rather than left to reject: an unhandled rejection inside a
    // scheduled callback would take the whole API process down, and a failed sweep is
    // a retry-in-15-minutes problem, not a restart-the-server problem.
    void runRefundSweep().catch((err: unknown) => {
      logger.error({ err }, 'Refund sweep failed');
    });
  });

  logger.info({ schedule: env.REFUND_CRON_SCHEDULE }, 'Refund cron scheduled');
}

export async function stopRefundCron(): Promise<void> {
  await task?.stop();
  task = null;
}
