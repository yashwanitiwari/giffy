import {
  getLatestLedger,
  getPoolDepositEvents,
  isShieldedPoolConfigured,
  shieldedPoolContractId,
} from '@giffy/chain';

import { env } from '../config/env.js';
import { PoolLeafModel } from '../models/PoolLeaf.js';
import { PoolSyncStateModel } from '../models/PoolSyncState.js';
import { logger } from '../utils/logger.js';

/**
 * Deposit indexer for the confidential gift pool (sealed-gift flow).
 *
 * Replays the pool's on-chain `deposit` events into the `poolleaves` cache so a
 * recipient's browser can reconstruct its note's Merkle authentication path. The
 * contract's tree is authoritative; this is a rebuildable projection of it.
 *
 * Correctness rests on two properties:
 *   * upserts are keyed by `(poolId, leafIndex)`, so re-scanning overlapping
 *     ledgers is idempotent;
 *   * the served list is validated to be gap-free (`0..n-1`) before a path is
 *     built on it — a gap means events were missed (e.g. RPC retention) and any
 *     path would be wrong.
 */

/** How far back to scan on the very first sync when no cursor exists yet. */
const INITIAL_LOOKBACK_LEDGERS = 100_000;

export async function syncPoolDeposits(): Promise<{ poolId: string; indexed: number; total: number } | null> {
  if (!isShieldedPoolConfigured()) return null;
  const poolId = shieldedPoolContractId();

  const state = await PoolSyncStateModel.findOne({ poolId }).exec();
  let startLedger = state?.lastLedger ? state.lastLedger : 0;

  if (startLedger === 0) {
    const latest = await getLatestLedger();
    startLedger = Math.max(1, latest - env.SHIELDED_POOL_START_LOOKBACK);
  }

  const { events, latestLedger } = await getPoolDepositEvents(startLedger);

  let indexed = 0;
  for (const ev of events) {
    const res = await PoolLeafModel.updateOne(
      { poolId, leafIndex: ev.leafIndex },
      { $setOnInsert: { poolId, ...ev } },
      { upsert: true },
    ).exec();
    if (res.upsertedCount > 0) indexed += 1;
  }

  await PoolSyncStateModel.updateOne(
    { poolId },
    { $set: { lastLedger: latestLedger } },
    { upsert: true },
  ).exec();

  const total = await PoolLeafModel.countDocuments({ poolId }).exec();
  if (indexed > 0) {
    logger.info({ poolId, indexed, total, latestLedger }, 'Pool deposits indexed');
  }
  return { poolId, indexed, total };
}

/**
 * The ordered commitment list for a pool, plus its length. Throws if the indexed
 * leaves have a gap — building a Merkle path on an incomplete list would produce
 * a root the contract never held.
 */
export async function getOrderedCommitments(poolId: string): Promise<{ commitments: string[]; count: number }> {
  const leaves = await PoolLeafModel.find({ poolId })
    .sort({ leafIndex: 1 })
    .select('leafIndex commitment')
    .lean()
    .exec();

  const commitments: string[] = [];
  for (let i = 0; i < leaves.length; i += 1) {
    const leaf = leaves[i];
    if (!leaf || leaf.leafIndex !== i) {
      throw new Error(
        `Pool leaf gap at index ${i} (found ${leaf?.leafIndex}); indexer is behind or missed events.`,
      );
    }
    commitments.push(leaf.commitment);
  }
  return { commitments, count: commitments.length };
}

export const INITIAL_LOOKBACK_LEDGERS_DEFAULT = INITIAL_LOOKBACK_LEDGERS;
