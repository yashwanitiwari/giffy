/**
 * Response/request shapes mirroring the backend's DTOs (README §15 API Reference).
 *
 * These are hand-mirrored from `backend/src/services/*.ts` and
 * `backend/src/controllers/*.ts` — the backend is the source of truth. Unified
 * design (README §14.1): every gift always has `contributions` and `condition`
 * present, defaulting to the empty/none case — there is no separate "simple" vs
 * "group/conditional" gift type anymore, and no Claimable-Balance concepts
 * (`balanceId`) survive from any prior design.
 */

export type GiftStatus =
  | 'draft'
  | 'pending_chain'
  | 'active'
  | 'claimed'
  | 'refund_pending'
  | 'refunded';

export type GiftTheme = 'birthday' | 'congrats' | 'thankyou' | 'custom';

export const GIFT_THEMES: GiftTheme[] = ['birthday', 'congrats', 'thankyou', 'custom'];

export type ConditionType = 'none' | 'trivia' | 'stepGate';

export interface GiftStep {
  label: string;
  description: string;
}

/** Sender-composed condition input, sent on `POST /api/gifts` (§15.1). */
export type ConditionInput =
  | { type: 'none' }
  | { type: 'trivia'; question: string; answer: string }
  | { type: 'stepGate'; steps: GiftStep[]; stepUnlockerPublicKey?: string };

/** Condition shape as reflected back by the claim preview (§15.4) — never echoes the answer. */
export interface ConditionPreview {
  type: ConditionType;
  question?: string;
  steps?: { label: string; description: string }[];
  stepsCompleted?: number;
  totalSteps?: number;
}

export interface CreateGiftRequest {
  senderPublicKey: string;
  receiverPublicKey: string;
  assetCode: string;
  amount: string;
  message: string;
  theme: GiftTheme;
  expiresInSeconds: number;
  isGroupGift: boolean;
  goalAmount: string | null;
  condition: ConditionInput;
}

export interface CreateGiftResponse {
  giftId: string;
  status: GiftStatus;
}

export interface BuiltTransaction {
  xdr: string;
  networkPassphrase: string;
}

export interface SubmittedGift {
  claimUrl: string;
  qrPayload: string;
  contributeUrl?: string;
  contractGiftId: string;
  txHash: string;
  status: GiftStatus;
}

export interface GiftContribution {
  contributorPublicKey: string;
  amount: string;
  txHash: string;
  contributedAt: string;
}

export interface GiftDTO {
  giftId: string;
  receiverPublicKey: string;
  assetCode: string;
  amount: string;
  message: string;
  theme: GiftTheme;
  status: GiftStatus;
  contractGiftId: string | null;
  txHashCreate: string | null;
  txHashClaim: string | null;
  txHashRefund: string | null;
  expiresAt: string;
  createdAt: string;
  isGroupGift: boolean;
  goalAmount: string | null;
  contributeUrl?: string;
  condition: {
    type: ConditionType;
    question?: string | null;
    steps?: GiftStep[] | null;
    stepsCompleted: number;
    stepUnlockerPublicKey?: string | null;
  };
}

export interface GiftPreviewDTO {
  assetCode: string;
  amount: string;
  message: string;
  theme: string;
  senderLabel: string;
  status: GiftStatus | string;
  expiresAt: string;
  condition: ConditionPreview;
}

export interface SubmitResult {
  status: string;
  txHash: string;
}

/** `GET /api/gifts/:id/group-summary` (§15.2) — public, no sender/receiver-private data. */
export interface GroupSummaryDTO {
  assetCode: string;
  total: string;
  goal: string | null;
  contributions: { contributorLabel: string; amount: string }[];
  status: GiftStatus | string;
}

export interface ContributeBuildResponse {
  xdr: string;
}

export interface ContributeSubmitResponse {
  txHash: string;
  newTotal: string;
}

export interface VerifyAnswerResponse {
  verified: boolean;
}

export interface UnlockStepSubmitResponse {
  stepsCompleted: number;
}

export interface ChallengeResponse {
  xdr: string;
}

export interface SessionTokenResponse {
  sessionToken: string;
}

export interface DepositResponse {
  sessionId: string;
  interactiveUrl: string;
}

export interface DepositStatusResponse {
  status: string;
  stellarTransactionId?: string;
  message?: string;
}

/** Structured error body produced by the backend's errorHandler. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    issues?: { path: string; message: string }[];
  };
}
