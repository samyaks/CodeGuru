import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Rocket,
  ClipboardList,
  ExternalLink,
  Loader2,
  Trash2,
} from 'lucide-react';
import Header from '../components/Header';
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

type Tab = 'overview' | 'story' | 'analytics' | 'settings';

const STATUS_ICON = {
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
  const { user } = useAuth();
  const [project, setProject] = useState<ProjectWithEntries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [commitCount, setCommitCount] = useState(0);
  const [entryCount, setEntryCount] = useState(0);

  useEffect(() => {
    if (!id) return;
    fetchProjectDetail(id)
      .then(setProject)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

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

  const statusClass = STATUS_COLORS[project.status] || 'bg-sky-muted/10 text-sky-muted border-sky-border';

  const storyCounts = commitCount > 0 || entryCount > 0
    ? ` ${commitCount} commit${commitCount !== 1 ? 's' : ''} + ${entryCount} entr${entryCount !== 1 ? 'ies' : 'y'}`
    : '';

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'story', label: `Build Story${storyCounts}` },
    { key: 'analytics', label: 'Analytics' },
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
        <div className="flex gap-1 bg-navy rounded-lg p-1 w-fit border border-sky-border/50">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'bg-gold/10 text-gold border border-gold/20'
                  : 'text-sky-muted hover:text-sky-white border border-transparent'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {tab === 'overview' && (
          <div className="space-y-8">
            {/* Score circle */}
            {score > 0 && (
              <div className="text-center space-y-3">
                <div className="inline-flex items-center justify-center w-24 h-24 rounded-full border-4 border-gold/30 bg-navy">
                  <span className="text-3xl font-bold text-sky-white">{score}%</span>
                </div>
                <p className="text-sky-muted text-sm">Production Readiness Score</p>
              </div>
            )}

            {/* Stack badges */}
            {stack && (
              <div className="flex flex-wrap justify-center gap-2">
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

            {/* Plan steps summary */}
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

        {/* Build Story Tab */}
        {tab === 'story' && id && (
          <BuildStory
            projectId={id}
            onCounts={(c, e) => { setCommitCount(c); setEntryCount(e); }}
          />
        )}

        {/* Analytics Tab */}
        {tab === 'analytics' && id && (
          <Analytics projectId={id} />
        )}

        {/* Settings Tab */}
        {tab === 'settings' && (
          <div className="space-y-8">
            {/* Detected environment */}
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
