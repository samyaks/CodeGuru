import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader, Check, Circle, AlertCircle } from 'lucide-react';
import { useSSE } from '../hooks/useSSE';
import { fetchReview } from '../services/api';

interface Step {
  label: string;
  phase: string;
  status: 'pending' | 'active' | 'done' | 'error';
  message?: string;
}

const INITIAL_STEPS: Step[] = [
  { label: 'Fetching repository data', phase: 'fetching', status: 'pending' },
  { label: 'Running AI review', phase: 'analyzing', status: 'pending' },
  { label: 'Parsing results', phase: 'parsing', status: 'pending' },
  { label: 'Generating fix prompts', phase: 'fix-prompts', status: 'pending' },
];

export default function ReviewProgress() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { messages, error: sseError } = useSSE(id ? `/api/reviews/${id}/stream` : null);
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [currentMessage, setCurrentMessage] = useState('Starting review...');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchReview(id).then((data) => {
      if (data.status === 'completed') navigate(`/review/${id}`, { replace: true });
    }).catch(() => {});
  }, [id, navigate]);

  useEffect(() => {
    for (const msg of messages) {
      if (msg.type === 'review-completed') {
        navigate(`/review/${id}`, { replace: true });
        return;
      }
      if (msg.type === 'review-error') {
        setFailed(true);
        setCurrentMessage((msg as any).error || 'Review failed');
        return;
      }
      if (msg.type === 'progress') {
        const phase = (msg as any).phase as string;
        const message = (msg as any).message as string;
        if (message) setCurrentMessage(message);

        setSteps((prev) => {
          const next = [...prev];
          const phaseMap: Record<string, number> = {
            fetching: 0, fetched: 0,
            analyzing: 1,
            parsing: 2,
            'fix-prompts': 3, 'fix-prompts-done': 3,
          };

          const idx = phaseMap[phase];
          if (idx === undefined) return prev;

          for (let i = 0; i < next.length; i++) {
            if (i < idx) next[i] = { ...next[i], status: 'done' };
            else if (i === idx) next[i] = { ...next[i], status: 'active', message };
            else next[i] = { ...next[i], status: 'pending' };
          }
          return next;
        });
      }
    }
  }, [messages, id, navigate]);

  return (
    <div className="min-h-screen">
      <header className="flex items-center gap-4 px-6 py-4 border-b border-neutral-800/50">
        <Link to="/dashboard" className="text-neutral-400 hover:text-white transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-lg font-semibold">Reviewing...</h1>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-16">
        <div className="flex flex-col items-center space-y-8 text-center">
          {!failed && <Loader size={32} className="animate-spin text-violet-400" />}
          {failed && <AlertCircle size={32} className="text-red-400" />}

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">
              {failed ? 'Review failed' : 'Reviewing code'}
            </h2>
            <p className="text-neutral-400 text-sm">{currentMessage}</p>
          </div>

          <div className="w-full space-y-3 text-left">
            {steps.map((step, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-all ${
                  step.status === 'active'
                    ? 'bg-violet-500/5 border-violet-500/30'
                    : step.status === 'done'
                    ? 'bg-green-500/5 border-green-500/20'
                    : step.status === 'error'
                    ? 'bg-red-500/5 border-red-500/20'
                    : 'bg-neutral-900/50 border-neutral-800/50'
                }`}
              >
                {step.status === 'done' && <Check size={16} className="text-green-400 shrink-0" />}
                {step.status === 'active' && <Loader size={16} className="animate-spin text-violet-400 shrink-0" />}
                {step.status === 'error' && <AlertCircle size={16} className="text-red-400 shrink-0" />}
                {step.status === 'pending' && <Circle size={16} className="text-neutral-700 shrink-0" />}

                <div className="flex-1 min-w-0">
                  <span className={`text-sm ${
                    step.status === 'active' ? 'text-white' :
                    step.status === 'done' ? 'text-green-300' :
                    'text-neutral-500'
                  }`}>
                    {step.label}
                  </span>
                  {step.status === 'active' && step.message && (
                    <p className="text-xs text-neutral-500 truncate mt-0.5">{step.message}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {sseError && (
            <p className="text-red-400 text-sm">Connection lost. Refresh to check status.</p>
          )}
        </div>
      </main>
    </div>
  );
}
