import { Lock } from 'lucide-react';
import type { AnalysisEstimate, AnalysisModelOption } from '../../services/api';
import { classifyRepoAccessError } from '../../lib/repo-access-error';

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${Math.round(n / 100) / 10}k`.replace('.0k', 'k');
  return n.toLocaleString();
}

export function formatUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export interface AnalysisModelPickerProps {
  models: AnalysisModelOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  estimate: AnalysisEstimate | null;
  estimateLoading: boolean;
  estimateError: string | null;
  disabled?: boolean;
}

export function AnalysisModelPicker({
  models,
  selectedId,
  onSelect,
  estimate,
  estimateLoading,
  estimateError,
  disabled = false,
}: AnalysisModelPickerProps) {
  const corpus = estimate?.corpus;
  const selected = models.find((m) => m.id === selectedId) || models[0];
  const selectedEstimate = selected?.estimate;

  return (
    <div className="space-y-3">
      <p className="text-xs uppercase tracking-wider font-semibold text-stone-700">
        Model
      </p>
      <div className="space-y-2" role="radiogroup" aria-label="Analysis model">
        {models.map((m) => {
          const active = m.id === selectedId;
          const est = m.estimate;
          const locked = !m.available;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled || locked}
              onClick={() => onSelect(m.id)}
              className={[
                'w-full text-left rounded-md border px-3 py-2.5 transition-colors',
                active
                  ? 'border-stone-900 bg-stone-50 shadow-sm'
                  : 'border-stone-200 bg-white',
                !active && !disabled && !locked ? 'hover:border-stone-400' : '',
                disabled || locked ? 'opacity-60 cursor-not-allowed' : '',
              ].join(' ')}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-stone-900">
                  {m.label}
                  {m.recommended ? (
                    <span className="ml-2 text-[10px] uppercase tracking-wider font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                      Recommended
                    </span>
                  ) : null}
                </span>
                {locked ? (
                  <span className="inline-flex items-center gap-1 text-xs text-stone-500 shrink-0">
                    <Lock className="w-3 h-3" aria-hidden />
                    {m.unavailableReason || 'Unavailable'}
                  </span>
                ) : (
                  <span className="text-xs text-stone-500 shrink-0">
                    {est
                      ? `${formatUsd(est.costUsdLow)}–${formatUsd(est.costUsdHigh)}`
                      : estimateLoading
                        ? '…'
                        : m.tagline}
                  </span>
                )}
              </div>
              <p className="text-xs text-stone-600 mt-1 leading-relaxed">{m.description}</p>
            </button>
          );
        })}
      </div>

      <div className="bg-stone-50 border border-stone-200 rounded-md p-3 space-y-1.5">
        {estimateLoading ? (
          <p className="text-xs text-stone-500">Estimating token usage from the repo…</p>
        ) : estimateError ? (
          <p className="text-xs text-amber-800">
            {classifyRepoAccessError(estimateError)
              ? estimateError
              : <>Couldn&rsquo;t estimate usage ({estimateError}). You can still run the analysis.</>}
          </p>
        ) : corpus ? (
          <>
            <p className="text-xs text-stone-700 leading-relaxed">
              We&rsquo;ll scan about{' '}
              <span className="font-semibold tabular-nums">{corpus.fileCount.toLocaleString()} files</span>
              {' '}({formatTokenCount(corpus.treeTokens)} tokens of source
              {corpus.truncated ? ', truncated tree' : ''}).
              {selectedEstimate ? (
                <>
                  {' '}This run is estimated at{' '}
                  <span className="font-semibold tabular-nums">
                    {formatTokenCount(selectedEstimate.totalTokens)} tokens
                  </span>
                  {' '}(~{formatUsd(selectedEstimate.costUsdLow)}–{formatUsd(selectedEstimate.costUsdHigh)})
                  with {selected?.label || 'the selected model'}.
                </>
              ) : null}
            </p>
            <p className="text-[11px] text-stone-500">
              Estimates are approximate. Actual usage depends on which files we ingest.
            </p>
          </>
        ) : (
          <p className="text-xs text-stone-500">Pick a model, then confirm to run the analysis.</p>
        )}
      </div>
    </div>
  );
}

export default AnalysisModelPicker;
