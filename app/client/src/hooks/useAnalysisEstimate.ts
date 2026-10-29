import { useCallback, useEffect, useRef, useState } from 'react';
import {
  estimateAnalysis,
  fetchAnalysisModels,
  type AnalysisEstimate,
  type AnalysisModelOption,
} from '../services/api';

// Shown until the server's catalog arrives (or if both requests fail).
// The server's `/takeoff/models` + `/takeoff/estimate` are the source of truth.
const FALLBACK_ANALYSIS_MODELS: AnalysisModelOption[] = [
  {
    id: 'haiku',
    label: 'Haiku',
    tagline: 'Fastest and cheapest',
    description: 'Good for small repos and quick scans. A bit less thorough on subtle gaps.',
    model: 'claude-haiku-4-5',
    speed: 'fast',
    recommended: false,
    available: true,
    unavailableReason: null,
  },
  {
    id: 'sonnet',
    label: 'Sonnet',
    tagline: 'Recommended',
    description: 'Best balance of quality and cost for most projects.',
    model: 'claude-sonnet-5',
    speed: 'balanced',
    recommended: true,
    available: true,
    unavailableReason: null,
  },
  {
    id: 'opus',
    label: 'Opus',
    tagline: 'Highest quality',
    description: 'Most thorough analysis. Costs more and takes longer.',
    model: 'claude-opus-5-5',
    speed: 'slow',
    recommended: false,
    // The server decides; until it answers, don't offer Opus to someone
    // who may be signed out.
    available: false,
    unavailableReason: 'Sign in to use Opus.',
  },
];

export type AnalysisEstimateRequest =
  | { repoUrl: string }
  | { projectId: string }
  | { fileCount: number; totalBytes: number };

// Loads the model catalog + token/cost estimate for a pending analysis and
// tracks which model is selected. The server's default (env default, or the
// model a project last ran with) is applied only until the user picks one,
// so a slow estimate can't silently switch the model out from under them.
export function useAnalysisEstimate(open: boolean, request: AnalysisEstimateRequest | null) {
  const [models, setModels] = useState<AnalysisModelOption[]>(FALLBACK_ANALYSIS_MODELS);
  const [selectedId, setSelectedIdState] = useState('sonnet');
  const [estimate, setEstimate] = useState<AnalysisEstimate | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const userPicked = useRef(false);

  // Callers pass a fresh object each render; key on its contents instead.
  const requestKey = request ? JSON.stringify(request) : null;

  useEffect(() => {
    if (!open || !requestKey) return;
    userPicked.current = false;
    setEstimate(null);
    setEstimateError(null);
    setEstimateLoading(true);
    let cancelled = false;

    const adopt = (list: AnalysisModelOption[], defaultId: string | undefined) => {
      if (list.length) setModels(list);
      if (!userPicked.current && defaultId) setSelectedIdState(defaultId);
    };

    estimateAnalysis(JSON.parse(requestKey) as AnalysisEstimateRequest)
      .then((result) => {
        if (cancelled) return;
        setEstimate(result);
        adopt(result.models ?? [], result.defaultModelId);
      })
      .catch((err) => {
        if (cancelled) return;
        setEstimateError(err instanceof Error ? err.message : 'Failed to estimate usage');
        // No estimate, but the live catalog still beats the fallback list.
        return fetchAnalysisModels()
          .then((catalog) => {
            if (!cancelled) adopt(catalog.models, catalog.defaultModelId);
          })
          .catch(() => { /* keep fallback models */ });
      })
      .finally(() => {
        if (!cancelled) setEstimateLoading(false);
      });

    return () => { cancelled = true; };
  }, [open, requestKey]);

  const setSelectedId = useCallback((id: string) => {
    userPicked.current = true;
    setSelectedIdState(id);
  }, []);

  return { models, selectedId, setSelectedId, estimate, estimateLoading, estimateError };
}
