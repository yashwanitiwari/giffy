'use client';

import { Trash2 } from 'lucide-react';

import { GhostButton } from '@/components/ui/GlassButton';
import { GlassInput, GlassLabel } from '@/components/ui/GlassInput';
import type { GiftStep } from '@/types/api';

/**
 * An editable list of {label, description} steps, plus who is authorized to
 * unlock them (README §13.2), shown inline when `ConditionPicker` selects
 * `stepGate`. `stepUnlockerPublicKey` defaults to the sender's own address
 * (§17.6) but can be reassigned to another trusted party.
 */
export function StepGateForm({
  steps,
  onChange,
  stepUnlockerPublicKey,
  onStepUnlockerChange,
  defaultUnlocker,
}: {
  steps: GiftStep[];
  onChange: (s: GiftStep[]) => void;
  stepUnlockerPublicKey: string;
  onStepUnlockerChange: (v: string) => void;
  defaultUnlocker: string | null;
}) {
  const addStep = () => onChange([...steps, { label: '', description: '' }]);
  const updateStep = (i: number, field: keyof GiftStep, value: string) => {
    const next = [...steps];
    next[i] = { ...next[i], [field]: value };
    onChange(next);
  };
  const removeStep = (i: number) => onChange(steps.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-3 rounded-xl bg-white/5 border border-white/10 p-4">
      {steps.map((step, i) => (
        <div key={i} className="rounded-lg border border-white/15 bg-white/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-white/50">Step {i + 1}</span>
            <button
              type="button"
              onClick={() => removeStep(i)}
              className="text-white/50 hover:text-red-300 transition-colors"
              aria-label={`Remove step ${i + 1}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <GlassInput
            placeholder="Step label"
            value={step.label}
            onChange={(e) => updateStep(i, 'label', e.target.value)}
          />
          <GlassInput
            placeholder="Description"
            value={step.description}
            onChange={(e) => updateStep(i, 'description', e.target.value)}
          />
        </div>
      ))}

      <GhostButton type="button" onClick={addStep}>
        + Add step
      </GhostButton>

      <div className="space-y-1.5 pt-1">
        <GlassLabel htmlFor="step-unlocker">Who can unlock steps?</GlassLabel>
        <GlassInput
          id="step-unlocker"
          className="font-mono"
          placeholder={defaultUnlocker ?? 'G...'}
          value={stepUnlockerPublicKey}
          onChange={(e) => onStepUnlockerChange(e.target.value.trim())}
        />
        <p className="text-xs text-white/50">
          Defaults to your own address — you&apos;ll unlock steps for the receiver from your
          dashboard.
        </p>
      </div>
    </div>
  );
}
