import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Lock, Sparkles, X } from 'lucide-react';
import { ApiError } from '../../lib/api-error';
import {
  classifyRepoAccessError,
  repoAccessErrorCopy,
} from '../../lib/repo-access-error';
import { useAnalysisEstimate, type AnalysisEstimateRequest } from '../../hooks/useAnalysisEstimate';
import { AnalysisModelPicker } from './AnalysisModelPicker';

export type AnalysisConfirmSource =
  | { kind: 'repo'; repoUrl: string; label?: string }
  | { kind: 'upload'; fileCount: number; totalBytes: number; label?: string }
  | { kind: 'reanalyze'; projectId: string; label?: string };

export interface AnalysisConfirmModalProps {
  open: boolean;
  onClose: () => void;
  source: AnalysisConfirmSource | null;
  onConfirm: (modelId: string) => Promise<void>;
  /** Override the primary button label. Default depends on source.kind. */
  confirmLabel?: string;
}

export function AnalysisConfirmModal({
  open,
  onClose,
  source,
  onConfirm,
  confirmLabel,
}: AnalysisConfirmModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useMemo<AnalysisEstimateRequest | null>(() => {
    if (!source) return null;
    if (source.kind === 'repo') return { repoUrl: source.repoUrl };
    if (source.kind === 'upload') return { fileCount: source.fileCount, totalBytes: source.totalBytes };
    return { projectId: source.projectId };
  }, [source]);
  const {
    models, selectedId, setSelectedId, estimate, estimateLoading, estimateError,
  } = useAnalysisEstimate(open, request);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSubmitting(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, submitting]);

  const handleConfirm = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(selectedId);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError(err instanceof Error ? err.message : 'Failed to start analysis');
      setSubmitting(false);
    }
  }, [onConfirm, selectedId]);

  if (!open || !source) return null;

  const title =
    source.kind === 'reanalyze' ? 'Re-analyze this project?' : 'Confirm analysis';
  const subtitle = source.label || (source.kind === 'repo' ? source.repoUrl : 'Uploaded folder');
  const cta =
    confirmLabel
    || (source.kind === 'reanalyze' ? 'Re-analyze now' : 'Run analysis');

  const accessKind =
    source.kind === 'repo' ? classifyRepoAccessError(estimateError) : null;
  const accessBlocked =
    accessKind === 'private_or_missing'
    || accessKind === 'invalid_url'
    || accessKind === 'rate_limit';
  const accessCopy = accessKind ? repoAccessErrorCopy(accessKind) : null;
  // Don't show the soft "you can still run" estimate error when access is blocked.
  const pickerEstimateError = accessBlocked ? null : estimateError;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="analysis-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8"
    >
      <div
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
        onClick={submitting ? undefined : onClose}
        aria-hidden
      />
      <div className="relative bg-white border border-stone-200 rounded-lg shadow-xl w-full max-w-md max-h-full overflow-y-auto">
        <div className="flex items-start justify-between p-5 border-b border-stone-100">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-9 h-9 rounded bg-stone-900 text-white flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4" strokeWidth={2.5} aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 id="analysis-confirm-title" className="text-base font-bold text-stone-900 tracking-tight">
                {title}
              </h2>
              <p className="text-xs text-stone-500 mt-0.5 truncate" title={subtitle}>
                {subtitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="text-stone-400 hover:text-stone-700 transition-colors p-1 -m-1 disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-sm">
          {accessBlocked && accessCopy ? (
            <div className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-950">
              <Lock className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-700" aria-hidden />
              <div className="min-w-0 space-y-1.5">
                <p className="font-semibold text-sm leading-snug">{accessCopy.title}</p>
                <p className="text-xs leading-relaxed text-amber-900/90">{accessCopy.body}</p>
                {estimateError ? (
                  <p className="text-[11px] text-amber-800/80 font-mono break-words">
                    {estimateError}
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-stone-700 leading-relaxed">
              Choose a model and review the estimated token usage before we start.
              Nothing runs until you confirm.
            </p>
          )}

          {!accessBlocked ? (
            <AnalysisModelPicker
              models={models}
              selectedId={selectedId}
              onSelect={setSelectedId}
              estimate={estimate}
              estimateLoading={estimateLoading}
              estimateError={pickerEstimateError}
              disabled={submitting}
            />
          ) : null}

          {error ? (
            <p className="flex items-start gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2.5 py-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" aria-hidden />
              <span>{error}</span>
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-stone-100 bg-stone-50/50">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-sm font-medium text-stone-700 hover:text-stone-900 rounded transition-colors disabled:opacity-50"
          >
            {accessBlocked ? 'Close' : 'Cancel'}
          </button>
          {!accessBlocked ? (
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={submitting || models.length === 0 || estimateLoading}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-stone-900 hover:bg-stone-800 disabled:bg-stone-400 disabled:cursor-not-allowed rounded transition-colors"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                  Starting…
                </>
              ) : (
                cta
              )}
            </button>
          ) : null}
        </div>      </div>
    </div>
  );
}

export default AnalysisConfirmModal;
