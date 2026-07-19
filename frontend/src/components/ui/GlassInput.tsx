import type {
  InputHTMLAttributes,
  LabelHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

/** Form controls in the concept's glass style: white/10 fill, white/20 border. */

const fieldClasses =
  'w-full h-11 rounded-xl bg-white/10 border border-white/20 px-3 text-sm text-white placeholder:text-white/50 outline-none transition-colors focus:border-white/40 focus:ring-2 focus:ring-white/20 disabled:opacity-50';

export function GlassInput({
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${fieldClasses} ${className}`} {...props} />;
}

export function GlassTextarea({
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`${fieldClasses} h-auto min-h-[88px] py-2.5 resize-none ${className}`}
      {...props}
    />
  );
}

export function GlassSelect({
  className = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${fieldClasses} appearance-none pr-8 [&>option]:bg-neutral-900 ${className}`} {...props}>
      {children}
    </select>
  );
}

export function GlassLabel({
  className = '',
  ...props
}: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={`block text-sm font-medium text-white/90 ${className}`} {...props} />;
}
