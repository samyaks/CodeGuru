import { HTMLAttributes } from 'react';

export type BadgeStatus =
  | 'live'
  | 'deployed'
  | 'deploying'
  | 'building'
  | 'ready'
  | 'scored'
  | 'failed'
  | 'error'
  | 'analyzing'
  | 'pending'
  | 'partial'
  | 'missing'
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'neutral';

const statusClasses: Record<BadgeStatus, string> = {
  // success
  live: 'bg-success-bg text-success border-success-border',
  deployed: 'bg-success-bg text-success border-success-border',
  // info
  deploying: 'bg-info-bg text-info border-info-border',
  building: 'bg-info-bg text-info border-info-border',
  // neutral
  ready: 'bg-surface-2 text-text-muted border-line',
  scored: 'bg-surface-2 text-text-muted border-line',
  neutral: 'bg-surface-2 text-text-muted border-line',
  // danger
  failed: 'bg-danger-bg text-danger border-danger-border',
  error: 'bg-danger-bg text-danger border-danger-border',
  missing: 'bg-danger-bg text-danger border-danger-border',
  critical: 'bg-danger-bg text-danger border-danger-border',
  // warning (in-progress, partial, high-priority)
  analyzing: 'bg-warning-bg text-warning border-warning-border',
  pending: 'bg-warning-bg text-warning border-warning-border',
  partial: 'bg-warning-bg text-warning border-warning-border',
  high: 'bg-warning-bg text-warning border-warning-border',
  // amber/marketing-ish for medium priority
  medium: 'bg-amber-bg text-amber-fg border-amber-border',
  // low priority — neutral slate
  low: 'bg-surface-2 text-text-muted border-line',
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status?: BadgeStatus;
  /** uppercase mono pill (used for priority labels) */
  mono?: boolean;
}

export default function Badge({
  status = 'neutral',
  mono = false,
  className = '',
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] border text-[11px] font-medium',
        mono ? 'font-mono uppercase tracking-[0.05em] text-[10px] font-bold' : '',
        statusClasses[status],
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </span>
  );
}

/** Rounded-pill variant used for framework / stack chips. */
export function Pill({ className = '', children, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={[
        'inline-flex items-center px-3 py-0.5 rounded-full text-[11px] bg-surface-2 border border-line text-text-soft',
        className,
      ].join(' ')}
      {...rest}
    >
      {children}
    </span>
  );
}
