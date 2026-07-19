import { getGift } from '@giffy/chain';

import { GiftModel, type GiftStatus } from '../models/Gift.js';

/**
 * The shared `get_gift`-based cache-overwrite (README §12.6).
 *
 * Central to every action now, not just the group/condition-specific ones a
 * dual-mode design would have limited it to (§2.2): because *every* gift goes
 * through the contract, every state-changing submission — creation, contribution,
 * step unlocking, claiming, refunding — ends by calling this function rather than
 * each service independently updating its own slice of the MongoDB document. It is
 * also what the periodic sweep in `jobs/reconciliationCron.ts` calls for every
 * still-open gift, since any address can call `contribute`/`unlock_step` against a
 * gift id outside of Giffy's own frontend (§12.8, §17.4).
 */

export interface ReconciliationResult {
  status: GiftStatus;
  newTotal: string;
  stepsCompleted: number;
}

export async function reconcileGift(giftId: string): Promise<ReconciliationResult> {
  const gift = await GiftModel.findById(giftId).exec();
  if (!gift?.contractGiftId) {
    throw new Error('Gift has no on-chain record to reconcile against');
  }

  // getGift's simulation needs a syntactically valid, funded source account but
  // never charges or signs with it — the gift's own sender account always
  // qualifies, since it necessarily funded the create_gift call already.
  const onChain = await getGift(gift.senderPublicKey, BigInt(gift.contractGiftId));
  const status = mapContractStatus(onChain.status);

  await GiftModel.updateOne(
    { _id: giftId },
    {
      $set: {
        amount: onChain.totalAmount,
        status,
        'condition.stepsCompleted': onChain.stepsCompleted,
      },
    },
  ).exec();

  return {
    status,
    newTotal: onChain.totalAmount,
    stepsCompleted: onChain.stepsCompleted,
  };
}

function mapContractStatus(onChainStatus: 'Open' | 'Claimed' | 'Refunded'): GiftStatus {
  switch (onChainStatus) {
    case 'Open':
      return 'active';
    case 'Claimed':
      return 'claimed';
    case 'Refunded':
      return 'refunded';
  }
}
