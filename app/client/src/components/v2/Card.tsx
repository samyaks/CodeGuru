import type { ReactNode, HTMLAttributes } from 'react';

export type CardVariant = 'default' | 'hover' | 'active' | 'subtle';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<CardVariant, string> = {
  default: 'bg-white border border-stone-200',
  hover: 'bg-white border border-stone-200 hover:border-stone-300 transition-colors',
  active: 'bg-white border border-stone-300 shadow-sm',
  subtle: 'bg-stone-50 border border-stone-200',
};

export function Card({ variant = 'default', className = '', children, ...rest }: CardProps) {
  return (
    <div
      className={`${VARIANT_CLASSES[variant]} rounded-lg p-5 ${className}`.trim()}
      {...rest}
    >
      {children}
    </div>
  );
}

export default Card;
