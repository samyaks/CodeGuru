import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader, Check, Circle, AlertCircle } from 'lucide-react';
import Header from '../components/Header';
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
  const lastProcessed = useRef(0);

  useEffect(() => {
    if (!id) return;
    fetchReview(id).then((data) => {
      if (data.status === 'completed') navigate(`/review/${id}`, { replace: true });
    }).catch(() => {});
  }, [id, navigate]);

  useEffect(() => {
    for (let i = lastProcessed.current; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.type === 'review-completed') {
        lastProcessed.current = messages.length;
        navigate(`/review/${id}`, { replace: true });
        return;
      }
      if (msg.type === 'review-error') {
        setFailed(true);
        setCurrentMessage(msg.error || 'Review failed');
        lastProcessed.current = messages.length;
        return;
      }
      if (msg.type === 'progress') {
        const { phase, message } = msg;
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

          for (let j = 0; j < next.length; j++) {
            if (j < idx) next[j] = { ...next[j], status: 'done' };
            else if (j === idx) next[j] = { ...next[j], status: 'active', message };
            else next[j] = { ...next[j], status: 'pending' };
          }
          return next;
        });
      }
    }
    lastProcessed.current = messages.length;
  }, [messages, id, navigate]);

  return (
    <div className="min-h-screen">
      <Header backTo="/dashboard" title="Reviewing..." />

      <main className="max-w-2xl mx-auto px-6 py-16">
        <div className="flex flex-col items-center space-y-8 text-center">
          {!failed && <Loader size={32} className="animate-spin text-gold" />}
          {failed && <AlertCircle size={32} className="text-red-600" />}

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">
              {failed ? 'Review failed' : 'Reviewing code'}
            </h2>
            <p className="text-sky-muted text-sm">{currentMessage}</p>
          </div>

          <div className="w-full space-y-3 text-left">
            {steps.map((step, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-all ${
                  step.status === 'active'
                    ? 'bg-gold/5 border-gold/30'
                    : step.status === 'done'
                    ? 'bg-emerald-500/5 border-emerald-500/20'
                    : step.status === 'error'
                    ? 'bg-red-500/5 border-red-500/20'
                    : 'bg-navy border-sky-border'
                }`}
              >
                {step.status === 'done' && <Check size={16} className="text-emerald-600 shrink-0" />}
                {step.status === 'active' && <Loader size={16} className="animate-spin text-gold shrink-0" />}
                {step.status === 'error' && <AlertCircle size={16} className="text-red-600 shrink-0" />}
                {step.status === 'pending' && <Circle size={16} className="text-border-dark shrink-0" />}

                <div className="flex-1 min-w-0">
                  <span className={`text-sm ${
                    step.status === 'active' ? 'text-ink' :
                    step.status === 'done' ? 'text-emerald-600' :
                    'text-sky-muted'
                  }`}>
                    {step.label}
                  </span>
                  {step.status === 'active' && step.message && (
                    <p className="text-xs text-sky-muted truncate mt-0.5">{step.message}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {sseError && (
            <p className="text-red-600 text-sm">Connection lost. Refresh to check status.</p>
          )}
        </div>
      </main>
    </div>
  );
}
