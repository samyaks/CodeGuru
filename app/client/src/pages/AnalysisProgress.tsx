import { useEffect, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Header from '../components/Header';
import FileTicker from '../components/FileTicker';
import AnalysisSteps from '../components/AnalysisSteps';
import { useSSE } from '../hooks/useSSE';

interface ProgressMessage {
  type: string;
  phase?: string;
  message?: string;
  score?: number;
  error?: string;
  reason?: string;
  paths?: unknown;
  readCount?: unknown;
  totalToRead?: unknown;
  [key: string]: unknown;
}

const PHASE_LABELS: Record<string, string> = {
  meta: 'Fetching repo metadata…',
  tree: 'Reading the file tree…',
  'tree-done': 'Found files',
  estimate: 'Estimating size…',
  reading: 'Reading key files…',
  graph: 'Computing import graph…',
  analyzing: 'Detecting tech stack…',
  describing: 'Writing a plain-English summary…',
  complete: 'Analysis complete',
  scoring: 'Scoring production readiness…',
  planning: 'Generating your plan…',
  'ai-suggestions': 'Looking for deeper suggestions…',
  'context-files': 'Generating context files…',
  'product-map': 'Mapping personas and jobs to your code…',
};

const READ_PHASES = new Set(['meta', 'tree', 'tree-done', 'estimate', 'reading']);

// Upper bound on how long we'll wait for `product-map-ready` after the
// pipeline's main `complete` event lands. If extract-intent stalls (or
// the SSE connection drops between the two events) we'd otherwise pin
// the user on the loading screen indefinitely. 60s is generous — the
// Claude call typically finishes in 30-40s — and worst case the user
// arrives at the project workspace with an empty personas sidebar,
// which is the legacy behavior we're improving from.
const PRODUCT_MAP_WAIT_MS = 60_000;

// DEV-only visual QA: /takeoff/preview?preview=read|score|map|done
const PREVIEW_PATHS = [
  'package.json',
  'app/server/routes/takeoff.js',
  'app/server/services/analyzer.js',
  'app/client/src/App.tsx',
  'app/client/src/pages/AnalysisProgress.tsx',
  'packages/auth/index.js',
  'CONTEXT.md',
  'vite.config.ts',
];

function collectReadFiles(messages: ProgressMessage[]) {
  const paths: string[] = [];
  let readCount: number | undefined;
  let totalToRead: number | undefined;
  for (const m of messages) {
    if (m.type !== 'progress' || m.phase !== 'reading') continue;
    if (Array.isArray(m.paths)) {
      for (const p of m.paths) {
        if (typeof p === 'string' && p) paths.push(p);
      }
    }
    if (typeof m.readCount === 'number') readCount = m.readCount;
    if (typeof m.totalToRead === 'number') totalToRead = m.totalToRead;
  }
  return { paths, readCount, totalToRead };
}

/** 0–2 = active step; 3 = all complete. */
function resolveStep(opts: {
  phase?: string;
  scored: boolean;
  completed: boolean;
  waitingForMap: boolean;
  productMapDone: boolean;
}): number {
  if (opts.productMapDone) return 3;
  if (opts.waitingForMap || opts.phase === 'product-map') return 2;
  if (opts.completed) return 2;
  if (opts.scored) return 1;
  if (opts.phase && !READ_PHASES.has(opts.phase)) return 1;
  return 0;
}

export default function AnalysisProgress() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preview = import.meta.env.DEV ? searchParams.get('preview') : null;
  const { messages } = useSSE(id && !preview ? `/api/takeoff/${id}/stream` : null);

  const latestProgress = [...messages].reverse().find((m) => m.type === 'progress') as ProgressMessage | undefined;
  const scored = messages.find((m) => m.type === 'scored') as ProgressMessage | undefined;
  const completed = messages.find((m) => m.type === 'complete') as ProgressMessage | undefined;
  const error = messages.find((m) => m.type === 'error') as ProgressMessage | undefined;

  // The product-map stage runs in a setImmediate after `complete` and
  // emits exactly one of these three events. We treat all three as
  // "we're done waiting" — `ready` is the happy path; `skipped` means
  // an existing map was reused (or no description signal); `failed`
  // means Claude/persistence errored. In all three cases the user
  // can proceed to the Read — the Map tab will either be populated
  // or fall back to its existing empty-state CTA.
  const productMapEvent = useMemo(
    () => messages.find((m) =>
      m.type === 'product-map-ready'
      || m.type === 'product-map-skipped'
      || m.type === 'product-map-failed',
    ) as ProgressMessage | undefined,
    [messages],
  );

  useEffect(() => {
    if (preview || !completed || !id) return;

    // Both gates met → navigate after a short beat so the "Analysis
    // complete" copy is visible briefly.
    if (productMapEvent) {
      const timer = setTimeout(() => navigate(`/read/${id}`), 800);
      return () => clearTimeout(timer);
    }

    // `complete` landed but the product-map event hasn't. Hold on the
    // loading screen for up to PRODUCT_MAP_WAIT_MS, then navigate
    // anyway. This is the fallback for SSE drops or a server-side
    // unhandled error that doesn't broadcast a terminal event.
    const fallback = setTimeout(() => navigate(`/read/${id}`), PRODUCT_MAP_WAIT_MS);
    return () => clearTimeout(fallback);
  }, [preview, completed, productMapEvent, id, navigate]);

  const phase = latestProgress?.phase;
  const waitingForMap = !!completed && !productMapEvent;
  const liveStep = resolveStep({
    phase,
    scored: !!scored,
    completed: !!completed,
    waitingForMap,
    productMapDone: !!productMapEvent,
  });
  const liveReadFiles = useMemo(() => collectReadFiles(messages as ProgressMessage[]), [messages]);

  const previewStep =
    preview === 'done' ? 3
      : preview === 'map' ? 2
        : preview === 'score' ? 1
          : preview === 'read' ? 0
            : null;
  const step = previewStep ?? liveStep;
  const readFiles = preview === 'read'
    ? { paths: PREVIEW_PATHS, readCount: 24, totalToRead: 150 }
    : liveReadFiles;
  const previewScore = preview === 'score' || preview === 'map' || preview === 'done' ? 72 : undefined;
  const displayScore = previewScore ?? (typeof scored?.score === 'number' ? scored.score : undefined);

  const heading = step >= 3 ? 'Analysis complete' : 'Analyzing your repo';

  const subcopy =
    preview === 'read' || (step === 0 && phase === 'reading')
      ? null
      : preview === 'score'
        ? 'Scoring production readiness…'
        : step >= 3
          ? 'Taking you to your project.'
          : step === 2
            ? 'Figuring out who your app is for and which jobs your code supports.'
            : step === 1
              ? (latestProgress?.message || PHASE_LABELS[phase || ''] || 'Looking at what you built.')
              : (latestProgress?.message || PHASE_LABELS[phase || ''] || 'Starting analysis…');

  return (
    <div className="min-h-screen flex flex-col">
      <Header variant="workspace" backTo="/" />

      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-24">
        <div className="max-w-md w-full space-y-8">
          {error ? (
            <div className="space-y-4 text-center">
              <div className="w-16 h-16 mx-auto rounded-full bg-danger-bg border border-danger-border flex items-center justify-center text-2xl">
                !
              </div>
              <h2 className="text-xl font-semibold">Analysis Failed</h2>
              <p className="text-text-muted text-sm">{error?.error}</p>
              <button
                onClick={() => navigate('/')}
                className="px-6 py-2 rounded-lg bg-surface border border-line text-text-soft hover:bg-page transition-colors text-sm"
              >
                Try Another Repo
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-1">
                <h2 className="text-xl font-semibold text-text">{heading}</h2>
                {subcopy ? (
                  <p className="text-text-muted text-sm">{subcopy}</p>
                ) : null}
              </div>

              <AnalysisSteps
                current={step}
                scoredScore={displayScore}
                readSlot={
                  <FileTicker
                    paths={readFiles.paths}
                    readCount={readFiles.readCount}
                    totalToRead={readFiles.totalToRead}
                  />
                }
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
