import { createHash } from 'node:crypto';

import { buildCreateGiftTx, networkPassphrase, submitSignedInvocation } from '@giffy/chain';
import { Types } from 'mongoose';

import { GiftModel, type GiftDocument } from '../models/Gift.js';
import { generateClaimToken, hashClaimToken } from '../utils/claimToken.js';
import { GiftNotDraftError, GiftNotFoundError, InvalidGiftStateError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { buildClaimUrl, buildContributeUrl, buildQrPayload } from '../utils/qrPayload.js';
import type { CreateGiftInput } from '../validation/giftSchemas.js';
import { hashAnswer } from './conditionService.js';

/**
 * Gift lifecycle orchestration (README §12.3).
 *
 * Every state-changing action here is one leg of the build → sign → submit handshake
 * (§7.3 principle 4, §12.1). This service builds unsigned XDR and forwards signed
 * XDR; it never holds a key, and no code path in it could use one if it wanted to
 * (§17.1). Every gift — group or not, conditional or not — goes through exactly this
 * one path (§2.2): there is no branch anywhere in here for "the simple kind".
 */

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
  status: string;
}

/**
 * Known testnet Stellar Asset Contract addresses, keyed by asset code.
 *
 * `/chain`'s `assets.ts` owns SAC/asset resolution generally (§9); this is a narrow,
 * backend-local mirror kept here rather than invented as a new chain export this
 * task isn't scoped to add. Swap for a real resolver (or a chain-layer export) once
 * `/chain`'s Soroban rewrite lands.
 */
const KNOWN_TESTNET_TOKEN_CONTRACTS: Record<string, string> = {
  XLM: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
};

function resolveTokenContractId(assetCode: string, assetIssuer: string | null): string {
  const known = KNOWN_TESTNET_TOKEN_CONTRACTS[assetCode];
  if (known) return known;

  if (!assetIssuer) {
    throw new InvalidGiftStateError(`Unknown asset "${assetCode}" with no issuer to resolve a SAC for.`);
  }

  // Placeholder deterministic-looking id for any issued asset not in the known-fixture
  // map above. Real SAC resolution belongs in `/chain` (README §9's `assets.ts`).
  return `SAC_${assetCode}_${assetIssuer}`;
}

/**
 * Creates the `draft` row. Nothing touches the ledger yet — the sender has committed
 * to nothing at this point, and a draft that is never submitted simply goes stale.
 *
 * The `claimTokenHash` stored here is a placeholder: it hashes a token that is
 * generated, never returned to anyone, and immediately discarded. The column is
 * required and uniquely indexed, but the *real* claim token is not minted until
 * submit succeeds (see `submitCreateTransaction`), because a link handed out before
 * the funds are locked on-chain would be a link to nothing.
 */
export async function createDraft(input: CreateGiftInput): Promise<GiftDocument> {
  const expiresAt = new Date(Date.now() + input.expiresInSeconds * 1000);
  const tokenContractId = resolveTokenContractId(input.assetCode, input.assetIssuer ?? null);

  const condition = input.condition ?? { type: 'none' as const };

  const gift = await GiftModel.create({
    senderPublicKey: input.senderPublicKey,
    receiverPublicKey: input.receiverPublicKey,
    assetCode: input.assetCode,
    assetIssuer: input.assetIssuer ?? null,
    tokenContractId,
    amount: input.amount,
    message: input.message,
    theme: input.theme,
    claimTokenHash: hashClaimToken(generateClaimToken()),
    status: 'draft',
    expiresAt,
    isGroupGift: input.isGroupGift ?? false,
    goalAmount: input.goalAmount ?? null,
    contributions: [],
    condition: toStoredCondition(condition),
  });

  logger.info({ giftId: gift.id, status: gift.status }, 'Gift draft created');

  return gift;
}

function toStoredCondition(condition: CreateGiftInput['condition']): Record<string, unknown> {
  if (!condition || condition.type === 'none') {
    return { type: 'none' };
  }

  if (condition.type === 'trivia') {
    return {
      type: 'trivia',
      question: condition.question,
      answerHash: hashAnswer(condition.answer),
      stepsCompleted: 0,
    };
  }

  // stepGate
  return {
    type: 'stepGate',
    steps: condition.steps,
    stepsCompleted: 0,
    stepUnlockerPublicKey: condition.stepUnlockerPublicKey ?? null,
  };
}

/**
 * Builds the unsigned `create_gift` invocation for a draft.
 *
 * Re-validates the draft's expiry and status server-side before building anything
 * (§17.3), which is what stops a stale frontend from re-submitting an action the
 * gift has already moved past. `pending_chain` is allowed as well as `draft`: a
 * sender who dismisses the Freighter prompt and retries must be able to rebuild.
 */
export async function buildCreateTransaction(giftId: string): Promise<BuiltTransaction> {
  const gift = await findGiftOrThrow(giftId);

  if (gift.status !== 'draft' && gift.status !== 'pending_chain') {
    throw new GiftNotDraftError('This gift has already been submitted.');
  }

  if (gift.expiresAt.getTime() <= Date.now()) {
    throw new InvalidGiftStateError(
      'This gift draft has expired before it was sent. Please compose it again.',
    );
  }

  const messageHash = createHash('sha256').update(gift.message).digest();

  const xdr = await buildCreateGiftTx({
    sourcePublicKey: gift.senderPublicKey,
    receiverPublicKey: gift.receiverPublicKey,
    tokenContractId: gift.tokenContractId,
    initialAmount: gift.amount,
    expiresAt: gift.expiresAt,
    condition: toConditionInput(gift),
    stepUnlockerPublicKey: gift.condition.stepUnlockerPublicKey ?? gift.senderPublicKey,
    messageHash,
  });

  gift.status = 'pending_chain';
  await gift.save();

  logger.info({ giftId: gift.id }, 'Create transaction built');

  return { xdr, networkPassphrase };
}

function toConditionInput(gift: GiftDocument): {
  type: 'none' | 'trivia' | 'stepGate';
  answerHash?: Buffer;
  totalSteps?: number;
} {
  switch (gift.condition.type) {
    case 'trivia':
      return { type: 'trivia', answerHash: Buffer.from(gift.condition.answerHash ?? '', 'hex') };
    case 'stepGate':
      return { type: 'stepGate', totalSteps: gift.condition.steps?.length ?? 0 };
    default:
      return { type: 'none' };
  }
}

/**
 * Submits the sender-signed create transaction and mints the claim link.
 *
 * The `contractGiftId` is only knowable from the network's result — it is the u64
 * the contract itself assigned (§4.1) — so it cannot be predicted before submission.
 * Everything downstream (contribute, claim, refund, reconciliation) keys off the
 * value read back here.
 */
export async function submitCreateTransaction(
  giftId: string,
  signedXdr: string,
): Promise<SubmittedGift> {
  const gift = await findGiftOrThrow(giftId);

  if (gift.status !== 'pending_chain') {
    throw new GiftNotDraftError(
      gift.status === 'draft'
        ? 'This gift has no built transaction to submit yet.'
        : `This gift is already ${gift.status}.`,
    );
  }

  const { txHash, returnValue } = await submitSignedInvocation(signedXdr);
  const contractGiftId = String(returnValue);

  const rawToken = generateClaimToken();
  const claimUrl = buildClaimUrl(rawToken);

  gift.status = 'active';
  gift.contractGiftId = contractGiftId;
  gift.txHashCreate = txHash;
  gift.claimTokenHash = hashClaimToken(rawToken);
  gift.contributions.splice(0, gift.contributions.length);
  gift.contributions.push({
    contributorPublicKey: gift.senderPublicKey,
    amount: gift.amount,
    txHash,
    contributedAt: new Date(),
  });
  await gift.save();

  logger.info({ giftId: gift.id, contractGiftId, txHash }, 'Gift is active on-chain');

  return {
    claimUrl,
    qrPayload: buildQrPayload(claimUrl),
    ...(gift.isGroupGift ? { contributeUrl: buildContributeUrl(gift.id) } : {}),
    contractGiftId,
    txHash,
    status: gift.status,
  };
}

/**
 * Lists a sender's gifts.
 *
 * Scoped by a client-supplied public key rather than an authenticated session — see
 * §17.10 on why that is an accepted v1 tradeoff. Drafts are included so a sender can
 * see an attempt that never made it on-chain.
 */
export async function listGiftsBySender(senderPublicKey: string): Promise<GiftDocument[]> {
  return GiftModel.find({ senderPublicKey }).sort({ createdAt: -1 }).limit(100).exec();
}

export async function getGiftById(giftId: string, senderPublicKey: string): Promise<GiftDocument> {
  const gift = await findGiftOrThrow(giftId);

  if (gift.senderPublicKey !== senderPublicKey) {
    // Reported as not-found rather than forbidden: whether a given id exists is not
    // something a non-owner needs confirmed.
    throw new GiftNotFoundError();
  }

  return gift;
}

/** Shared loader. Treats a malformed id as simply not found. */
export async function findGiftOrThrow(giftId: string): Promise<GiftDocument> {
  if (!Types.ObjectId.isValid(giftId)) {
    throw new GiftNotFoundError();
  }

  const gift = await GiftModel.findById(giftId).exec();

  if (!gift) {
    throw new GiftNotFoundError();
  }

  return gift;
}
