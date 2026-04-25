import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Rocket,
  ClipboardList,
  ExternalLink,
  Loader2,
  Trash2,
  Lightbulb,
  Star,
  GitFork,
  Map,
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
import { Badge, Button, Card, Pill, ScoreRing, SegmentedTabs } from '../components/ui';
import type { BadgeStatus, TabItem } from '../components/ui';

type Tab = 'overview' | 'analysis' | 'suggestions' | 'settings';

const STATUS_ICON: Record<string, React.ReactNode> = {
  ready: <CheckCircle2 size={18} className="text-success shrink-0" />,
  partial: <AlertCircle size={18} className="text-warning shrink-0" />,
  missing: <XCircle size={18} className="text-danger shrink-0" />,
};

const KNOWN_BADGE_STATUSES: ReadonlyArray<BadgeStatus> = [
  'live',
  'deployed',
  'deploying',
  'building',
  'ready',
  'scored',
  'failed',
  'error',
  'analyzing',
  'pending',
  'partial',
  'missing',
];

function asBadgeStatus(s: string): BadgeStatus {
  return (KNOWN_BADGE_STATUSES as ReadonlyArray<string>).includes(s)
    ? (s as BadgeStatus)
    : 'neutral';
}

export default function ProjectView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, login } = useAuth();

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
      <div className="min-h-screen flex flex-col bg-page">
        <Header backTo="/dashboard" />
        <main className="flex-1 flex items-center justify-center">
          <Loader2 size={32} className="animate-spin text-text-faint" />
        </main>
      </div>
    );
  }

  if (error || !project) {
    const isForbidden = error?.toLowerCase().includes('forbidden');
    return (
      <div className="min-h-screen flex flex-col bg-page">
        <Header backTo="/dashboard" />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <div className="text-danger">
              {isForbidden ? 'This project is private' : error || 'Project not found'}
            </div>
            {isForbidden && !user && (
              <Button variant="secondary" onClick={() => login('github')}>
                Sign in to view
              </Button>
            )}
          </div>
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
  const planPct = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;

  const suggestionsCount = project.suggestions_count ?? 0;
  const missingCount = Object.values(categories).filter((c) => c.status === 'missing').length;

  const tabs: TabItem<Tab>[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'analysis', label: 'Analysis' },
    {
      key: 'suggestions',
      label: 'Suggestions',
      icon: <Lightbulb size={14} />,
      badge:
        suggestionsCount > 0 ? (
          <span className="ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-bg text-amber-fg border border-amber-border font-mono font-bold">
            {suggestionsCount}
          </span>
        ) : undefined,
    },
    { key: 'settings', label: 'Settings' },
  ];

  const envVars: string[] = [];
  if (buildPlan) {
    if (buildPlan.buildCommand) envVars.push(`BUILD_COMMAND=${buildPlan.buildCommand}`);
    if (buildPlan.startCommand) envVars.push(`START_COMMAND=${buildPlan.startCommand}`);
  }

  return (
    <div className="min-h-screen flex flex-col bg-page">
      <Header backTo="/dashboard" title={`${project.owner}/${project.repo}`} />

      <main className="flex-1 max-w-[720px] mx-auto w-full px-6 py-8 flex flex-col gap-6">
        {/* Status row */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Badge status={asBadgeStatus(project.status)}>{project.status}</Badge>

          {score > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-[34px] h-[34px] rounded-full border-2 border-brand bg-brand-tint flex items-center justify-center">
                <span className="text-[10px] font-bold text-brand">{score}%</span>
              </div>
              <span className="text-xs text-text-muted">Readiness</span>
            </div>
          )}

          {project.framework && <Pill>{project.framework}</Pill>}

          {deployed && project.live_url && (
            <a
              href={project.live_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-success-bg text-success border border-success-border hover:opacity-80 transition-opacity"
            >
              <ExternalLink size={12} />
              Live URL
            </a>
          )}
        </div>

        {/* Tabs */}
        <SegmentedTabs<Tab>
          tabs={tabs}
          value={tab}
          onChange={setTab}
          className="self-start"
        />

        {/* ── Overview ── */}
        {tab === 'overview' && (
          <div role="tabpanel" id="tabpanel-overview" className="flex flex-col gap-4">
            {stack && (
              <div className="flex flex-wrap gap-1.5">
                {[stack.framework, stack.styling, stack.database, stack.auth, ...(stack.languages || [])]
                  .filter(Boolean)
                  .map((badge) => (
                    <Pill key={badge!}>{badge}</Pill>
                  ))}
                {buildPlan?.type && (
                  <Pill className="!bg-brand-tint !border-brand-tint-border !text-brand">
                    {buildPlan.type === 'static'
                      ? 'Static site'
                      : buildPlan.type === 'fullstack'
                      ? 'Full-stack'
                      : buildPlan.type}
                  </Pill>
                )}
                {analysis?.meta && (
                  <>
                    {analysis.meta.stars > 0 && (
                      <Pill className="inline-flex items-center gap-1">
                        <Star size={10} /> {analysis.meta.stars}
                      </Pill>
                    )}
                    {analysis.meta.forks > 0 && (
                      <Pill className="inline-flex items-center gap-1">
                        <GitFork size={10} /> {analysis.meta.forks}
                      </Pill>
                    )}
                  </>
                )}
              </div>
            )}

            {project.features_summary && (
              <FeaturesSummary summary={project.features_summary} />
            )}

            {id && <BuildStory projectId={id} />}

            {totalSteps > 0 && (
              <Card padding="md">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-sm text-text inline-flex items-center gap-2">
                    <ClipboardList size={18} className="text-brand" />
                    Plan Progress
                  </h3>
                  <Link
                    to={`/takeoff/${id}/plan`}
                    className="text-xs text-brand hover:text-brand-hov font-medium transition-colors"
                  >
                    View full plan &rarr;
                  </Link>
                </div>
                <div className="flex justify-between text-[13px] mb-2.5">
                  <span className="text-text-muted">
                    {doneSteps} of {totalSteps} steps complete
                  </span>
                  <span className="text-brand font-semibold">{planPct}%</span>
                </div>
                <div
                  className="h-1.5 rounded-full bg-surface-2 border border-line overflow-hidden"
                  role="progressbar"
                  aria-valuenow={planPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full bg-brand transition-all duration-500"
                    style={{ width: `${planPct}%` }}
                  />
                </div>
              </Card>
            )}

            {/* Action grid: Product Map full-width, then Deploy + View Plan 2-col */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Link
                to={`/projects/${id}/map`}
                className="md:col-span-2 group rounded-[14px] p-5 border flex items-center gap-3.5 transition-colors"
                style={{
                  background: 'rgba(244,63,94,0.05)',
                  borderColor: 'rgba(244,63,94,0.15)',
                }}
              >
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{
                    background: 'rgba(244,63,94,0.12)',
                    border: '1px solid rgba(244,63,94,0.2)',
                  }}
                >
                  <Map size={18} className="text-rose" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-text text-sm">Product Map</div>
                  <div className="text-xs text-text-muted mt-0.5">
                    Jobs &amp; personas vs your code &mdash; readiness by what users need.
                  </div>
                </div>
                <span
                  className="text-[11px] font-semibold px-2.5 py-0.5 rounded-md shrink-0"
                  style={{
                    color: '#f43f5e',
                    background: 'rgba(244,63,94,0.08)',
                    border: '1px solid rgba(244,63,94,0.15)',
                  }}
                >
                  New
                </span>
              </Link>

              <button
                type="button"
                onClick={() => {
                  if (!user) {
                    alert('Please log in to deploy.');
                    return;
                  }
                  navigate(`/deploy/${id}`);
                }}
                className="group rounded-[14px] p-5 border bg-brand border-brand-hov text-left flex items-center gap-3.5 transition-colors hover:bg-brand-hov focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
              >
                <Rocket size={22} className="text-white shrink-0 -rotate-45" />
                <div>
                  <div className="font-semibold text-white text-sm">
                    {deployed ? 'Redeploy' : 'Deploy Now'}
                  </div>
                  <div className="text-xs text-white/70 mt-0.5">
                    {deployed ? 'Push a new version.' : 'Ship it to the world.'}
                  </div>
                </div>
              </button>

              <Link
                to={`/takeoff/${id}/plan`}
                className="rounded-[14px] p-5 border border-line bg-surface text-left flex items-center gap-3.5 transition-colors hover:bg-page"
              >
                <ClipboardList size={22} className="text-text-faint shrink-0" />
                <div>
                  <div className="font-semibold text-text text-sm">View Plan</div>
                  <div className="text-xs text-text-muted mt-0.5">
                    See all steps and prompts.
                  </div>
                </div>
              </Link>
            </div>
          </div>
        )}

        {/* ── Analysis ── */}
        {tab === 'analysis' && (
          <div role="tabpanel" id="tabpanel-analysis" className="flex flex-col gap-5">
            {score > 0 && (
              <div className="text-center pb-1">
                <ScoreRing score={score} size={112} stroke={4} className="mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-text mb-2">Production Readiness</h2>
                {project.description && (
                  <p className="text-text-soft text-sm max-w-lg mx-auto italic">
                    {project.description}
                  </p>
                )}
                <p className="text-text-muted text-[13px] max-w-md mx-auto mt-2">
                  {score >= 90
                    ? 'Your app looks ready to deploy. You can ship it now or review the details below.'
                    : `Your app is ${score}% of the way there. We've identified what's missing and built you a plan.`}
                </p>
                <Link
                  to={`/projects/${id}/map`}
                  className="inline-flex items-center gap-2 text-sm font-medium mt-4 rounded-lg px-4 py-2 transition-opacity hover:opacity-80"
                  style={{
                    color: '#f43f5e',
                    background: 'rgba(244,63,94,0.05)',
                    border: '1px solid rgba(244,63,94,0.20)',
                  }}
                >
                  <Map size={16} />
                  Product map &mdash; score by jobs
                </Link>
              </div>
            )}

            {Object.keys(categories).length > 0 && (
              <div className="flex flex-col gap-1.5">
                {Object.entries(categories).map(([key, cat]) => (
                  <div
                    key={key}
                    className="flex items-center gap-3 px-3.5 py-2.5 rounded-[10px] bg-surface border border-line"
                  >
                    {STATUS_ICON[cat.status] || (
                      <AlertCircle size={18} className="text-text-faint shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-text">{cat.label}</div>
                      <div className="text-[11px] text-text-faint truncate">{cat.detail}</div>
                    </div>
                    <span className="text-[11px] text-text-faint shrink-0">
                      {cat.earned}/{cat.weight}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  if (!user) {
                    alert('Please log in to deploy.');
                    return;
                  }
                  navigate(`/takeoff/${id}/env-setup`);
                }}
                className={[
                  'rounded-[14px] p-5 border text-left transition-all',
                  isDeployRecommended
                    ? 'bg-brand border-brand-hov text-white hover:bg-brand-hov'
                    : 'bg-surface border-line hover:border-brand hover:shadow-card-hov',
                ].join(' ')}
              >
                <Rocket
                  size={24}
                  className={[
                    'mb-2.5 -rotate-45',
                    isDeployRecommended ? 'text-white' : 'text-brand',
                  ].join(' ')}
                />
                <h3
                  className={[
                    'font-semibold text-[13px] mb-1',
                    isDeployRecommended ? 'text-white' : 'text-text',
                  ].join(' ')}
                >
                  {isDeployRecommended ? 'Deploy Now' : 'Deploy Anyway'}
                </h3>
                <p
                  className={[
                    'text-[11px]',
                    isDeployRecommended ? 'text-white/70' : 'text-text-muted',
                  ].join(' ')}
                >
                  {isDeployRecommended
                    ? 'Your app looks ready. Ship it to the world.'
                    : 'Ship as-is. You can improve later.'}
                </p>
                {isDeployRecommended && (
                  <span className="inline-block mt-2.5 text-[11px] font-semibold text-amber-bg">
                    Recommended
                  </span>
                )}
              </button>

              <Link
                to={`/takeoff/${id}/plan`}
                className={[
                  'rounded-[14px] p-5 border text-left transition-all block',
                  !isDeployRecommended
                    ? 'bg-brand border-brand-hov text-white hover:bg-brand-hov'
                    : 'bg-surface border-line hover:border-brand hover:shadow-card-hov',
                ].join(' ')}
              >
                <ClipboardList
                  size={24}
                  className={[
                    'mb-2.5',
                    !isDeployRecommended ? 'text-white' : 'text-brand',
                  ].join(' ')}
                />
                <h3
                  className={[
                    'font-semibold text-[13px] mb-1',
                    !isDeployRecommended ? 'text-white' : 'text-text',
                  ].join(' ')}
                >
                  {!isDeployRecommended ? 'Plan to Ship' : 'See Plan Anyway'}
                </h3>
                <p
                  className={[
                    'text-[11px]',
                    !isDeployRecommended ? 'text-white/70' : 'text-text-muted',
                  ].join(' ')}
                >
                  {!isDeployRecommended
                    ? `${missingCount} thing${missingCount === 1 ? '' : 's'} to add. Context files + prompts for each step.`
                    : 'Review what could be improved with context files for each area.'}
                </p>
                {!isDeployRecommended && (
                  <span className="inline-block mt-2.5 text-[11px] font-semibold text-amber-bg">
                    Recommended
                  </span>
                )}
              </Link>
            </div>

            {analysis ? (
              <CodebaseDetails analysis={analysis} gaps={analysis.gaps || {}} />
            ) : (
              <div className="text-center py-12 text-text-muted text-sm">
                Detailed analysis data is not available for this project. Try re-analyzing.
              </div>
            )}
          </div>
        )}

        {/* ── Suggestions (lazy mount, stays mounted) ── */}
        {mountedTabs.current.has('suggestions') && id && (
          <div
            role="tabpanel"
            id="tabpanel-suggestions"
            className={tab !== 'suggestions' ? 'hidden' : ''}
          >
            <SuggestionsPanel projectId={id} projectStatus={project.status} />
          </div>
        )}

        {/* ── Settings (lazy mount, stays mounted) ── */}
        {mountedTabs.current.has('settings') && (
          <div
            role="tabpanel"
            id="tabpanel-settings"
            className={`flex flex-col gap-4 ${tab !== 'settings' ? 'hidden' : ''}`}
          >
            {id && <Analytics projectId={id} />}

            <Card padding="md">
              <h3 className="font-semibold text-sm text-text mb-3.5">Build Configuration</h3>
              {buildPlan ? (
                <div>
                  <Row label="Type" value={buildPlan.type} />
                  <Row label="Framework" value={buildPlan.framework} />
                  <Row label="Confidence" value={buildPlan.confidence} />
                  {buildPlan.buildCommand && (
                    <Row label="Build command" value={buildPlan.buildCommand} mono />
                  )}
                  {buildPlan.startCommand && (
                    <Row label="Start command" value={buildPlan.startCommand} mono last />
                  )}
                </div>
              ) : (
                <p className="text-sm text-text-muted">No build plan detected yet.</p>
              )}
            </Card>

            {envVars.length > 0 && (
              <Card padding="md">
                <h3 className="font-semibold text-sm text-text mb-3">
                  Detected Environment Variables
                </h3>
                <pre className="text-xs text-text-soft bg-page rounded-lg p-4 border border-line overflow-auto font-mono">
                  {envVars.join('\n')}
                </pre>
              </Card>
            )}

            {/* Danger zone — auth-gated */}
            {user && (
              <div className="bg-surface border border-danger-border rounded-[14px] p-5 shadow-card">
                <h3 className="font-semibold text-sm text-danger mb-2">Danger Zone</h3>
                <p className="text-[13px] text-text-muted mb-3.5">
                  Permanently delete this project and all associated data.
                </p>
                {!confirmDelete ? (
                  <Button variant="danger" size="sm" onClick={() => setConfirmDelete(true)}>
                    <Trash2 size={14} />
                    Delete Project
                  </Button>
                ) : (
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      onClick={handleDelete}
                      disabled={deleting}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-danger text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/30"
                    >
                      {deleting ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                      {deleting ? 'Deleting...' : 'Confirm Delete'}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="text-sm text-text-muted hover:text-text transition-colors px-2"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  last,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={[
        'flex items-center justify-between text-[13px] py-1.5',
        last ? '' : 'border-b border-divider',
      ].join(' ')}
    >
      <span className="text-text-muted">{label}</span>
      <span className={['text-text-soft font-medium', mono ? 'font-mono' : ''].join(' ')}>
        {value || '—'}
      </span>
    </div>
  );
}
