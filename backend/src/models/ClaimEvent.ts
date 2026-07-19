import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

/**
 * The `claimEvents` collection (README §12.3).
 *
 * Exists purely for the sender-facing audit trail ("3 people viewed your gift link,
 * 1 wallet connected, 1 claim succeeded"). Append-only: no updates, no deletes
 * outside a data-retention policy.
 */

export const CLAIM_EVENT_TYPES = [
  'view',
  'wallet_connected',
  'answer_attempted',
  'claim_attempted',
  'claim_succeeded',
  'claim_failed',
] as const;

export type ClaimEventType = (typeof CLAIM_EVENT_TYPES)[number];

const claimEventSchema = new Schema(
  {
    giftId: { type: Schema.Types.ObjectId, ref: 'Gift', required: true },
    eventType: { type: String, enum: CLAIM_EVENT_TYPES, required: true },
    /** e.g. `{ errorCode: 'CLAIM_EXPIRED' }` on claim_failed. Never a raw token. */
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  // No `updatedAt`: a row that is never updated should not carry a field claiming
  // otherwise.
  { timestamps: { createdAt: true, updatedAt: false } },
);

claimEventSchema.index({ giftId: 1, createdAt: -1 });

export type ClaimEvent = InferSchemaType<typeof claimEventSchema> & { createdAt: Date };
export type ClaimEventDocument = HydratedDocument<ClaimEvent>;

export const ClaimEventModel = model('ClaimEvent', claimEventSchema);
