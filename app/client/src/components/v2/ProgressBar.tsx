export type ProgressTone = 'success' | 'warning' | 'danger' | 'neutral';

export interface ProgressBarProps {
  /** 0-100. Values outside the range are clamped. */
  value: number;
  tone?: ProgressTone;
  /** Optional `aria-label` text. */
  label?: string;
  className?: string;
}

const TONE_CLASSES: Record<ProgressTone, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
  neutral: 'bg-stone-500',
};

function toneFor(value: number): ProgressTone {
  if (value >= 90) return 'success';
  if (value >= 75) return 'warning';
  return 'danger';
}

export function ProgressBar({ value, tone, label, className = '' }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const resolved = tone ?? toneFor(clamped);
  return (
    <div
      className={`h-1.5 bg-stone-100 rounded-full overflow-hidden ${className}`.trim()}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={`h-full rounded-full ${TONE_CLASSES[resolved]}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export default ProgressBar;
