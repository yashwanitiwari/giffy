'use client';

import { Wallet } from 'lucide-react';

import { GlassButton } from '@/components/ui/GlassButton';
import { useFreighter } from '@/hooks/useFreighter';

/**
 * Freighter connect/state button (README §11.3).
 *
 * Three states: extension missing → install link; not connected → connect prompt;
 * connected → disconnect prompt (public key still available via `title`).
 */
export function WalletConnectButton({ className = '' }: { className?: string }) {
  const { installed, publicKey, isConnecting, connect, disconnect } = useFreighter();

  if (installed === false) {
    return (
      <a
        href="https://www.freighter.app/"
        target="_blank"
        rel="noopener noreferrer"
        className={`bg-white/20 hover:bg-white/30 text-white border border-white/30 hover:border-white/40 h-11 px-6 rounded-xl font-medium transition-all duration-200 backdrop-blur-sm inline-flex items-center justify-center gap-2 text-sm ${className}`}
      >
        <Wallet className="w-4 h-4" />
        Install Freighter
      </a>
    );
  }

  if (publicKey) {
    return (
      <GlassButton className={className} onClick={disconnect} title={publicKey}>
        <span className="w-2 h-2 rounded-full bg-green-400" />
        Disconnect Wallet
      </GlassButton>
    );
  }

  return (
    <GlassButton
      className={className}
      onClick={() => void connect().catch(() => undefined)}
      disabled={isConnecting || installed === null}
    >
      <Wallet className="w-4 h-4" />
      {isConnecting ? 'Connecting…' : 'Connect Wallet'}
    </GlassButton>
  );
}
