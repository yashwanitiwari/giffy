'use client';

import { GlassLabel, GlassSelect } from '@/components/ui/GlassInput';
import type { ConditionType } from '@/types/api';

/**
 * none / trivia / step-gate — a first-class composer field (README §13.2),
 * ordinary parts of every `GiftRecord` rather than an "advanced mode" toggle.
 */
export function ConditionPicker({
  value,
  onChange,
}: {
  value: ConditionType;
  onChange: (v: ConditionType) => void;
}) {
  return (
    <div className="space-y-1.5">
      <GlassLabel htmlFor="condition-type">Add a claim condition (optional)</GlassLabel>
      <GlassSelect
        id="condition-type"
        value={value}
        onChange={(e) => onChange(e.target.value as ConditionType)}
      >
        <option value="none">No condition</option>
        <option value="trivia">Trivia question</option>
        <option value="stepGate">Step-by-step unlock</option>
      </GlassSelect>
    </div>
  );
}
