'use client';

import { Check, ExternalLink, Lock, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import { NetworkGuard } from '@/components/NetworkGuard';
import { GlassButton } from '@/components/ui/GlassButton';
import { GlassCard } from '@/components/ui/GlassCard';
import { WalletConnectButton } from '@/components/WalletConnectButton';
import { useFreighter } from '@/hooks/useFreighter';
import { useSealedClaim, type SealedClaimPhase } from '@/hooks/useSealedClaim';
import { decodeSealedClaimSecret } from '@/lib/shieldedNote';
import { explorerTxUrl } from '@/lib/formatters';

/**
 * Sealed-gift claim page (confidential-amount flow). The note secret arrives in
 * the URL fragment (`/claim/sealed#s=...`) — never sent to any server — and the
 * withdrawal is proved in the browser before submitting. There is deliberately no
 * amount shown: it is sealed until the funds land in the recipient's wallet.
 */

const PHASE_LABEL: Record<SealedClaimPhase, string> = {
  idle: 'Claim into my wallet',
  proving: 'Generating your private proof…',
  signing: 'Waiting for signature…',
  submitting: 'Submitting…',
  done: 'Claimed',
  error: 'Try again',
};

export default function SealedClaimPage() {
  const { publicKey } = useFreighter();
  const [secret, setSecret] = useState<string | null>(null);

  // The secret is in the fragment, only readable client-side.
  useEffect(() => {
    setSecret(decodeSealedClaimSecret(window.location.hash));
  }, []);

  const { phase, txHash, error, claim } = useSealedClaim(secret);
  const busy = phase === 'proving' || phase === 'signing' || phase === 'submitting';

  if (!secret) {
    return (
      <Centered>
        <GlassCard className="w-full max-w-md">
          <div className="p-8 text-center space-y-3">
            <Lock className="w-6 h-6 text-white mx-auto" />
            <h1 className="text-2xl font-semibold text-white">This sealed link isn&apos;t valid</h1>
            <p className="text-white/70 text-sm">
              A sealed gift link carries its secret after the <code>#</code> — make sure you copied
              the whole thing.
            </p>
          </div>
        </GlassCard>
      </Centered>
    );
  }

  if (phase === 'done' && txHash) {
    return (
      <Centered>
        <GlassCard className="w-full max-w-md">
          <div className="p-8 flex flex-col items-center text-center space-y-5">
            <div className="w-16 h-16 bg-white/20 border border-white/30 rounded-full flex items-center justify-center">
              <Check className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-semibold text-white">Your sealed gift is yours</h1>
            <p className="text-white/70 text-sm">
              The funds were withdrawn privately from the pool into your wallet — the amount was
              never revealed on-chain.
            </p>
            <a
              href={explorerTxUrl(txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-white/80 hover:text-white text-sm inline-flex items-center gap-1"
            >
              View transaction <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </GlassCard>
      </Centered>
    );
  }

  return (
    <Centered>
      <div className="w-full max-w-md">
        <NetworkGuard>
          <GlassCard>
            <div className="p-8 space-y-6">
              <div className="text-center space-y-3">
                <div className="mx-auto w-14 h-14 bg-white/20 border border-white/30 rounded-full flex items-center justify-center">
                  <Lock className="w-7 h-7 text-white" />
                </div>
                <h1 className="text-2xl font-semibold text-white">You&apos;ve got a sealed gift</h1>
                <p className="text-white/70 text-sm inline-flex items-start gap-1.5 text-left">
                  <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    The amount is hidden in Giffy&apos;s confidential pool. Your browser will prove
                    your claim privately — nothing about the amount touches the network.
                  </span>
                </p>
              </div>

              {publicKey ? (
                <div className="space-y-3">
                  <GlassButton
                    className="w-full"
                    disabled={busy}
                    onClick={() => void claim()}
                  >
                    {busy && (
                      <span className="w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    )}
                    {PHASE_LABEL[phase]}
                  </GlassButton>
                  {phase === 'proving' && (
                    <p className="text-center text-xs text-white/50">
                      Proving takes a few seconds and runs entirely on your device.
                    </p>
                  )}
                  {error && <p className="text-center text-xs text-red-300">{error}</p>}
                </div>
              ) : (
                <div className="flex flex-col items-center space-y-3">
                  <WalletConnectButton className="w-full" />
                  <p className="text-center text-xs text-white/50">
                    Connect the wallet you want the funds sent to.
                  </p>
                </div>
              )}
            </div>
          </GlassCard>
        </NetworkGuard>
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex-1 flex items-center justify-center">{children}</div>;
}
