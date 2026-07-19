import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

/**
 * The `poolleaves` collection — the deposit indexer's replay of the confidential
 * pool's Merkle tree (sealed-gift flow).
 *
 * Each document is one `deposit` event: the note commitment and the leaf index
 * the contract assigned it. This is a pure cache of on-chain events — the
 * contract's tree is authoritative — so the collection can be rebuilt from
 * scratch by re-scanning from ledger 0. A recipient's browser reads these
 * (ordered by `leafIndex`) to rebuild its note's authentication path.
 */

const poolLeafSchema = new Schema(
  {
    // Which pool contract this leaf belongs to — indexed so a future multi-pool
    // (multi-denomination) setup does not require a schema change.
    poolId: { type: String, required: true, index: true },
    // The u64 leaf position the contract assigned, left-to-right insertion order.
    leafIndex: { type: Number, required: true },
    // 32-byte note commitment, lowercase hex.
    commitment: { type: String, required: true },
    // Provenance, for debugging / re-sync bookkeeping.
    ledger: { type: Number, required: true },
    txHash: { type: String, required: true },
  },
  { timestamps: true },
);

// One commitment per (pool, index): makes the indexer's upsert idempotent, so a
// re-scan of overlapping ledgers can never double-insert a leaf.
poolLeafSchema.index({ poolId: 1, leafIndex: 1 }, { unique: true });

export type PoolLeaf = InferSchemaType<typeof poolLeafSchema> & {
  createdAt: Date;
  updatedAt: Date;
};
export type PoolLeafDocument = HydratedDocument<PoolLeaf>;

export const PoolLeafModel = model('PoolLeaf', poolLeafSchema);
