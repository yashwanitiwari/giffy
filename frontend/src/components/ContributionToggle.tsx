'use client';

import { GlassInput, GlassLabel } from '@/components/ui/GlassInput';

/**
 * "Allow others to contribute?" — a first-class composer field (README §13.2),
 * not a separate "advanced mode" toggle, reflecting that the contract treats
 * group contributions as an ordinary part of every `GiftRecord` (§14.1).
 */
export function ContributionToggle({
  enabled,
  goalAmount,
  onEnabledChange,
  onGoalAmountChange,
}: {
  enabled: boolean;
  goalAmount: string;
  onEnabledChange: (v: boolean) => void;
  onGoalAmountChange: (v: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-xl bg-white/5 border border-white/10 p-4">
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="w-4 h-4 rounded accent-white/80"
        />
        <span className="text-sm font-medium text-white/90">
          Let others contribute to this gift too
        </span>
      </label>
      {enabled && (
        <div className="space-y-1.5 pl-7">
          <GlassLabel htmlFor="goal-amount">Optional goal amount</GlassLabel>
          <GlassInput
            id="goal-amount"
            inputMode="decimal"
            placeholder="e.g. 100"
            value={goalAmount}
            onChange={(e) => onGoalAmountChange(e.target.value.trim())}
          />
          <p className="text-xs text-white/50">
            A separate contribution link will be shared alongside the claim link once this gift
            is live.
          </p>
        </div>
      )}
    </div>
  );
}
