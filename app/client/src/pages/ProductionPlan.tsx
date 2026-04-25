import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, Copy, Check, Rocket, ChevronDown, ChevronRight } from 'lucide-react';
import Header from '../components/Header';
import { fetchProject, updatePlanStep, type Project, type PlanStep } from '../services/api';
import { useAuth } from '../hooks/useAuth';

const EFFORT_BADGE: Record<string, { label: string; className: string }> = {
  small: { label: 'Quick', className: 'bg-success-bg text-success border-success-border' },
  medium: { label: 'Medium', className: 'bg-warning-bg text-warning border-warning-border' },
  large: { label: 'Larger', className: 'bg-danger-bg text-danger border-danger-border' },
};

export default function ProductionPlan() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [steps, setSteps] = useState<PlanStep[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    fetchProject(id)
      .then((p) => {
        setProject(p);
        setSteps(p.plan_steps || []);
        const firstTodo = (p.plan_steps || []).find((s: PlanStep) => s.status === 'todo' && !s.isDeploy);
        if (firstTodo) setExpanded(firstTodo.id);
      })
      .finally(() => setLoading(false));
  }, [id]);

  const toggleStep = useCallback(async (stepId: string) => {
    const step = steps.find((s) => s.id === stepId);
    if (!step || step.isDeploy) return;
    const newStatus = step.status === 'done' ? 'todo' : 'done';
    const oldStatus = step.status;
    setSteps((prev) => prev.map((s) => s.id === stepId ? { ...s, status: newStatus } : s));
    if (id) {
      try {
        await updatePlanStep(id, stepId, newStatus);
      } catch {
        setSteps((prev) => prev.map((s) => s.id === stepId ? { ...s, status: oldStatus } : s));
      }
    }
  }, [steps, id]);

  const copyToClipboard = useCallback(async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header backTo={id ? `/projects/${id}` : '/'} />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-text-muted">Loading plan...</div>
        </main>
      </div>
    );
  }

  const doneCount = steps.filter((s) => s.status === 'done').length;
  const totalNonDeploy = steps.filter((s) => !s.isDeploy).length;
  const progressPct = totalNonDeploy > 0 ? Math.round((doneCount / totalNonDeploy) * 100) : 0;

  return (
    <div className="min-h-screen flex flex-col">
      <Header backTo={id ? `/projects/${id}` : '/'} title="Your Plan to Ship" />

      <main className="flex-1 px-6 py-10 max-w-2xl mx-auto w-full space-y-8">
        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-text-muted">{doneCount} of {totalNonDeploy} steps complete</span>
            <span className="text-brand font-medium">{progressPct}%</span>
          </div>
          <div className="h-2 rounded-full bg-surface border border-line overflow-hidden">
            <div
              className="h-full rounded-full bg-brand transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-3">
          {steps.map((step) => {
            const isExpanded = expanded === step.id;
            const effortBadge = EFFORT_BADGE[step.effort] ?? { label: step.effort || 'Unknown', className: 'bg-surface-2 text-text-muted border-line' };

            if (step.isDeploy) {
              return (
                <button
                  key={step.id}
                  onClick={() => {
                    if (!user) {
                      alert('Please log in to deploy.');
                      return;
                    }
                    navigate(`/deploy/${id}`);
                  }}
                  className="w-full p-5 rounded-xl bg-brand-tint border border-brand hover:bg-brand-tint-2 transition-all text-left flex items-center gap-4"
                >
                  <Rocket size={22} className="text-brand flex-shrink-0" />
                  <div className="flex-1">
                    <div className="font-semibold text-text">Deploy</div>
                    <div className="text-xs text-text-muted">{step.why}</div>
                  </div>
                  <span className="text-xs text-brand font-medium">Step {step.stepNumber}</span>
                </button>
              );
            }

            return (
              <div key={step.id} className="rounded-xl bg-surface border border-line overflow-hidden">
                <div
                  className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-page/50 transition-colors"
                  onClick={() => setExpanded(isExpanded ? null : step.id)}
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleStep(step.id); }}
                    className="flex-shrink-0"
                  >
                    {step.status === 'done'
                      ? <CheckCircle2 size={22} className="text-success" />
                      : <Circle size={22} className="text-text-disabled" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium ${step.status === 'done' ? 'text-text-muted line-through' : 'text-text'}`}>
                      {step.title}
                    </div>
                    <div className="text-xs text-text-muted truncate">{step.why}</div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] border ${effortBadge.className}`}>
                    {effortBadge.label}
                  </span>
                  <span className="text-xs text-text-muted">Step {step.stepNumber}</span>
                  {isExpanded ? <ChevronDown size={16} className="text-text-muted" /> : <ChevronRight size={16} className="text-text-muted" />}
                </div>

                {isExpanded && (
                  <div className="px-5 pb-5 space-y-4 border-t border-divider">
                    {step.contextFile && (
                      <div className="space-y-2 pt-4">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-medium text-brand uppercase tracking-wide">Context File</h4>
                          <button
                            onClick={() => copyToClipboard(step.contextFile!, `ctx-${step.id}`)}
                            className="flex items-center gap-1 text-xs text-text-muted hover:text-text transition-colors"
                          >
                            {copied === `ctx-${step.id}` ? <Check size={12} /> : <Copy size={12} />}
                            {copied === `ctx-${step.id}` ? 'Copied!' : 'Copy'}
                          </button>
                        </div>
                        <pre className="text-xs text-text-soft bg-page rounded-lg p-4 overflow-auto max-h-64 border border-divider">
                          {step.contextFile}
                        </pre>
                      </div>
                    )}

                    {step.cursorPrompt && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-medium text-brand uppercase tracking-wide">Cursor Prompt</h4>
                          <button
                            onClick={() => copyToClipboard(step.cursorPrompt!, `prompt-${step.id}`)}
                            className="flex items-center gap-1 text-xs text-text-muted hover:text-text transition-colors"
                          >
                            {copied === `prompt-${step.id}` ? <Check size={12} /> : <Copy size={12} />}
                            {copied === `prompt-${step.id}` ? 'Copied!' : 'Copy prompt'}
                          </button>
                        </div>
                        <pre className="text-xs text-text-soft bg-page rounded-lg p-4 overflow-auto max-h-48 border border-divider whitespace-pre-wrap">
                          {step.cursorPrompt}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
