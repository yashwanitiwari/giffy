import type { ButtonHTMLAttributes } from 'react';

/** The concept's glass button: white/20 fill, white/30 border, blur, xl radius. */
export function GlassButton({
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`bg-white/20 hover:bg-white/30 text-white border border-white/30 hover:border-white/40 h-11 px-6 rounded-xl font-medium transition-all duration-200 backdrop-blur-sm disabled:opacity-50 disabled:pointer-events-none inline-flex items-center justify-center gap-2 text-sm ${className}`}
      {...props}
    />
  );
}

/** Borderless variant for secondary actions ("Back", "Cancel"). */
export function GhostButton({
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`text-white/70 hover:text-white text-sm transition-colors disabled:opacity-50 disabled:pointer-events-none inline-flex items-center justify-center gap-1 ${className}`}
      {...props}
    />
  );
}
