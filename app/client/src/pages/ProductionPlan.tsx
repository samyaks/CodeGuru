import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, Copy, Check, Rocket, ChevronDown, ChevronRight } from 'lucide-react';
import Header from '../components/Header';
import { fetchProject, updatePlanStep, type Project, type PlanStep } from '../services/api';
import { useAuth } from '../hooks/useAuth';

const EFFORT_BADGE: Record<string, { label: string; className: string }> = {
  small: { label: 'Quick', className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
  medium: { label: 'Medium', className: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
  large: { label: 'Larger', className: 'bg-red-500/10 text-red-600 border-red-500/20' },
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
        <Header backTo={id ? `/takeoff/${id}/report` : '/'} />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-sky-muted">Loading plan...</div>
        </main>
      </div>
    );
  }

  const doneCount = steps.filter((s) => s.status === 'done').length;
  const totalNonDeploy = steps.filter((s) => !s.isDeploy).length;
  const progressPct = totalNonDeploy > 0 ? Math.round((doneCount / totalNonDeploy) * 100) : 0;

  return (
    <div className="min-h-screen flex flex-col">
      <Header backTo={id ? `/takeoff/${id}/report` : '/'} title="Your Plan to Ship" />

      <main className="flex-1 px-6 py-10 max-w-2xl mx-auto w-full space-y-8">
        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-sky-muted">{doneCount} of {totalNonDeploy} steps complete</span>
            <span className="text-gold font-medium">{progressPct}%</span>
          </div>
          <div className="h-2 rounded-full bg-navy border border-sky-border/50 overflow-hidden">
            <div
              className="h-full rounded-full bg-gold transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Steps */}
        <div className="space-y-3">
          {steps.map((step) => {
            const isExpanded = expanded === step.id;
            const effortBadge = EFFORT_BADGE[step.effort];

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
                  className="w-full p-5 rounded-xl bg-gold/10 border border-gold/30 hover:bg-gold/20 transition-all text-left flex items-center gap-4"
                >
                  <Rocket size={22} className="text-gold flex-shrink-0" />
                  <div className="flex-1">
                    <div className="font-semibold text-sky-white">Deploy</div>
                    <div className="text-xs text-sky-muted">{step.why}</div>
                  </div>
                  <span className="text-xs text-gold font-medium">Step {step.stepNumber}</span>
                </button>
              );
            }

            return (
              <div key={step.id} className="rounded-xl bg-navy border border-sky-border/50 overflow-hidden">
                <div
                  className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-navy-mid/50 transition-colors"
                  onClick={() => setExpanded(isExpanded ? null : step.id)}
                >
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleStep(step.id); }}
                    className="flex-shrink-0"
                  >
                    {step.status === 'done'
                      ? <CheckCircle2 size={22} className="text-emerald-600" />
                      : <Circle size={22} className="text-sky-border" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium ${step.status === 'done' ? 'text-sky-muted line-through' : 'text-sky-white'}`}>
                      {step.title}
                    </div>
                    <div className="text-xs text-sky-muted truncate">{step.why}</div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] border ${effortBadge.className}`}>
                    {effortBadge.label}
                  </span>
                  <span className="text-xs text-sky-muted">Step {step.stepNumber}</span>
                  {isExpanded ? <ChevronDown size={16} className="text-sky-muted" /> : <ChevronRight size={16} className="text-sky-muted" />}
                </div>

                {isExpanded && (
                  <div className="px-5 pb-5 space-y-4 border-t border-sky-border/30">
                    {step.contextFile && (
                      <div className="space-y-2 pt-4">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-medium text-gold uppercase tracking-wide">Context File</h4>
                          <button
                            onClick={() => copyToClipboard(step.contextFile!, `ctx-${step.id}`)}
                            className="flex items-center gap-1 text-xs text-sky-muted hover:text-sky-white transition-colors"
                          >
                            {copied === `ctx-${step.id}` ? <Check size={12} /> : <Copy size={12} />}
                            {copied === `ctx-${step.id}` ? 'Copied!' : 'Copy'}
                          </button>
                        </div>
                        <pre className="text-xs text-sky-off bg-midnight rounded-lg p-4 overflow-auto max-h-64 border border-sky-border/30">
                          {step.contextFile}
                        </pre>
                      </div>
                    )}

                    {step.cursorPrompt && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-medium text-gold uppercase tracking-wide">Cursor Prompt</h4>
                          <button
                            onClick={() => copyToClipboard(step.cursorPrompt!, `prompt-${step.id}`)}
                            className="flex items-center gap-1 text-xs text-sky-muted hover:text-sky-white transition-colors"
                          >
                            {copied === `prompt-${step.id}` ? <Check size={12} /> : <Copy size={12} />}
                            {copied === `prompt-${step.id}` ? 'Copied!' : 'Copy prompt'}
                          </button>
                        </div>
                        <pre className="text-xs text-sky-off bg-midnight rounded-lg p-4 overflow-auto max-h-48 border border-sky-border/30 whitespace-pre-wrap">
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
