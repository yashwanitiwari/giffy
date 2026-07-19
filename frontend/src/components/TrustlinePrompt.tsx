'use client';

import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import { GlassButton } from '@/components/ui/GlassButton';
import { GlassCard } from '@/components/ui/GlassCard';
import { useFreighter } from '@/hooks/useFreighter';
import { buildChangeTrustXdr, hasTrustline, submitChangeTrustXdr } from '@/lib/trustline';

/**
 * The one-time "allow your wallet to hold X" approval (README §6.3).
 *
 * Renders nothing once the connected account already trusts `assetCode` (or the
 * asset is native XLM, which never needs a trustline). Shown as its own explicit
 * step before review/claim, per §6.3 and §13.2 step 4 / §13.3.
 */
export function TrustlinePrompt({
  assetCode,
  onSatisfied,
}: {
  assetCode: string;
  onSatisfied: () => void;
}) {
  const { publicKey, signXdr } = useFreighter();
  const [checking, setChecking] = useState(true);
  const [needed, setNeeded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!publicKey || assetCode === 'XLM') {
      setChecking(false);
      setNeeded(false);
      if (!cancelled) onSatisfied();
      return () => {
        cancelled = true;
      };
    }

    setChecking(true);
    hasTrustline(publicKey, assetCode)
      .then((has) => {
        if (cancelled) return;
        setNeeded(!has);
        if (has) onSatisfied();
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey, assetCode]);

  const approve = async () => {
    if (!publicKey) return;
    setSubmitting(true);
    setError(null);
    try {
      const { xdr, networkPassphrase } = await buildChangeTrustXdr(publicKey, assetCode);
      const signedXdr = await signXdr(xdr, networkPassphrase);
      await submitChangeTrustXdr(signedXdr);
      setNeeded(false);
      onSatisfied();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approving the trustline failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (checking || !needed) return null;

  return (
    <GlassCard>
      <div className="p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 shrink-0 bg-white/20 backdrop-blur-sm border border-white/30 rounded-xl flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-white font-semibold">One more approval needed</h3>
            <p className="text-sm text-white/70 mt-1">
              Allow your wallet to hold {assetCode}. This is a one-time setup step per account —
              it won&apos;t be asked again for {assetCode} on this wallet.
            </p>
          </div>
        </div>
        {error && <p className="text-xs text-red-300">{error}</p>}
        <GlassButton className="w-full" disabled={submitting} onClick={() => void approve()}>
          {submitting ? 'Waiting for signature…' : `Allow ${assetCode}`}
        </GlassButton>
      </div>
    </GlassCard>
  );
}
