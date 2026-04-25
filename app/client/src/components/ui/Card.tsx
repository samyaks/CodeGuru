import { HTMLAttributes, forwardRef } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Add hover lift + brand border on mouseover */
  interactive?: boolean;
  /** Padding shorthand. `none` → no padding (use for list cards). */
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const paddingClasses: Record<NonNullable<CardProps['padding']>, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { interactive = false, padding = 'md', className = '', children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={[
        'bg-surface border border-line rounded-[14px] shadow-card transition-all duration-150',
        paddingClasses[padding],
        interactive
          ? 'cursor-pointer hover:border-brand hover:-translate-y-px hover:shadow-card-hov'
          : '',
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
});

export default Card;
