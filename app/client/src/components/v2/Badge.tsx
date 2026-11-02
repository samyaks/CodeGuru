import type { ComponentType, ReactNode } from 'react';
import type { LucideProps } from 'lucide-react';

export type BadgeVariant =
  | 'broken'
  | 'missing'
  | 'infra'
  | 'verified'
  | 'partial'
  | 'pending'
  | 'in-progress'
  | 'rejected'
  | 'neutral';

export interface BadgeProps {
  variant: BadgeVariant;
  icon?: ComponentType<LucideProps>;
  children: ReactNode;
  className?: string;
}

const VARIANT_STYLES: Record<BadgeVariant, string> = {
  broken: 'bg-grounded-soft text-grounded',
  missing: 'bg-holding-soft text-holding',
  infra: 'bg-paper-sunk text-ink',
  verified: 'bg-cleared-soft text-cleared',
  partial: 'bg-holding-soft text-holding',
  pending: 'bg-paper-sunk text-ink-muted',
  'in-progress': 'bg-holding-soft text-holding',
  rejected: 'bg-paper-sunk text-ink-muted',
  neutral: 'bg-paper-sunk text-ink-muted',
};

export function Badge({ variant, icon: Icon, children, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-semibold ${VARIANT_STYLES[variant]} ${className}`.trim()}
    >
      {Icon ? <Icon className="w-3 h-3" /> : null}
      {children}
    </span>
  );
}

export default Badge;
