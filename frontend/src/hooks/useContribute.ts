'use client';

import { useCallback, useState } from 'react';
import useSWR from 'swr';

import { buildContributeTx, getGroupSummary, submitContributeTx } from '@/lib/apiClient';
import { TESTNET_PASSPHRASE } from '@/lib/network';
import type { GroupSummaryDTO } from '@/types/api';

import { useFreighter } from './useFreighter';

/**
 * Group-contribution build/submit against a single gift (README §13.6 `useContribute`).
 *
 * `groupSummary` is public (no sender/receiver-private data, §15.2) and is
 * revalidated after every successful contribution rather than incremented
 * locally — the backend itself re-reads the contract's `get_gift` after every
 * submit and never trusts its own running tally (§7.2 step 4, §12.6).
 */
export function useContribute(giftId: string | null) {
  const { publicKey, signXdr } = useFreighter();
  const [isContributing, setIsContributing] = useState(false);

  const { data: summary, isLoading, mutate } = useSWR(
    giftId ? `/gifts/${giftId}/group-summary` : null,
    () => getGroupSummary(giftId as string),
    { shouldRetryOnError: false },
  );

  const contribute = useCallback(
    async (amount: string) => {
      if (!giftId || !publicKey) throw new Error('Connect your wallet first.');
      setIsContributing(true);
      try {
        const built = await buildContributeTx(giftId, publicKey, amount);
        const signedXdr = await signXdr(built.xdr, TESTNET_PASSPHRASE);
        const result = await submitContributeTx(giftId, publicKey, amount, signedXdr);
        await mutate();
        return result;
      } finally {
        setIsContributing(false);
      }
    },
    [giftId, publicKey, signXdr, mutate],
  );

  return {
    summary: summary as GroupSummaryDTO | undefined,
    isLoading,
    isContributing,
    contribute,
    refresh: mutate,
  };
}
