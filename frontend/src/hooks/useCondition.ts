'use client';

import { useCallback, useState } from 'react';

import { buildUnlockStepTx, submitUnlockStepTx, verifyAnswer } from '@/lib/apiClient';
import { TESTNET_PASSPHRASE } from '@/lib/network';

import { useFreighter } from './useFreighter';

/**
 * Claim-condition helpers (README §13.6 `useCondition`): a fast backend
 * pre-check for trivia answers (§15.3, §16.2 — never authoritative on its own,
 * the contract's own `claim` check is), plus build/submit for sender-side
 * step unlocking (§7.4).
 */
export function useCondition(giftId: string | null) {
  const { publicKey, signXdr } = useFreighter();
  const [isVerifying, setIsVerifying] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);

  /** Fast pre-check against `POST /claim/:token/verify-answer` — gates the claim button only. */
  const checkAnswer = useCallback(async (token: string, answer: string): Promise<boolean> => {
    setIsVerifying(true);
    try {
      const { verified } = await verifyAnswer(token, answer);
      return verified;
    } finally {
      setIsVerifying(false);
    }
  }, []);

  /** Build → sign → submit a single `unlock_step` invocation (§7.4, §13.5). */
  const unlockNextStep = useCallback(
    async (unlockerPublicKey?: string) => {
      if (!giftId) throw new Error('Missing gift id.');
      const unlocker = unlockerPublicKey ?? publicKey;
      if (!unlocker) throw new Error('Connect your wallet first.');

      setIsUnlocking(true);
      try {
        const built = await buildUnlockStepTx(giftId, unlocker);
        const signedXdr = await signXdr(built.xdr, TESTNET_PASSPHRASE);
        return await submitUnlockStepTx(giftId, signedXdr);
      } finally {
        setIsUnlocking(false);
      }
    },
    [giftId, publicKey, signXdr],
  );

  return { isVerifying, isUnlocking, checkAnswer, unlockNextStep };
}
