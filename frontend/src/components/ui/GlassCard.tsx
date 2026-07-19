import type { HTMLAttributes } from 'react';

/**
 * The frosted-glass surface every panel in the app sits on — the exact treatment
 * from the frosted-glass authentication concept: `bg-white/10 backdrop-blur-xl`
 * with a `white/20` border and a top-left white gradient sheen.
 */
export function GlassCard({
  className = '',
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`relative ${className}`} {...props}>
      <div className="absolute inset-0 bg-white/10 backdrop-blur-xl rounded-3xl border border-white/20 shadow-2xl">
        <div className="absolute inset-0 bg-gradient-to-br from-white/20 via-white/10 to-transparent rounded-3xl" />
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}
