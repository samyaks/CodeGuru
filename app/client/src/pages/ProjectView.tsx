import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import {
  CheckCircle2, XCircle, AlertCircle, Rocket, ClipboardList,
  ExternalLink, Loader2, Trash2, Lightbulb, Star, GitFork,
} from 'lucide-react';
import Header from '../components/Header';
import FeaturesSummary from '../components/FeaturesSummary';
import CodebaseDetails from '../components/CodebaseDetails';
import SuggestionsPanel from '../components/SuggestionsPanel';
import BuildStory from './BuildStory';
import Analytics from './Analytics';
import {
  fetchProjectDetail,
  deleteProject,
  type ProjectWithEntries,
  type ReadinessCategory,
  type PlanStep,
} from '../services/api';
import { useAuth } from '../hooks/useAuth';

type Tab = 'overview' | 'analysis' | 'suggestions' | 'settings';

const STATUS_ICON: Record<string, React.ReactNode> = {
  ready: <CheckCircle2 size={18} className="text-emerald-600" />,
  partial: <AlertCircle size={18} className="text-amber-600" />,
  missing: <XCircle size={18} className="text-red-600" />,
};

const STATUS_COLORS: Record<string, string> = {
  live: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  deployed: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  deploying: 'bg-gold/10 text-gold border-gold/20',
  building: 'bg-gold/10 text-gold border-gold/20',
  ready: 'bg-sky-muted/10 text-sky-muted border-sky-border',
  scored: 'bg-sky-muted/10 text-sky-muted border-sky-border',
  failed: 'bg-red-500/10 text-red-600 border-red-500/20',
  error: 'bg-red-500/10 text-red-600 border-red-500/20',
  pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  analyzing: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
};

export default function ProjectView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const VALID_TABS: Tab[] = ['overview', 'analysis', 'suggestions', 'settings'];
  const params = new URLSearchParams(location.search);
  const urlTab = params.get('tab') as Tab;
  const tab: Tab = VALID_TABS.includes(urlTab) ? urlTab : 'overview';
  const setTab = (t: Tab) => {
    const search = t === 'overview' ? '' : `?tab=${t}`;
    navigate(`${location.pathname}${search}`, { replace: true });
  };
  const mountedTabs = useRef<Set<Tab>>(new Set(['overview']));
  if (!mountedTabs.current.has(tab)) mountedTabs.current.add(tab);

  const [project, setProject] = useState<ProjectWithEntries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchProjectDetail(id)
      .then(setProject)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!loading && project && (project.status === 'analyzing' || project.status === 'pending')) {
      navigate(`/takeoff/${id}`, { replace: true });
    }
  }, [loading, project, id, navigate]);

  const handleDelete = useCallback(async () => {
    if (!id) return;
    setDeleting(true);
    try {
      await deleteProject(id);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [id, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header backTo="/dashboard" />
        <main className="flex-1 flex items-center justify-center">
          <Loader2 size={32} className="animate-spin text-sky-muted" />
        </main>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header backTo="/dashboard" />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-red-600">{error || 'Project not found'}</div>
        </main>
      </div>
    );
  }

  const score = project.readiness_score ?? 0;
  const categories: Record<string, ReadinessCategory> = project.readiness_categories || {};
  const steps: PlanStep[] = project.plan_steps || [];
  const doneSteps = steps.filter((s) => s.status === 'done').length;
  const totalSteps = steps.filter((s) => !s.isDeploy).length;
  const stack = project.stack_info;
  const buildPlan = project.build_plan;
  const deployed = project.status === 'live' || project.status === 'deployed';
  const recommendation = project.recommendation || 'plan';
  const isDeployRecommended = recommendation === 'deploy';
  const analysis = project.analysis_data;

  const statusClass = STATUS_COLORS[project.status] || 'bg-sky-muted/10 text-sky-muted border-sky-border';

  const suggestionsCount = project.suggestions_count ?? 0;

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'analysis', label: 'Analysis' },
    { key: 'suggestions', label: 'Suggestions', badge: suggestionsCount > 0 ? suggestionsCount : undefined },
    { key: 'settings', label: 'Settings' },
  ];

  const envVars: string[] = [];
  if (buildPlan) {
    if (buildPlan.buildCommand) envVars.push(`BUILD_COMMAND=${buildPlan.buildCommand}`);
    if (buildPlan.startCommand) envVars.push(`START_COMMAND=${buildPlan.startCommand}`);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header backTo="/dashboard" title={`${project.owner}/${project.repo}`} />

      <main className="flex-1 max-w-3xl mx-auto w-full px-6 py-8 space-y-8">
        {/* Project header info */}
        <div className="flex flex-wrap items-center gap-3">
          <span className={`px-2.5 py-0.5 rounded text-xs font-medium border ${statusClass}`}>
            {project.status}
          </span>

          {score > 0 && (
            <div className="flex items-center gap-1.5">
              <div className="w-8 h-8 rounded-full border-2 border-gold/30 bg-midnight flex items-center justify-center">
                <span className="text-xs font-bold text-sky-white">{score}%</span>
              </div>
              <span className="text-xs text-sky-muted">Readiness</span>
            </div>
          )}

          {project.framework && (
            <span className="px-2.5 py-0.5 rounded text-xs bg-navy-mid border border-sky-border text-sky-off">
              {project.framework}
            </span>
          )}

          {deployed && project.live_url && (
            <a
              href={project.live_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
            >
              <ExternalLink size={12} />
              Live URL
            </a>
          )}
        </div>

        {/* Tabs */}
        <div role="tablist" className="flex gap-1 bg-navy rounded-lg p-1 w-fit border border-sky-border/50">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              aria-controls={`tabpanel-${t.key}`}
              onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                tab === t.key
                  ? 'bg-gold/10 text-gold border border-gold/20'
                  : 'text-sky-muted hover:text-sky-white border border-transparent'
              }`}
            >
              {t.key === 'suggestions' && <Lightbulb size={14} />}
              {t.label}
              {t.badge !== undefined && (
                <span className="ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-gold/10 text-gold border border-gold/20">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ───────── Overview Tab ───────── */}
        {tab === 'overview' && (
          <div role="tabpanel" id="tabpanel-overview" className="space-y-8">
            {/* Stack badges */}
            {stack && (
              <div className="flex flex-wrap gap-2">
                {[stack.framework, stack.styling, stack.database, stack.auth, ...(stack.languages || [])]
                  .filter(Boolean)
                  .map((badge) => (
                    <span key={badge} className="px-3 py-1 rounded-full text-xs bg-navy border border-sky-border text-sky-off">
                      {badge}
                    </span>
                  ))}
                {buildPlan?.type && (
                  <span className="px-3 py-1 rounded-full text-xs bg-gold/10 border border-gold/20 text-gold">
                    {buildPlan.type === 'static' ? 'Static site' : buildPlan.type === 'fullstack' ? 'Full-stack' : buildPlan.type}
                  </span>
                )}
                {analysis?.meta && (
                  <>
                    {analysis.meta.stars > 0 && (
                      <span className="px-3 py-1 rounded-full text-xs bg-navy border border-sky-border text-sky-muted flex items-center gap-1">
                        <Star size={10} /> {analysis.meta.stars}
                      </span>
                    )}
                    {analysis.meta.forks > 0 && (
                      <span className="px-3 py-1 rounded-full text-xs bg-navy border border-sky-border text-sky-muted flex items-center gap-1">
                        <GitFork size={10} /> {analysis.meta.forks}
                      </span>
                    )}
                  </>
                )}
              </div>
            )}

            {/* What It Does */}
            {project.features_summary && (
              <FeaturesSummary summary={project.features_summary} />
            )}

            {/* Build Story */}
            {id && <BuildStory projectId={id} />}

            {/* Plan progress bar */}
            {totalSteps > 0 && (
              <div className="bg-navy border border-sky-border/50 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium text-sky-white flex items-center gap-2">
                    <ClipboardList size={18} className="text-gold" />
                    Plan Progress
                  </h3>
                  <Link
                    to={`/takeoff/${id}/plan`}
                    className="text-xs text-gold hover:text-gold-dim transition-colors"
                  >
                    View full plan →
                  </Link>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-sky-muted">{doneSteps} of {totalSteps} steps complete</span>
                  <span className="text-gold font-medium">
                    {totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-midnight border border-sky-border/50 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gold transition-all duration-500"
                    style={{ width: `${totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0}%` }}
                  />
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="grid md:grid-cols-2 gap-4">
              <button
                onClick={() => {
                  if (!user) {
                    alert('Please log in to deploy.');
                    return;
                  }
                  navigate(`/deploy/${id}`);
                }}
                className="p-5 rounded-xl bg-gold/10 border border-gold/30 hover:bg-gold/20 transition-all text-left flex items-center gap-4"
              >
                <Rocket size={22} className="text-gold flex-shrink-0" />
                <div>
                  <div className="font-semibold text-sky-white">
                    {deployed ? 'Redeploy' : 'Deploy Now'}
                  </div>
                  <div className="text-xs text-sky-muted">
                    {deployed ? 'Push a new version.' : 'Ship it to the world.'}
                  </div>
                </div>
              </button>

              <Link
                to={`/takeoff/${id}/plan`}
                className="p-5 rounded-xl bg-navy border border-sky-border hover:bg-navy-mid transition-all text-left flex items-center gap-4"
              >
                <ClipboardList size={22} className="text-sky-muted flex-shrink-0" />
                <div>
                  <div className="font-semibold text-sky-white">View Plan</div>
                  <div className="text-xs text-sky-muted">See all steps and prompts.</div>
                </div>
              </Link>
            </div>
          </div>
        )}

        {/* ───────── Analysis Tab ───────── */}
        {tab === 'analysis' && (
          <div role="tabpanel" id="tabpanel-analysis" className="space-y-8">
            {/* Readiness score circle */}
            {score > 0 && (
              <div className="text-center space-y-4">
                <div className="inline-flex items-center justify-center w-28 h-28 rounded-full border-4 border-gold/30 bg-navy">
                  <span className="text-4xl font-bold text-sky-white">{score}%</span>
                </div>
                <h2 className="text-2xl font-semibold text-sky-white">Production Readiness</h2>
                {project.description && (
                  <p className="text-sky-off text-sm max-w-lg mx-auto italic">{project.description}</p>
                )}
                <p className="text-sky-muted text-sm max-w-md mx-auto">
                  {score >= 90
                    ? 'Your app looks ready to deploy. You can ship it now or review the details below.'
                    : `Your app is ${score}% of the way there. We've identified what's missing and built you a plan.`}
                </p>
              </div>
            )}

            {/* Category breakdown */}
            {Object.keys(categories).length > 0 && (
              <div className="grid gap-2">
                {Object.entries(categories).map(([key, cat]) => (
                  <div key={key} className="flex items-center gap-3 px-4 py-3 rounded-lg bg-navy border border-sky-border/50">
                    {STATUS_ICON[cat.status]}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-sky-white">{cat.label}</div>
                      <div className="text-xs text-sky-muted truncate">{cat.detail}</div>
                    </div>
                    <div className="text-xs text-sky-muted">{cat.earned}/{cat.weight}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Dual-path CTA */}
            <div className="grid md:grid-cols-2 gap-4">
              <button
                onClick={() => {
                  if (!user) { alert('Please log in to deploy.'); return; }
                  navigate(`/takeoff/${id}/env-setup`);
                }}
                className={`p-6 rounded-xl border text-left transition-all ${
                  isDeployRecommended
                    ? 'bg-gold/10 border-gold/30 hover:bg-gold/20 ring-1 ring-gold/20'
                    : 'bg-navy border-sky-border hover:bg-navy-mid'
                }`}
              >
                <Rocket size={24} className={isDeployRecommended ? 'text-gold mb-3' : 'text-sky-muted mb-3'} />
                <h3 className="font-semibold text-sky-white mb-1">
                  {isDeployRecommended ? 'Deploy Now' : 'Deploy Anyway'}
                </h3>
                <p className="text-xs text-sky-muted">
                  {isDeployRecommended
                    ? 'Your app looks ready. Ship it to the world.'
                    : 'Ship as-is. You can improve later.'}
                </p>
                {isDeployRecommended && (
                  <span className="inline-block mt-3 text-xs text-gold font-medium">Recommended</span>
                )}
              </button>

              <Link
                to={`/takeoff/${id}/plan`}
                className={`p-6 rounded-xl border text-left transition-all block ${
                  !isDeployRecommended
                    ? 'bg-gold/10 border-gold/30 hover:bg-gold/20 ring-1 ring-gold/20'
                    : 'bg-navy border-sky-border hover:bg-navy-mid'
                }`}
              >
                <ClipboardList size={24} className={!isDeployRecommended ? 'text-gold mb-3' : 'text-sky-muted mb-3'} />
                <h3 className="font-semibold text-sky-white mb-1">
                  {!isDeployRecommended ? 'Plan to Ship' : 'See Plan Anyway'}
                </h3>
                <p className="text-xs text-sky-muted">
                  {!isDeployRecommended
                    ? `${Object.values(categories).filter((c) => c.status === 'missing').length} things to add. Context files + prompts for each step.`
                    : 'Review what could be improved with context files for each area.'}
                </p>
                {!isDeployRecommended && (
                  <span className="inline-block mt-3 text-xs text-gold font-medium">Recommended</span>
                )}
              </Link>
            </div>

            {/* Codebase Details */}
            {analysis ? (
              <CodebaseDetails analysis={analysis} gaps={analysis.gaps || {}} />
            ) : (
              <div className="text-center py-12 text-sky-muted text-sm">
                Detailed analysis data is not available for this project. Try re-analyzing.
              </div>
            )}
          </div>
        )}

        {/* ───────── Suggestions Tab (lazy mount, stays mounted) ───────── */}
        {mountedTabs.current.has('suggestions') && id && (
          <div role="tabpanel" id="tabpanel-suggestions" className={tab !== 'suggestions' ? 'hidden' : ''}>
            <SuggestionsPanel projectId={id} projectStatus={project.status} />
          </div>
        )}

        {/* ───────── Settings Tab (lazy mount, stays mounted) ───────── */}
        {mountedTabs.current.has('settings') && (
          <div role="tabpanel" id="tabpanel-settings" className={`space-y-8 ${tab !== 'settings' ? 'hidden' : ''}`}>
            {/* Analytics */}
            {id && <Analytics projectId={id} />}

            {/* Build configuration */}
            <div className="bg-navy border border-sky-border/50 rounded-xl p-5 space-y-3">
              <h3 className="font-medium text-sky-white">Build Configuration</h3>
              {buildPlan ? (
                <div className="space-y-2">
                  <Row label="Type" value={buildPlan.type} />
                  <Row label="Framework" value={buildPlan.framework} />
                  <Row label="Confidence" value={buildPlan.confidence} />
                  {buildPlan.buildCommand && <Row label="Build command" value={buildPlan.buildCommand} />}
                  {buildPlan.startCommand && <Row label="Start command" value={buildPlan.startCommand} />}
                </div>
              ) : (
                <p className="text-sm text-sky-muted">No build plan detected yet.</p>
              )}
            </div>

            {envVars.length > 0 && (
              <div className="bg-navy border border-sky-border/50 rounded-xl p-5 space-y-3">
                <h3 className="font-medium text-sky-white">Detected Environment Variables</h3>
                <pre className="text-xs text-sky-off bg-midnight rounded-lg p-4 border border-sky-border/30 overflow-auto">
                  {envVars.join('\n')}
                </pre>
              </div>
            )}

            {/* Danger zone */}
            <div className="bg-navy border border-red-500/20 rounded-xl p-5 space-y-4">
              <h3 className="font-medium text-red-600">Danger Zone</h3>
              <p className="text-sm text-sky-muted">
                Permanently delete this project and all associated data.
              </p>
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 text-red-600 border border-red-500/20 hover:bg-red-500/20 text-sm font-medium transition-colors"
                >
                  <Trash2 size={14} />
                  Delete Project
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-500 transition-colors disabled:opacity-50"
                  >
                    {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    {deleting ? 'Deleting...' : 'Confirm Delete'}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-4 py-2 rounded-lg text-sm text-sky-muted hover:text-sky-white transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-sky-muted">{label}</span>
      <span className="text-sky-off font-medium">{value || '—'}</span>
    </div>
  );
}
