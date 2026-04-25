import { ButtonHTMLAttributes, forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-brand text-white shadow-cta hover:bg-brand-hov hover:-translate-y-px hover:shadow-cta-hov disabled:bg-surface-2 disabled:text-text-faint disabled:shadow-none disabled:translate-y-0 disabled:cursor-not-allowed',
  secondary:
    'bg-surface text-text border border-line shadow-card hover:bg-page disabled:opacity-60 disabled:cursor-not-allowed',
  ghost:
    'bg-transparent text-text-muted hover:text-text disabled:opacity-60 disabled:cursor-not-allowed',
  danger:
    'bg-danger-bg text-danger border border-danger-border hover:bg-danger hover:text-white disabled:opacity-60 disabled:cursor-not-allowed',
};

const sizeClasses: Record<Size, string> = {
  sm: 'h-8 px-3 rounded-lg text-xs gap-1.5',
  md: 'h-10 px-5 rounded-[10px] text-sm gap-2',
  lg: 'h-12 px-7 rounded-xl text-[15px] gap-2.5',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className = '', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={[
        'inline-flex items-center justify-center font-semibold transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30',
        variantClasses[variant],
        sizeClasses[size],
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
});

export default Button;
