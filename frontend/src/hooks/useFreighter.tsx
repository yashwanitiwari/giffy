'use client';

import {
  getAddress,
  getNetwork,
  isConnected,
  requestAccess,
  signTransaction,
} from '@stellar/freighter-api';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * Freighter wallet state (README §11.4 `useFreighter`).
 *
 * Provided once at the layout level so the navbar, wizard, dashboard, and claim
 * page all share one connection. The network is re-checked on window focus because
 * a user can flip Freighter from TESTNET to PUBLIC without leaving the page
 * (§11.3 `NetworkGuard`).
 */

export type FreighterNetwork = 'TESTNET' | 'PUBLIC' | 'FUTURENET' | string;

interface FreighterState {
  installed: boolean | null;
  publicKey: string | null;
  network: FreighterNetwork | null;
  isConnecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  signXdr: (xdr: string, networkPassphrase: string) => Promise<string>;
  refreshNetwork: () => Promise<void>;
}

const FreighterContext = createContext<FreighterState | null>(null);

export function FreighterProvider({ children }: { children: ReactNode }) {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [network, setNetwork] = useState<FreighterNetwork | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const refreshNetwork = useCallback(async () => {
    const res = await getNetwork();
    if (!res.error) setNetwork(res.network);
  }, []);

  // Detect the extension and restore a previously-allowed session on mount.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const conn = await isConnected();
      if (cancelled) return;

      const present = !conn.error && conn.isConnected;
      setInstalled(present);
      if (!present) return;

      // getAddress resolves without a prompt when access was already granted.
      const addr = await getAddress();
      if (cancelled) return;

      if (!addr.error && addr.address) {
        setPublicKey(addr.address);
        await refreshNetwork();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshNetwork]);

  // Re-check the network whenever the tab regains focus (§11.3).
  useEffect(() => {
    if (!publicKey) return;

    const onFocus = () => void refreshNetwork();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [publicKey, refreshNetwork]);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    try {
      const access = await requestAccess();
      if (access.error) throw new Error(access.error.message ?? 'Freighter denied access.');
      setPublicKey(access.address);
      await refreshNetwork();
    } finally {
      setIsConnecting(false);
    }
  }, [refreshNetwork]);

  // Freighter itself has no revoke API — this just forgets the local session
  // so the UI returns to the "Connect Wallet" state.
  const disconnect = useCallback(() => {
    setPublicKey(null);
    setNetwork(null);
  }, []);

  const signXdr = useCallback(
    async (xdr: string, networkPassphrase: string) => {
      // The network can change between page load and signing — re-verify right
      // before every signature (§6.1 step 1).
      const net = await getNetwork();
      if (!net.error && net.network !== 'TESTNET') {
        setNetwork(net.network);
        throw new Error('Freighter is not on TESTNET. Switch networks and try again.');
      }

      const res = await signTransaction(xdr, {
        networkPassphrase,
        address: publicKey ?? undefined,
      });

      if (res.error) throw new Error(res.error.message ?? 'Signature request was rejected.');
      return res.signedTxXdr;
    },
    [publicKey],
  );

  const value = useMemo(
    () => ({
      installed,
      publicKey,
      network,
      isConnecting,
      connect,
      disconnect,
      signXdr,
      refreshNetwork,
    }),
    [installed, publicKey, network, isConnecting, connect, disconnect, signXdr, refreshNetwork],
  );

  return <FreighterContext.Provider value={value}>{children}</FreighterContext.Provider>;
}

export function useFreighter(): FreighterState {
  const ctx = useContext(FreighterContext);
  if (!ctx) throw new Error('useFreighter must be used inside <FreighterProvider>.');
  return ctx;
}
