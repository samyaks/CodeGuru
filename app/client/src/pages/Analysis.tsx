import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader, Check, Circle, AlertCircle } from 'lucide-react';
import Header from '../components/Header';
import { useSSE } from '../hooks/useSSE';
import { fetchAnalysis } from '../services/api';

interface Step {
  label: string;
  phase: string;
  status: 'pending' | 'active' | 'done' | 'error';
  message?: string;
}

const INITIAL_STEPS: Step[] = [
  { label: 'Reading repo structure', phase: 'tree', status: 'pending' },
  { label: 'Analyzing key files', phase: 'reading', status: 'pending' },
  { label: 'Detecting tech stack & gaps', phase: 'analyzing', status: 'pending' },
  { label: 'Generating .context.md files', phase: 'generating', status: 'pending' },
];

export default function Analysis() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { messages, error: sseError } = useSSE(id ? `/api/analyze/${id}/stream` : null);
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [currentMessage, setCurrentMessage] = useState('Starting analysis...');
  const [failed, setFailed] = useState(false);
  const lastProcessed = useRef(0);

  useEffect(() => {
    if (!id) return;
    fetchAnalysis(id).then((data) => {
      if (data.status === 'completed') navigate(`/results/${id}`, { replace: true });
    }).catch(() => {});
  }, [id, navigate]);

  useEffect(() => {
    for (let i = lastProcessed.current; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.type === 'analysis-completed') {
        lastProcessed.current = messages.length;
        navigate(`/results/${id}`, { replace: true });
        return;
      }
      if (msg.type === 'analysis-error') {
        setFailed(true);
        setCurrentMessage(msg.error || 'Analysis failed');
        lastProcessed.current = messages.length;
        return;
      }
      if (msg.type === 'progress') {
        const { phase, message } = msg;
        if (message) setCurrentMessage(message);

        setSteps((prev) => {
          const next = [...prev];
          const phaseMap: Record<string, number> = {
            meta: 0, tree: 0, 'tree-done': 0,
            reading: 1,
            analyzing: 2, complete: 2,
            generating: 3, 'context-start': 3, 'context-app': 3,
            'context-feature': 3, 'context-gap': 3, 'context-done': 3,
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
      <Header backTo="/" title="Analyzing..." />

      <main className="max-w-2xl mx-auto px-6 py-16">
        <div className="flex flex-col items-center space-y-8 text-center">
          {!failed && (
            <Loader size={32} className="animate-spin text-violet-400" />
          )}
          {failed && (
            <AlertCircle size={32} className="text-red-400" />
          )}

          <div className="space-y-2">
            <h2 className="text-xl font-semibold">
              {failed ? 'Analysis failed' : 'Analyzing repository'}
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
