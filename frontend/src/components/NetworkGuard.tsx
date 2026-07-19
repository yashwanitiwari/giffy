'use client';

import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

import { GlassCard } from '@/components/ui/GlassCard';
import { useFreighter } from '@/hooks/useFreighter';

/**
 * Blocks children unless the connected Freighter wallet is on TESTNET
 * (README §11.3 `NetworkGuard`). Re-checking happens in `useFreighter` on window
 * focus; this component only renders the current answer.
 */
export function NetworkGuard({ children }: { children: ReactNode }) {
  const { publicKey, network } = useFreighter();

  if (publicKey && network && network !== 'TESTNET') {
    return (
      <GlassCard>
        <div className="p-8 flex flex-col items-center text-center space-y-4">
          <div className="w-12 h-12 bg-white/20 backdrop-blur-sm border border-white/30 rounded-full flex items-center justify-center">
            <TriangleAlert className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-xl font-semibold text-white">Wrong network</h2>
          <p className="text-white/70 text-sm max-w-sm">
            Giffy runs on the Stellar <span className="text-white font-medium">Testnet</span>, but
            Freighter is currently set to <span className="text-white font-medium">{network}</span>
            . Open the Freighter extension, switch the network to Test Net, then return to this
            tab.
          </p>
        </div>
      </GlassCard>
    );
  }

  return <>{children}</>;
}
