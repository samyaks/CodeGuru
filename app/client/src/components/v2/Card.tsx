import type { ReactNode, HTMLAttributes } from 'react';

export type CardVariant = 'default' | 'hover' | 'active' | 'subtle';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  children: ReactNode;
}

const VARIANT_CLASSES: Record<CardVariant, string> = {
  default: 'bg-paper-raised border border-line',
  hover: 'bg-paper-raised border border-line hover:border-line-strong transition-colors',
  active: 'bg-paper-raised border border-line-strong shadow-sm',
  subtle: 'bg-paper-sunk border border-line',
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
