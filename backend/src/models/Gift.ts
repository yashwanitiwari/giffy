import { Schema, model, type HydratedDocument, type InferSchemaType } from 'mongoose';

import { env } from '../config/env.js';

/**
 * The `gifts` collection (README §14.1).
 *
 * Unified across every gift — there is no `mode` field. `contributions` and
 * `condition` are always present, defaulting to the empty/none case, because a
 * plain single-sender gift with no claim condition is not a different *kind* of
 * document, only one where those fields happen to be at their defaults (§2.2, §14.1).
 *
 * This document is the backend's cache/index over the `gift-escrow` contract's own
 * storage (§12.1) — never an independent record of fund custody. Where the two could
 * disagree, `reconciliationService.reconcileGift` (§12.6) is what brings this
 * document back in line with `get_gift`, and every state-changing action ends by
 * calling it.
 */

export const GIFT_STATUSES = [
  'draft',
  'pending_chain',
  'active',
  'claimed',
  'refund_pending',
  'refunded',
] as const;

export type GiftStatus = (typeof GIFT_STATUSES)[number];

export const GIFT_THEMES = ['birthday', 'congrats', 'thankyou', 'custom'] as const;

export type GiftTheme = (typeof GIFT_THEMES)[number];

export const CONDITION_TYPES = ['none', 'trivia', 'stepGate'] as const;

export type ConditionType = (typeof CONDITION_TYPES)[number];

const contributionSchema = new Schema(
  {
    contributorPublicKey: { type: String, required: true },
    amount: { type: String, required: true },
    txHash: { type: String, required: true },
    contributedAt: { type: Date, required: true },
  },
  { _id: false },
);

const conditionStepSchema = new Schema(
  {
    label: { type: String, required: true },
    description: { type: String, required: true },
  },
  { _id: false },
);

const conditionSchema = new Schema(
  {
    type: { type: String, enum: CONDITION_TYPES, default: 'none' },
    // Trivia only; plaintext, off-chain. The answer itself is never stored — only
    // its hash (§12.5), which mirrors the hash the contract holds.
    question: { type: String, default: null },
    answerHash: { type: String, default: null },
    // StepGate only; off-chain metadata describing each step for the UI.
    steps: { type: [conditionStepSchema], default: null },
    stepsCompleted: { type: Number, default: 0 },
    stepUnlockerPublicKey: { type: String, default: null },
  },
  { _id: false },
);

const giftSchema = new Schema(
  {
    senderPublicKey: { type: String, required: true, index: true },
    receiverPublicKey: { type: String, required: true },
    assetCode: { type: String, required: true },
    assetIssuer: { type: String, default: null },
    // The Stellar Asset Contract address for `assetCode` — always present, resolved
    // at draft time so it never needs re-resolving on the hot path (§14.1).
    tokenContractId: { type: String, required: true },
    // Decimal string, never a number — reflects the reconciled on-chain
    // `total_amount` once the gift is on-chain (§12.6).
    amount: { type: String, required: true },
    message: { type: String, required: true, maxlength: env.GIFT_MESSAGE_MAX_LENGTH },
    theme: { type: String, enum: GIFT_THEMES, required: true },
    // The on-chain u64 id, as a string. Absent while `status === 'draft'` — it is
    // not knowable until `create_gift` has actually landed (§14.1). Deliberately no
    // `default: null` here: mongoose would write an explicit `null` on every draft,
    // and a sparse index only skips fields that are absent, not ones explicitly set
    // to null — so every second draft would collide on the unique index.
    contractGiftId: { type: String, unique: true, sparse: true },
    // SHA-256 hex digest. The raw token is never stored (§17.2).
    claimTokenHash: { type: String, required: true, unique: true },
    status: { type: String, enum: GIFT_STATUSES, default: 'draft', index: true },
    txHashCreate: { type: String, default: null },
    txHashClaim: { type: String, default: null },
    txHashRefund: { type: String, default: null },
    expiresAt: { type: Date, required: true, index: true },

    // Whether the sender opted into group contributions at creation time (§15.1).
    // Not itself part of the contract record — it only gates whether Giffy's
    // frontend/backend ever expose a contribution link or UI for this gift (§17.4).
    isGroupGift: { type: Boolean, default: false },
    // Optional UI target for group gifts; not enforced on-chain (§14.1).
    goalAmount: { type: String, default: null },
    // Always has at least one entry (the sender's) once status >= active.
    contributions: { type: [contributionSchema], default: [] },
    condition: { type: conditionSchema, default: () => ({}) },
  },
  { timestamps: true },
);

// Powers the refund cron's `status = active AND expiresAt < now` sweep, and the
// reconciliation sweep's `status IN (active, refund_pending)` scan (§12.1, §14.1).
giftSchema.index({ status: 1, expiresAt: 1 });

// Powers the dashboard's newest-first list for one sender (§12.1).
giftSchema.index({ senderPublicKey: 1, createdAt: -1 });

// `InferSchemaType` does not know about the fields `{ timestamps: true }` adds, so
// they are declared here rather than left absent from the type of every document.
export type Gift = InferSchemaType<typeof giftSchema> & {
  createdAt: Date;
  updatedAt: Date;
};

export type GiftDocument = HydratedDocument<Gift>;

export const GiftModel = model('Gift', giftSchema);
