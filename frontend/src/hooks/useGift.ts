'use client';

import { useCallback, useState } from 'react';
import useSWR from 'swr';

import {
  buildCreateGiftTx,
  buildRefundTx,
  createGift,
  listGifts,
  submitCreateGiftTx,
  submitRefundTx,
} from '@/lib/apiClient';
import type { CreateGiftRequest, GiftDTO, SubmittedGift } from '@/types/api';

import { useFreighter } from './useFreighter';

/**
 * Gift creation + sender dashboard listing (README §13.6 `useGift`).
 *
 * Always contract-backed now — there's no "simple gift" vs "advanced gift" branch
 * here, only one `create_gift` invocation per gift regardless of which optional
 * fields (contribution, condition) were set (§13.2 step 6).
 */
export function useGift(senderPublicKey?: string | null) {
  const { signXdr } = useFreighter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data, isLoading, mutate } = useSWR(
    senderPublicKey ? `/gifts?senderPublicKey=${senderPublicKey}` : null,
    () => listGifts(senderPublicKey as string),
    { refreshInterval: 30_000 },
  );

  /** Draft → build → Freighter sign → submit, in one call (§8.2). */
  const send = useCallback(
    async (input: CreateGiftRequest): Promise<SubmittedGift> => {
      setIsSubmitting(true);
      try {
        const { giftId } = await createGift(input);
        const built = await buildCreateGiftTx(giftId);
        const signedXdr = await signXdr(built.xdr, built.networkPassphrase);
        return await submitCreateGiftTx(giftId, signedXdr);
      } finally {
        setIsSubmitting(false);
      }
    },
    [signXdr],
  );

  /** Build → sign → submit a refund for `giftId`, callable by sender or any contributor (§7.5). */
  const refund = useCallback(
    async (giftId: string, callerPublicKey: string) => {
      const built = await buildRefundTx(giftId, callerPublicKey);
      const signedXdr = await signXdr(built.xdr, built.networkPassphrase);
      return submitRefundTx(giftId, signedXdr);
    },
    [signXdr],
  );

  return {
    gifts: (data?.gifts ?? []) as GiftDTO[],
    isLoading,
    isSubmitting,
    send,
    refund,
    refresh: mutate,
  };
}
