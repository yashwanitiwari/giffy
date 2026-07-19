import { buildClaimTx, networkPassphrase, submitSignedInvocation } from '@giffy/chain';

import { ClaimEventModel, type ClaimEventType } from '../models/ClaimEvent.js';
import { GiftModel, type GiftDocument } from '../models/Gift.js';
import { hashClaimToken, isWellFormedClaimToken } from '../utils/claimToken.js';
import {
  ClaimWindowExpiredError,
  GiftNotFoundError,
  InvalidGiftStateError,
  NotClaimantError,
  StepsNotCompleteError,
  WrongAnswerError,
} from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { hashAnswer, normalizeAnswer } from './conditionService.js';
import type { BuiltTransaction } from './giftService.js';
import { reconcileGift } from './reconciliationService.js';

/**
 * Claim-link resolution and the receiver's claim handshake (README §12.5, §16.2).
 *
 * Unified across every gift: `condition.type` decides whether an extra check gates
 * the build step, but there is exactly one claim code path regardless of whether the
 * gift has one contributor or five, and regardless of condition (§2.2).
 */

export interface GiftPreviewDTO {
  assetCode: string;
  amount: string;
  message: string;
  theme: string;
  senderLabel: string;
  status: string;
  expiresAt: string;
  condition: { type: string; question: string | null };
}

/**
 * Resolves a claim link to its preview, and records the view.
 *
 * Every failure mode — malformed token, unknown token, deleted gift — raises the
 * same generic not-found (§6.2): distinguishing them would tell an enumerator which
 * of their guesses were real. Expiry is *not* folded into that: once a valid token
 * resolves, the holder is legitimate and gets an honest status.
 */
export async function resolveClaimToken(rawToken: string): Promise<GiftPreviewDTO> {
  const gift = await findGiftByToken(rawToken);

  // A drafted-but-never-submitted gift has no contract record on-chain, so its link
  // must not preview as though it were claimable.
  if (gift.status === 'draft' || gift.status === 'pending_chain') {
    throw new GiftNotFoundError();
  }

  // Fire-and-forget: the sender's audit trail is not worth failing a receiver's page
  // load over, and the receiver is never shown that this tracking happened.
  void logClaimEvent(gift.id, 'view');

  return toPreview(gift);
}

/**
 * Backend pre-check for a trivia answer (README §15.3, §16.2).
 *
 * Advisory only — the authoritative check is the contract's own `claim` logic
 * (§17.3) — but it lets the receiver's UI gate the claim button and show a specific
 * "try again" without ever building (and asking Freighter to sign) a transaction
 * that would only fail on-chain.
 */
export async function verifyAnswer(rawToken: string, rawAnswer: string): Promise<{ verified: true }> {
  const gift = await findGiftByToken(rawToken);

  if (gift.condition.type !== 'trivia') {
    throw new InvalidGiftStateError('This gift has no trivia condition to verify.');
  }

  const verified = hashAnswer(rawAnswer) === gift.condition.answerHash;

  // Metadata deliberately omits the raw answer itself (§14.2).
  void logClaimEvent(gift.id, 'answer_attempted', { verified });

  if (!verified) {
    throw new WrongAnswerError();
  }

  return { verified: true };
}

/**
 * Builds the unsigned `claim` invocation for the receiver.
 *
 * Re-checks status, expiry, claimant identity, and condition server-side against
 * stored state rather than trusting anything the client asserts (§17.3) — the
 * contract's own checks are authoritative, but building a doomed transaction wastes
 * a Freighter prompt.
 */
export async function buildClaimTransaction(
  rawToken: string,
  claimantPublicKey: string,
  rawAnswer?: string,
): Promise<BuiltTransaction> {
  const gift = await findGiftByToken(rawToken);

  assertClaimable(gift);

  if (claimantPublicKey !== gift.receiverPublicKey) {
    // The contract would refuse this too (`NotReceiver`), but building nothing here
    // keeps the message specific rather than a failed-simulation error.
    throw new NotClaimantError();
  }

  if (gift.condition.type === 'trivia') {
    const verified = Boolean(rawAnswer) && hashAnswer(rawAnswer!) === gift.condition.answerHash;
    void logClaimEvent(gift.id, 'answer_attempted', { verified });
    if (!verified) {
      throw new WrongAnswerError();
    }
  }

  if (gift.condition.type === 'stepGate') {
    const total = gift.condition.steps?.length ?? 0;
    if (gift.condition.stepsCompleted < total) {
      throw new StepsNotCompleteError();
    }
  }

  if (!gift.contractGiftId) {
    throw new InvalidGiftStateError('This gift has no on-chain record to claim.');
  }

  const xdr = await buildClaimTx({
    claimantPublicKey,
    contractGiftId: BigInt(gift.contractGiftId),
    // The contract hashes the bytes it receives verbatim (`sha256(provided)`), while
    // the stored `AnswerHash` was computed over the *normalized* answer (§13.2, via
    // `hashAnswer`). Send the same normalized form so the on-chain hashes match —
    // otherwise a correct-but-differently-cased answer fails only at claim time.
    ...(gift.condition.type === 'trivia' && rawAnswer !== undefined
      ? { answerPlaintext: normalizeAnswer(rawAnswer) }
      : {}),
  });

  void logClaimEvent(gift.id, 'claim_attempted');

  logger.info({ giftId: gift.id }, 'Claim transaction built');

  return { xdr, networkPassphrase };
}

/**
 * Submits the receiver-signed claim.
 *
 * The window is re-checked once more here: minutes can pass between build and submit
 * while a wallet prompt sits unanswered, and this is the last point at which Giffy
 * can produce a clearer error than the contract's.
 */
export async function submitClaimTransaction(
  rawToken: string,
  signedXdr: string,
): Promise<{ status: string; txHash: string }> {
  const gift = await findGiftByToken(rawToken);

  assertClaimable(gift);

  let txHash: string;
  try {
    const result = await submitSignedInvocation(signedXdr);
    txHash = result.txHash;
  } catch (err) {
    const errorCode = err instanceof Error && 'code' in err ? String(err.code) : 'CHAIN_ERROR';
    void logClaimEvent(gift.id, 'claim_failed', { errorCode });
    throw err;
  }

  gift.txHashClaim = txHash;
  await gift.save();

  const { status } = await reconcileGift(gift.id);

  void logClaimEvent(gift.id, 'claim_succeeded', { txHash });

  logger.info({ giftId: gift.id, txHash }, 'Gift claimed');

  return { status, txHash };
}

/**
 * Appends to the sender's audit trail (§14.2). Never throws: this collection is
 * observability, and losing a row must not fail a user's claim.
 */
export async function logClaimEvent(
  giftId: string,
  eventType: ClaimEventType,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await ClaimEventModel.create({ giftId, eventType, metadata });
  } catch (err) {
    logger.warn({ err, giftId, eventType }, 'Failed to record claim event');
  }
}

/** Shared gate for the claim legs, so both refuse identically. */
function assertClaimable(gift: GiftDocument): void {
  switch (gift.status) {
    case 'active':
      break;

    case 'claimed':
      throw new InvalidGiftStateError('This gift has already been claimed.');

    case 'refund_pending':
    case 'refunded':
      throw new ClaimWindowExpiredError();

    default:
      throw new GiftNotFoundError();
  }

  // `refund_pending` is only set by a cron sweep, so an `active` gift can still be
  // past its expiry here. The stored timestamp, not the flag, is authoritative.
  if (gift.expiresAt.getTime() <= Date.now()) {
    throw new ClaimWindowExpiredError();
  }
}

/**
 * Looks a gift up by the hash of its token. The raw token is never stored, so this
 * hash comparison is the only place a claim link is ever resolved (§17.2).
 */
export async function findGiftByToken(rawToken: string): Promise<GiftDocument> {
  if (!isWellFormedClaimToken(rawToken)) {
    throw new GiftNotFoundError();
  }

  const gift = await GiftModel.findOne({ claimTokenHash: hashClaimToken(rawToken) }).exec();

  if (!gift) {
    throw new GiftNotFoundError();
  }

  return gift;
}

function toPreview(gift: GiftDocument): GiftPreviewDTO {
  return {
    assetCode: gift.assetCode,
    amount: gift.amount,
    message: gift.message,
    theme: gift.theme,
    senderLabel: toSenderLabel(gift.senderPublicKey),
    status: gift.status,
    expiresAt: gift.expiresAt.toISOString(),
    condition: {
      type: gift.condition.type,
      question: gift.condition.type === 'trivia' ? (gift.condition.question ?? null) : null,
    },
  };
}

/**
 * Giffy has no profile system, so there is no display name to show — a truncated
 * address is the honest fallback, and the full key is withheld because the preview is
 * public to anyone holding the link and the sender never chose to publish it there.
 */
function toSenderLabel(publicKey: string): string {
  return `${publicKey.slice(0, 4)}…${publicKey.slice(-4)}`;
}
