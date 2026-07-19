import type { Config } from 'tailwindcss';

/**
 * Tailwind setup for the frosted-glass design system.
 *
 * The visual language comes from the frosted-glass authentication concept: a fractal
 * glass background, `bg-white/10 backdrop-blur-xl border-white/20` surfaces, and
 * white text at graded opacities. Everything here is stock Tailwind — the design is
 * carried by utility combinations, not bespoke theme tokens.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
