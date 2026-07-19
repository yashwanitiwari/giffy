import { createHash } from 'node:crypto';

import { buildUnlockStepTx, networkPassphrase, submitSignedInvocation } from '@giffy/chain';

import { GiftModel, type GiftDocument } from '../models/Gift.js';
import { NotStepGatedError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { BuiltTransaction } from './giftService.js';
import { reconcileGift } from './reconciliationService.js';

/**
 * Trivia hashing and step-gate unlocking (README §12.5).
 *
 * `claimService.ts` owns claim-token resolution and the claim handshake itself
 * (including the condition *check* at claim time, §16.2); this file owns the
 * condition *primitives* — hashing an answer, and the sender-side step-unlock
 * build/submit legs — since both are used from more than one place (gift creation
 * hashes the sender's answer too, via `giftService.createDraft`).
 */

/**
 * Normalizes and hashes a trivia answer.
 *
 * Case- and whitespace-insensitive (README §13.2's "Not case-sensitive, ignores
 * extra spaces"), and one-way: only the hash is ever persisted, on both the backend
 * document and the contract's own `AnswerHash` condition, so neither can leak the
 * plaintext answer even to someone reading the database directly.
 */
export function normalizeAnswer(rawAnswer: string): string {
  return rawAnswer.trim().toLowerCase();
}

export function hashAnswer(rawAnswer: string): string {
  return createHash('sha256').update(normalizeAnswer(rawAnswer)).digest('hex');
}

/**
 * Builds the unsigned `unlock_step` invocation for the sender (or whoever the gift
 * designates as `stepUnlockerPublicKey`, §17.6).
 */
export async function buildUnlockStepTransaction(
  giftId: string,
  unlockerPublicKey: string,
): Promise<BuiltTransaction> {
  const gift = await findStepGatedGift(giftId);

  const xdr = await buildUnlockStepTx({
    unlockerPublicKey,
    contractGiftId: BigInt(gift.contractGiftId!),
  });

  logger.info({ giftId: gift.id }, 'Unlock-step transaction built');

  return { xdr, networkPassphrase };
}

/** Submits the signed `unlock_step` invocation and reconciles the new step count. */
export async function submitUnlockStepTransaction(
  giftId: string,
  signedXdr: string,
): Promise<{ stepsCompleted: number }> {
  await findStepGatedGift(giftId);

  await submitSignedInvocation(signedXdr);
  const { stepsCompleted } = await reconcileGift(giftId);

  logger.info({ giftId, stepsCompleted }, 'Step unlocked');

  return { stepsCompleted };
}

async function findStepGatedGift(giftId: string): Promise<GiftDocument> {
  const gift = await GiftModel.findById(giftId).exec();

  if (!gift || gift.condition.type !== 'stepGate') {
    throw new NotStepGatedError();
  }

  return gift;
}
