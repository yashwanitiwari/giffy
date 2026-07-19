'use client';

import { Lock, ShieldCheck } from 'lucide-react';

/**
 * "Seal the amount?" — the sender's choice between an ordinary gift (amount
 * visible on-chain) and a *sealed* gift, where the amount is locked into the
 * confidential pool and never appears on the ledger. A first-class composer
 * field, mirroring `ContributionToggle`.
 *
 * Sealed gifts route through the shielded pool: the amount is committed as a ZK
 * note, and the recipient claims by generating a proof in their browser. See
 * `lib/zkProver.ts` and `contracts/shielded-pool`.
 */
export function SealAmountToggle({
  enabled,
  onEnabledChange,
  supported,
}: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  /** Whether the selected asset/amount is eligible for the pool (fixed denom). */
  supported: boolean;
}) {
  return (
    <div className="space-y-3 rounded-xl bg-white/5 border border-white/10 p-4">
      <label className={`flex items-center gap-3 ${supported ? 'cursor-pointer' : 'opacity-50'}`}>
        <input
          type="checkbox"
          checked={enabled && supported}
          disabled={!supported}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="w-4 h-4 rounded accent-white/80"
        />
        <span className="text-sm font-medium text-white/90 inline-flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5" />
          Seal the amount (hide it on-chain)
        </span>
      </label>

      {supported ? (
        enabled && (
          <div className="space-y-2 pl-7">
            <p className="text-xs text-white/60 inline-flex items-start gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                The amount is locked into Giffy&apos;s confidential pool as a zero-knowledge note —
                no one, not even a chain explorer, can see how much you sent. The recipient proves
                their claim privately in their browser.
              </span>
            </p>
            <p className="text-xs text-white/40 pl-5">
              Sealed gifts use a fixed denomination and generate a private claim link.
            </p>
          </div>
        )
      ) : (
        <p className="text-xs text-white/40 pl-7">
          Sealing is available for eligible pool denominations — pick a supported asset and amount
          to enable it.
        </p>
      )}
    </div>
  );
}
