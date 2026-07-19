import { buildRefundTx, networkPassphrase, submitSignedInvocation } from '@giffy/chain';

import { GiftModel, type GiftDocument } from '../models/Gift.js';
import { RefundNotEligibleError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { findGiftOrThrow, type BuiltTransaction } from './giftService.js';
import { reconcileGift } from './reconciliationService.js';

/**
 * The reclaim path (README §12.7).
 *
 * `refund` is a single contract call that pays back every contributor pro-rata in
 * one invocation (§7.5) — there is no per-contributor refund leg to orchestrate here,
 * unlike a dual-mode design's classic reclaim. Any contributor or the original
 * sender may call it (§15.5); the contract itself decides who is eligible, not this
 * service.
 */

/** The cron's sweep query, served by the `{ status, expiresAt }` index (§12.1). */
export async function findExpiredActiveGifts(limit = 500): Promise<GiftDocument[]> {
  return GiftModel.find({ status: 'active', expiresAt: { $lt: new Date() } })
    .limit(limit)
    .exec();
}

/**
 * Flips one expired gift to `refund_pending`.
 *
 * Conditioned on `status: 'active'` in the query itself rather than checked and then
 * written: a receiver's claim can land between the sweep's read and this write, and
 * an unconditional update would stomp `claimed` back to `refund_pending`, offering a
 * reclaim of funds that are already gone. Making the guard part of the update lets
 * the database settle the race.
 */
export async function markRefundPending(giftId: string): Promise<boolean> {
  const result = await GiftModel.updateOne(
    { _id: giftId, status: 'active', expiresAt: { $lt: new Date() } },
    { $set: { status: 'refund_pending' } },
  ).exec();

  return result.modifiedCount === 1;
}

/**
 * Builds the unsigned `refund` invocation for whichever contributor (or the sender)
 * is asking.
 *
 * Eligibility is re-derived from the stored `expiresAt`, never from the client and
 * never from the `refund_pending` flag alone (§17.3) — the flag is a cron artifact
 * that may not have run yet, so an `active` gift past its expiry is equally eligible.
 * `require_auth` on `callerPublicKey`, and the contract's own
 * `NotSenderOrContributor` check, are what actually gate who this transaction can
 * succeed for — this is only an early, clearer refusal (§11.5).
 */
export async function buildRefundTransaction(
  giftId: string,
  callerPublicKey: string,
): Promise<BuiltTransaction> {
  const gift = await findGiftOrThrow(giftId);

  assertRefundable(gift);

  if (!gift.contractGiftId) {
    throw new RefundNotEligibleError('This gift was never locked on-chain.');
  }

  const xdr = await buildRefundTx({
    callerPublicKey,
    contractGiftId: BigInt(gift.contractGiftId),
  });

  logger.info({ giftId: gift.id, callerPublicKey }, 'Refund transaction built');

  return { xdr, networkPassphrase };
}

export async function submitRefundTransaction(
  giftId: string,
  signedXdr: string,
): Promise<{ status: string; txHash: string }> {
  const gift = await findGiftOrThrow(giftId);

  assertRefundable(gift);

  const { txHash } = await submitSignedInvocation(signedXdr);

  gift.txHashRefund = txHash;
  await gift.save();

  const { status } = await reconcileGift(gift.id); // will observe status -> refunded

  logger.info({ giftId: gift.id, txHash }, 'Gift refunded');

  return { status, txHash };
}

function assertRefundable(gift: GiftDocument): void {
  switch (gift.status) {
    case 'active':
    case 'refund_pending':
      break;

    case 'claimed':
      throw new RefundNotEligibleError('This gift was already claimed by its receiver.');

    case 'refunded':
      throw new RefundNotEligibleError('This gift has already been reclaimed.');

    default:
      throw new RefundNotEligibleError('This gift was never locked on-chain.');
  }

  if (gift.expiresAt.getTime() > Date.now()) {
    // The contract's own `refund` check would reject this outright
    // (`GiftNotYetExpired`). Refusing here says why, in a sentence.
    throw new RefundNotEligibleError();
  }
}
