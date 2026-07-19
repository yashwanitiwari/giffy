'use client';

/**
 * Level 1 — `useWallet()` hook wiring the Freighter + SDK layers together for
 * the `/wallet` demo panel. Owns all wallet state and every async action, each
 * guarded with try/catch and its own loading flag (Requirement 5).
 */
import { useCallback, useEffect, useState } from 'react';

import { fetchXlmBalance, buildPaymentXdr, submitSignedTx } from '@/lib/stellar-sdk';
import {
  connectWallet,
  detectFreighter,
  getWalletAddress,
  signTx,
} from '@/lib/stellar-wallet';

export interface UseWalletResult {
  installed: boolean | null;
  address: string | null;
  balance: string | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  refreshBalance: () => Promise<void>;
  sendXlm: (to: string, amount: string) => Promise<{ hash: string }>;
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function useWallet(): UseWalletResult {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBalance = useCallback(async (addr: string) => {
    const bal = await fetchXlmBalance(addr);
    setBalance(bal);
  }, []);

  // Detect Freighter and restore any previously-granted session on mount.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const present = await detectFreighter();
        if (cancelled) return;
        setInstalled(present);
        if (!present) return;

        const addr = await getWalletAddress();
        if (cancelled || !addr) return;
        setAddress(addr);
        await loadBalance(addr);
      } catch (err) {
        if (!cancelled) setError(messageOf(err, 'Failed to initialise wallet.'));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadBalance]);

  const connect = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const addr = await connectWallet();
      setAddress(addr);
      setInstalled(true);
      await loadBalance(addr);
    } catch (err) {
      setError(messageOf(err, 'Failed to connect wallet.'));
    } finally {
      setIsLoading(false);
    }
  }, [loadBalance]);

  const disconnect = useCallback(() => {
    // Freighter exposes no revoke API — forget the local session only.
    setAddress(null);
    setBalance(null);
    setError(null);
  }, []);

  const refreshBalance = useCallback(async () => {
    if (!address) return;
    setIsLoading(true);
    setError(null);
    try {
      await loadBalance(address);
    } catch (err) {
      setError(messageOf(err, 'Failed to refresh balance.'));
    } finally {
      setIsLoading(false);
    }
  }, [address, loadBalance]);

  const sendXlm = useCallback(
    async (to: string, amount: string): Promise<{ hash: string }> => {
      if (!address) throw new Error('Connect a wallet before sending.');

      setIsLoading(true);
      setError(null);
      try {
        const xdr = await buildPaymentXdr(address, to, amount);
        const signedXdr = await signTx(xdr);
        const result = await submitSignedTx(signedXdr);
        // Reflect the debited balance right away.
        await loadBalance(address);
        return result;
      } catch (err) {
        const message = messageOf(err, 'Failed to send XLM.');
        setError(message);
        throw new Error(message);
      } finally {
        setIsLoading(false);
      }
    },
    [address, loadBalance],
  );

  return {
    installed,
    address,
    balance,
    isConnected: address !== null,
    isLoading,
    error,
    connect,
    disconnect,
    refreshBalance,
    sendXlm,
  };
}
