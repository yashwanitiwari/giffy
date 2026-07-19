'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { apiGet, apiPost } from '@/lib/apiClient';
import type {
  ChallengeResponse,
  DepositResponse,
  DepositStatusResponse,
  SessionTokenResponse,
} from '@/types/api';

import { useFreighter } from './useFreighter';

/**
 * SEP-10 auth + SEP-24 interactive deposit orchestration (README §11.4, §6.1 step 2).
 *
 * The flow: backend builds the SEP-10 challenge → Freighter signs it → backend
 * exchanges it for an anchor JWT it keeps server-side, returning an opaque session
 * token → backend initiates the deposit → this hook polls the status route until a
 * terminal state.
 */

export type OnrampPhase =
  | 'idle'
  | 'authenticating'
  | 'depositing'
  | 'polling'
  | 'completed'
  | 'error';

const TERMINAL_FAILURES = new Set(['error', 'no_market', 'too_small', 'too_large', 'expired']);
const POLL_INTERVAL_MS = 4000;

export function useOnramp() {
  const { publicKey, signXdr } = useFreighter();

  const [phase, setPhase] = useState<OnrampPhase>('idle');
  const [interactiveUrl, setInteractiveUrl] = useState<string | null>(null);
  const [anchorStatus, setAnchorStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    setPhase('idle');
    setInteractiveUrl(null);
    setAnchorStatus(null);
    setError(null);
  }, [stopPolling]);

  const start = useCallback(
    async (assetCode: string) => {
      if (!publicKey) {
        setError('Connect your wallet first.');
        setPhase('error');
        return;
      }

      try {
        setError(null);
        setPhase('authenticating');

        const challenge = await apiPost<ChallengeResponse>('/onramp/sep10-challenge', {
          publicKey,
        });

        // SEP-10 challenges are signed against the testnet passphrase — the anchor
        // and Giffy both run on testnet (README §5.3).
        const signedXdr = await signXdr(challenge.xdr, 'Test SDF Network ; September 2015');

        const { sessionToken } = await apiPost<SessionTokenResponse>('/onramp/sep10-submit', {
          publicKey,
          signedXdr,
        });

        setPhase('depositing');

        const deposit = await apiPost<DepositResponse>('/onramp/sep24-deposit', {
          sessionToken,
          assetCode,
        });

        setInteractiveUrl(deposit.interactiveUrl);
        setPhase('polling');

        pollTimer.current = setInterval(async () => {
          try {
            const status = await apiGet<DepositStatusResponse>(
              `/onramp/sep24-status/${deposit.sessionId}`,
            );
            setAnchorStatus(status.message ?? status.status);

            if (status.status === 'completed') {
              stopPolling();
              setPhase('completed');
            } else if (TERMINAL_FAILURES.has(status.status)) {
              stopPolling();
              setError(status.message ?? `The anchor reported: ${status.status}`);
              setPhase('error');
            }
          } catch {
            // Transient poll failure — keep polling; the next tick may succeed.
          }
        }, POLL_INTERVAL_MS);
      } catch (err) {
        stopPolling();
        setError(err instanceof Error ? err.message : 'The on-ramp flow failed.');
        setPhase('error');
      }
    },
    [publicKey, signXdr, stopPolling],
  );

  return { phase, interactiveUrl, anchorStatus, error, start, reset };
}
