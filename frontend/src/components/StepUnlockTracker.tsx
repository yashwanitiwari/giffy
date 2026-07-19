'use client';

import { Check, Lock, Unlock } from 'lucide-react';

import { GlassButton } from '@/components/ui/GlassButton';
import type { GiftStep } from '@/types/api';

interface BaseProps {
  steps: GiftStep[];
  stepsCompleted: number;
}

/**
 * Read-only step progress (README §7.3 step 3 / §13.3) — unlocking itself only
 * ever happens from the sender's dashboard (§7.4), never from the claim page.
 */
export function StepUnlockTracker({ steps, stepsCompleted }: BaseProps) {
  return (
    <div className="space-y-2">
      {steps.map((step, i) => {
        const done = i < stepsCompleted;
        return (
          <div
            key={i}
            className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
              done ? 'bg-white/15 border-white/30' : 'bg-white/5 border-white/10'
            }`}
          >
            <div
              className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center mt-0.5 ${
                done ? 'bg-green-400/80' : 'bg-white/10 border border-white/20'
              }`}
            >
              {done ? (
                <Check className="w-3.5 h-3.5 text-white" />
              ) : (
                <Lock className="w-3 h-3 text-white/60" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-white/90">{step.label}</p>
              {step.description && (
                <p className="text-xs text-white/60 mt-0.5">{step.description}</p>
              )}
            </div>
          </div>
        );
      })}
      <p className="text-xs text-white/50 text-center pt-1">
        {stepsCompleted}/{steps.length} steps unlocked
      </p>
    </div>
  );
}

/**
 * Sender-dashboard variant (README §7.4, §13.5): same read-only list, plus an
 * "Unlock next step" action. Each click builds, signs, and submits a single
 * `unlock_step` invocation — the same build-sign-submit pattern as every other
 * state-changing action in this system.
 */
export function StepUnlockTrackerWithAction({
  steps,
  stepsCompleted,
  isUnlocking,
  onUnlockNext,
}: BaseProps & { isUnlocking: boolean; onUnlockNext: () => void }) {
  const allDone = stepsCompleted >= steps.length;

  return (
    <div className="space-y-3">
      <StepUnlockTracker steps={steps} stepsCompleted={stepsCompleted} />
      {!allDone && (
        <GlassButton className="w-full" disabled={isUnlocking} onClick={onUnlockNext}>
          <Unlock className="w-3.5 h-3.5" />
          {isUnlocking ? 'Unlocking…' : 'Unlock next step'}
        </GlassButton>
      )}
    </div>
  );
}
