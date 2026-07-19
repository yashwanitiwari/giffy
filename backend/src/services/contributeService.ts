import { buildContributeTx, networkPassphrase, submitSignedInvocation } from '@giffy/chain';

import { env } from '../config/env.js';
import { GiftModel } from '../models/Gift.js';
import { ContributionTooSmallError, GiftNotFoundError, GiftNotOpenError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { BuiltTransaction } from './giftService.js';
import { reconcileGift } from './reconciliationService.js';

/**
 * Group-contribution handling (README §12.4).
 *
 * Any gift can accept contributions once `isGroupGift` was set at creation — there
 * is no separate on-chain representation for "a group gift" versus "a plain gift"
 * (§2.2); `contribute` is simply a call this backend chooses to expose a link and UI
 * for, or not (§17.4).
 */

export interface GroupSummaryDTO {
  assetCode: string;
  total: string;
  goal: string | null;
  contributions: { contributorLabel: string; amount: string }[];
  status: string;
}

/** Public summary for the contribution page (README §15.2). No sender/receiver-private data. */
export async function getPublicSummary(giftId: string): Promise<GroupSummaryDTO> {
  const gift = await GiftModel.findById(giftId).exec();
  if (!gift) throw new GiftNotFoundError();

  return {
    assetCode: gift.assetCode,
    total: gift.amount,
    goal: gift.goalAmount ?? null,
    contributions: gift.contributions.map((c) => ({
      contributorLabel: c.contributorPublicKey,
      amount: c.amount,
    })),
    status: gift.status,
  };
}

/** Builds the unsigned `contribute` invocation for a would-be contributor. */
export async function buildContributeTransaction(
  giftId: string,
  contributorPublicKey: string,
  amount: string,
): Promise<BuiltTransaction> {
  const gift = await GiftModel.findById(giftId).exec();
  if (!gift || gift.status !== 'active') {
    throw new GiftNotOpenError('This gift is not currently accepting contributions.');
  }
  if (Number(amount) < env.MIN_CONTRIBUTION_AMOUNT) {
    throw new ContributionTooSmallError(
      `Contributions must be at least ${env.MIN_CONTRIBUTION_AMOUNT}.`,
    );
  }

  const xdr = await buildContributeTx({
    contributorPublicKey,
    contractGiftId: BigInt(gift.contractGiftId!),
    amount,
  });

  logger.info({ giftId: gift.id, contributorPublicKey }, 'Contribute transaction built');

  return { xdr, networkPassphrase };
}

/** Submits a signed contribution, reconciles the new total, and records the row. */
export async function submitContributeTransaction(
  giftId: string,
  contributorPublicKey: string,
  amount: string,
  signedXdr: string,
): Promise<{ txHash: string; newTotal: string }> {
  const { txHash } = await submitSignedInvocation(signedXdr);
  const { newTotal } = await reconcileGift(giftId);

  await GiftModel.updateOne(
    { _id: giftId },
    {
      $push: {
        contributions: { contributorPublicKey, amount, txHash, contributedAt: new Date() },
      },
    },
  ).exec();

  logger.info({ giftId, contributorPublicKey, txHash, newTotal }, 'Contribution recorded');

  return { txHash, newTotal };
}
