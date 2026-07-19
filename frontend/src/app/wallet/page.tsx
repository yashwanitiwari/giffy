'use client';

/**
 * Level 1 — `/wallet` demo route.
 *
 * Renders the self-contained Freighter panel so a reviewer can walk the full
 * flow (detect → connect → balance → send → tx hash) on one page.
 */
import { StellarWalletPanel } from '@/components/wallet/stellar-wallet-panel';

export default function WalletPage() {
  return (
    <div className="w-full max-w-5xl mx-auto space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-2xl sm:text-3xl font-semibold text-white">
          Stellar Wallet — Freighter Integration
        </h1>
        <p className="text-white/70 max-w-2xl mx-auto">
          Connect Freighter on the Stellar testnet, check your XLM balance, and send a native
          payment end to end.
        </p>
      </div>

      <StellarWalletPanel />
    </div>
  );
}
