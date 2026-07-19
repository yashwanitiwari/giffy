'use client';

import { useCallback, useState } from 'react';
import useSWR from 'swr';

import { buildClaimTx, getClaimPreview, submitClaimTx } from '@/lib/apiClient';
import { TESTNET_PASSPHRASE } from '@/lib/network';
import type { GiftPreviewDTO } from '@/types/api';

import { useFreighter } from './useFreighter';

/**
 * Receiver claim flow (README §13.6 `useClaim`): preview/build/submit against a
 * claim token. `build` may include an `answer` field, sent only when the gift's
 * condition is `trivia` (§15.4) — omitted entirely for `none`/`stepGate`.
 */
export function useClaim(token: string) {
  const { signXdr } = useFreighter();
  const [isClaiming, setIsClaiming] = useState(false);

  const { data: preview, error, mutate } = useSWR(
    token ? `/claim/${token}` : null,
    () => getClaimPreview(token),
    { shouldRetryOnError: false, revalidateOnFocus: false },
  );

  const claim = useCallback(
    async (claimantPublicKey: string, answer?: string) => {
      setIsClaiming(true);
      try {
        const built = await buildClaimTx(token, claimantPublicKey, answer);
        const signedXdr = await signXdr(built.xdr, TESTNET_PASSPHRASE);
        return await submitClaimTx(token, signedXdr);
      } finally {
        setIsClaiming(false);
      }
    },
    [token, signXdr],
  );

  return {
    preview: preview as GiftPreviewDTO | undefined,
    error,
    isClaiming,
    claim,
    refresh: mutate,
  };
}
