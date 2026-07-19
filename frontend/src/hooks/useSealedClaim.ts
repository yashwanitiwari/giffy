'use client';

import { useState } from 'react';

import { TESTNET_PASSPHRASE } from '@/lib/network';
import {
  buildWithdrawTx,
  prepareWithdraw,
  recipientFieldFromPublicKey,
  submitPoolTx,
} from '@/lib/poolClient';

import { useFreighter } from './useFreighter';

/**
 * Receiver flow for a *sealed* gift (README: confidential-amount claim).
 *
 * Given the note secret from the claim link's fragment and the connected wallet,
 * this: derives the recipient binding, generates the withdraw proof in-browser
 * (~3 s), has the backend build the `withdraw` transaction, signs it with
 * Freighter, and submits. The secret never leaves the browser except inside the
 * proof, which reveals nothing about it.
 */

export type SealedClaimPhase = 'idle' | 'proving' | 'signing' | 'submitting' | 'done' | 'error';

export function useSealedClaim(secretHex: string | null) {
  const { publicKey, signXdr } = useFreighter();
  const [phase, setPhase] = useState<SealedClaimPhase>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const claim = async (): Promise<void> => {
    if (!secretHex || !publicKey) return;
    setError(null);
    try {
      // 1. Prove (fetches indexed leaves, rebuilds the path, runs the wasm prover).
      setPhase('proving');
      const recipientSignal = await recipientFieldFromPublicKey(publicKey);
      const proof = await prepareWithdraw(secretHex, recipientSignal);

      // 2. Backend builds + simulates the withdraw transaction.
      const built = await buildWithdrawTx({
        sourcePublicKey: publicKey,
        root: proof.root,
        nullifier: proof.nullifier,
        recipient: publicKey,
        recipientSignal,
        proof: { a: proof.a, b: proof.b, c: proof.c },
      });

      // 3. Sign + submit.
      setPhase('signing');
      const signed = await signXdr(built.xdr, TESTNET_PASSPHRASE);
      setPhase('submitting');
      const res = await submitPoolTx(signed, 'withdraw');

      setTxHash(res.txHash);
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not claim this sealed gift.');
      setPhase('error');
    }
  };

  return { phase, txHash, error, claim };
}
