import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

/**
 * The deposit indexer's resume cursor: the last ledger scanned for a pool's
 * `deposit` events. One document per pool. Kept separate from `PoolLeaf` so the
 * cursor advances even across ledgers that contained no deposits.
 */
const poolSyncStateSchema = new Schema({
  poolId: { type: String, required: true, unique: true },
  lastLedger: { type: Number, required: true, default: 0 },
});

export type PoolSyncState = InferSchemaType<typeof poolSyncStateSchema>;
export type PoolSyncStateDocument = HydratedDocument<PoolSyncState>;

export const PoolSyncStateModel = model('PoolSyncState', poolSyncStateSchema);
