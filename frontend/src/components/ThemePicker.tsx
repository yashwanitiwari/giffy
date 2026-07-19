'use client';

import { Cake, Heart, PartyPopper, Sparkles } from 'lucide-react';

import type { GiftTheme } from '@/types/api';

/**
 * Visual selector for gift themes (README §11.3 `ThemePicker`). The selected theme
 * drives the claim page's accent treatment.
 */

export const THEME_META: Record<
  GiftTheme,
  { label: string; Icon: typeof Cake; accent: string }
> = {
  birthday: { label: 'Birthday', Icon: Cake, accent: 'from-pink-400/30' },
  congrats: { label: 'Congrats', Icon: PartyPopper, accent: 'from-amber-300/30' },
  thankyou: { label: 'Thank you', Icon: Heart, accent: 'from-rose-400/30' },
  custom: { label: 'Custom', Icon: Sparkles, accent: 'from-sky-300/30' },
};

export function ThemePicker({
  value,
  onChange,
}: {
  value: GiftTheme;
  onChange: (theme: GiftTheme) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Gift theme">
      {(Object.keys(THEME_META) as GiftTheme[]).map((theme) => {
        const { label, Icon } = THEME_META[theme];
        const selected = value === theme;
        return (
          <button
            key={theme}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(theme)}
            className={`flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs transition-all duration-200 backdrop-blur-sm ${
              selected
                ? 'bg-white/25 border-white/40 text-white'
                : 'bg-white/10 border-white/20 text-white/70 hover:bg-white/15 hover:text-white'
            }`}
          >
            <Icon className="w-5 h-5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
