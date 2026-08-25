import { Check, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

export const ANALYSIS_STEPS = [
  { id: 'read', label: 'Reading your repo' },
  { id: 'score', label: 'Scoring production readiness' },
  { id: 'map', label: 'Mapping personas and jobs' },
] as const;

export type AnalysisStepId = (typeof ANALYSIS_STEPS)[number]['id'];

export interface AnalysisStepsProps {
  /** 0–2 = active step; 3 = all complete. */
  current: number;
  /** Readiness score, shown on the scoring step once it lands. */
  scoredScore?: number;
  /** File ticker, rendered under the read step while it's active. */
  readSlot?: ReactNode;
  className?: string;
}

export default function AnalysisSteps({
  current,
  scoredScore,
  readSlot,
  className = '',
}: AnalysisStepsProps) {
  return (
    <ol className={`space-y-4 ${className}`.trim()}>
      {ANALYSIS_STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={step.id}>
            <div className="flex items-center gap-2.5">
              <div
                className={[
                  'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold font-mono shrink-0',
                  done
                    ? 'bg-brand text-white'
                    : active
                      ? 'bg-brand-tint-2 text-brand border-2 border-brand'
                      : 'bg-surface-2 text-text-faint border-2 border-line',
                ].join(' ')}
              >
                {done ? (
                  <Check size={11} strokeWidth={3} />
                ) : active ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={[
                  'text-sm',
                  active
                    ? 'font-semibold text-text'
                    : done
                      ? 'text-text-soft'
                      : 'text-text-faint',
                ].join(' ')}
              >
                {step.label}
              </span>
              {step.id === 'score' && scoredScore != null && (
                <span className="text-xs font-medium text-brand">{`${scoredScore}%`}</span>
              )}
            </div>
            {active && i === 0 && readSlot ? (
              <div className="mt-3 ml-[2.125rem]">{readSlot}</div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
