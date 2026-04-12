import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Header from '../components/Header';
import { useSSE } from '../hooks/useSSE';

interface ProgressMessage {
  type: string;
  phase?: string;
  message?: string;
  score?: number;
  error?: string;
  [key: string]: unknown;
}

const PHASE_LABELS: Record<string, string> = {
  meta: 'Fetching repo metadata...',
  tree: 'Reading file tree...',
  'tree-done': 'Found files',
  reading: 'Reading key files...',
  analyzing: 'Detecting tech stack...',
  complete: 'Analysis complete',
  scoring: 'Scoring production readiness...',
  planning: 'Generating your plan...',
};

export default function AnalysisProgress() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { messages } = useSSE(id ? `/api/takeoff/${id}/stream` : null);

  const latestProgress = [...messages].reverse().find((m) => m.type === 'progress') as ProgressMessage | undefined;
  const scored = messages.find((m) => m.type === 'scored') as ProgressMessage | undefined;
  const completed = messages.find((m) => m.type === 'complete') as ProgressMessage | undefined;
  const error = messages.find((m) => m.type === 'error') as ProgressMessage | undefined;

  useEffect(() => {
    if (completed && id) {
      const timer = setTimeout(() => navigate(`/projects/${id}`), 800);
      return () => clearTimeout(timer);
    }
  }, [completed, id, navigate]);

  const phase = latestProgress?.phase;
  const message = latestProgress?.message;

  return (
    <div className="min-h-screen flex flex-col">
      <Header backTo="/" />

      <main className="flex-1 flex flex-col items-center justify-center px-6 pb-24">
        <div className="max-w-lg w-full text-center space-y-8">
          {error ? (
            <div className="space-y-4">
              <div className="w-16 h-16 mx-auto rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center text-2xl">
                !
              </div>
              <h2 className="text-xl font-semibold">Analysis Failed</h2>
              <p className="text-sky-muted text-sm">{error?.error}</p>
              <button
                onClick={() => navigate('/')}
                className="px-6 py-2 rounded-lg bg-navy border border-sky-border text-sky-off hover:bg-navy-mid transition-colors text-sm"
              >
                Try Another Repo
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="relative w-20 h-20 mx-auto">
                <Loader2 className="w-20 h-20 text-gold animate-spin" />
                {scored && (
                  <div className="absolute inset-0 flex items-center justify-center font-bold text-lg text-sky-white">
                    {scored.score}%
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <h2 className="text-xl font-semibold text-sky-white">
                  {completed ? 'Analysis Complete' : scored ? 'Generating plan...' : 'Analyzing your repo'}
                </h2>
                <p className="text-sky-muted text-sm">
                  {message || (phase && PHASE_LABELS[phase]) || 'Starting analysis...'}
                </p>
              </div>

              {scored && !completed && (
                <div className="text-sm text-gold">
                  Production readiness: {scored.score}%
                </div>
              )}

              <div className="flex flex-col gap-1 text-left max-w-sm mx-auto">
                {messages
                  .filter((m) => m.type === 'progress')
                  .slice(-5)
                  .map((m, i) => (
                    <div key={i} className="text-xs text-sky-muted truncate">
                      {(m as ProgressMessage).message}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
