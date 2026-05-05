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
  broken: 'bg-red-50 text-red-600',
  missing: 'bg-amber-50 text-amber-700',
  infra: 'bg-stone-100 text-stone-700',
  verified: 'bg-emerald-50 text-emerald-600',
  partial: 'bg-amber-50 text-amber-700',
  pending: 'bg-stone-100 text-stone-600',
  'in-progress': 'bg-amber-100 text-amber-800',
  rejected: 'bg-stone-100 text-stone-600',
  neutral: 'bg-stone-100 text-stone-600',
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
