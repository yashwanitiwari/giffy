'use client';

import { ExternalLink, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { GlassButton } from '@/components/ui/GlassButton';
import { GlassLabel, GlassSelect } from '@/components/ui/GlassInput';
import { useOnramp } from '@/hooks/useOnramp';

/**
 * SEP-24 interactive deposit host (README §11.3 `OnrampModal`).
 *
 * Hosts the anchor's own interactive URL in an iframe, with an open-in-new-tab
 * fallback in case the anchor sets frame-busting headers, while `useOnramp` polls
 * the backend for the deposit's status.
 */

const DEPOSIT_ASSETS = ['USDC'];

export function OnrampModal({
  open,
  onClose,
  onCompleted,
}: {
  open: boolean;
  onClose: () => void;
  onCompleted?: () => void;
}) {
  const { phase, interactiveUrl, anchorStatus, error, start, reset } = useOnramp();
  const [assetCode, setAssetCode] = useState('USDC');

  useEffect(() => {
    if (phase === 'completed') onCompleted?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (!open) return null;

  const close = () => {
    reset();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={close} />

      <div className="relative w-full max-w-2xl">
        <div className="absolute inset-0 bg-white/10 backdrop-blur-xl rounded-3xl border border-white/20 shadow-2xl">
          <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-white/10 to-transparent rounded-3xl" />
        </div>

        <div className="relative p-6 space-y-5">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Buy test funds</h2>
              <p className="text-sm text-white/70 mt-1">
                Real SEP-24 deposit against testanchor.stellar.org — testnet assets, not real
                money.
              </p>
            </div>
            <button
              onClick={close}
              className="text-white/70 hover:text-white transition-colors p-1 rounded-full hover:bg-white/10"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {phase === 'idle' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <GlassLabel htmlFor="onramp-asset">Asset to deposit</GlassLabel>
                <GlassSelect
                  id="onramp-asset"
                  value={assetCode}
                  onChange={(e) => setAssetCode(e.target.value)}
                >
                  {DEPOSIT_ASSETS.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </GlassSelect>
              </div>
              <GlassButton className="w-full" onClick={() => void start(assetCode)}>
                Continue — sign in with your wallet
              </GlassButton>
            </div>
          )}

          {(phase === 'authenticating' || phase === 'depositing') && (
            <div className="py-10 text-center space-y-3">
              <div className="mx-auto w-8 h-8 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              <p className="text-sm text-white/70">
                {phase === 'authenticating'
                  ? 'Proving account ownership to the anchor (SEP-10)… approve the signature in Freighter.'
                  : 'Starting the interactive deposit (SEP-24)…'}
              </p>
            </div>
          )}

          {phase === 'polling' && interactiveUrl && (
            <div className="space-y-3">
              <iframe
                src={interactiveUrl}
                title="Anchor deposit"
                className="w-full h-96 rounded-2xl border border-white/20 bg-white"
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-white/70">
                  Waiting for the anchor… {anchorStatus ? `(${anchorStatus})` : ''}
                </p>
                <a
                  href={interactiveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-white/80 hover:text-white inline-flex items-center gap-1 transition-colors"
                >
                  Open in new tab <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          )}

          {phase === 'completed' && (
            <div className="py-8 text-center space-y-4">
              <div className="mx-auto w-12 h-12 bg-white/20 backdrop-blur-sm border border-white/30 rounded-full flex items-center justify-center text-xl">
                ✓
              </div>
              <p className="text-white/90">
                Deposit complete — {assetCode} has been sent to your wallet.
              </p>
              <GlassButton className="w-full" onClick={close}>
                Done
              </GlassButton>
            </div>
          )}

          {phase === 'error' && (
            <div className="py-6 text-center space-y-4">
              <p className="text-sm text-red-300">{error}</p>
              <GlassButton className="w-full" onClick={reset}>
                Try again
              </GlassButton>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
