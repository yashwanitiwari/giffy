'use client';

import { useState } from 'react';

import { TESTNET_PASSPHRASE } from '@/lib/network';
import { buildDepositTx, submitPoolTx } from '@/lib/poolClient';
import { encodeSealedClaimLink, generateNote } from '@/lib/shieldedNote';
import { useFreighter } from './useFreighter';

/**
 * Sender flow for a *sealed* gift. Mints a note in the browser, deposits its
 * commitment into the confidential pool (locking the fixed denomination), and
 * returns a sealed claim link carrying the note secret in its fragment.
 *
 * The recipient address is NOT needed on-chain: a sealed gift is a bearer note,
 * claimable by whoever holds the link (they bind it to their own wallet when
 * they withdraw). The amount never appears on the ledger.
 */

export type SealedDepositPhase = 'idle' | 'signing' | 'submitting' | 'done' | 'error';

export function useSealedDeposit() {
  const { publicKey, signXdr } = useFreighter();
  const [phase, setPhase] = useState<SealedDepositPhase>('idle');
  const [claimLink, setClaimLink] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deposit = async (): Promise<void> => {
    if (!publicKey) return;
    setError(null);
    try {
      // 1. Mint the note (secret + commitment) client-side.
      const note = await generateNote();

      // 2. Backend builds + simulates the deposit; sign + submit.
      const built = await buildDepositTx(publicKey, note.commitmentHex);
      setPhase('signing');
      const signed = await signXdr(built.xdr, TESTNET_PASSPHRASE);
      setPhase('submitting');
      const res = await submitPoolTx(signed, 'deposit');

      setClaimLink(encodeSealedClaimLink(window.location.origin, note.secretHex));
      setTxHash(res.txHash);
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the sealed gift.');
      setPhase('error');
    }
  };

  return { phase, claimLink, txHash, error, deposit };
}
