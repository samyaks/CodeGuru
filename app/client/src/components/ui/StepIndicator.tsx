import { Fragment } from 'react';
import { Check } from 'lucide-react';

interface StepIndicatorProps {
  steps: string[];
  /** zero-based current step index */
  current: number;
  className?: string;
}

/**
 * Horizontal step row with numbered circles + connector lines.
 * Matches ProductMapOnboarding kit: completed = brand fill,
 * active = sky-tint fill + ring, pending = neutral.
 */
export default function StepIndicator({ steps, current, className = '' }: StepIndicatorProps) {
  return (
    <div className={['flex items-center gap-1.5', className].join(' ')}>
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <Fragment key={label}>
            <div className="flex items-center gap-1.5">
              <div
                className={[
                  'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold font-mono shrink-0',
                  done
                    ? 'bg-brand text-white border-0'
                    : active
                    ? 'bg-brand-tint-2 text-brand border-2 border-brand'
                    : 'bg-surface-2 text-text-faint border-2 border-line',
                ].join(' ')}
              >
                {done ? <Check size={11} strokeWidth={3} /> : i + 1}
              </div>
              {active && (
                <span className="text-xs font-semibold text-brand">{label}</span>
              )}
            </div>
            {i < steps.length - 1 && (
              <div
                className={[
                  'flex-1 h-px max-w-[40px]',
                  done ? 'bg-brand-tint-border' : 'bg-line',
                ].join(' ')}
              />
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
