import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertOctagon, FileText, GitCommit, RefreshCw, Settings, Shield, Users,
} from 'lucide-react';
import { fetchProjectDetail, type ProjectWithEntries } from '../../services/api';
import { fetchSecuritySummary, type SecuritySummary } from '../../services/v2Api';
import {
  TabBar, EmptyState, ReanalyzeModal,
} from '../../components/v2';
import Header from '../../components/Header';
import GapsSection from './GapsSection';
import ShippedSection from './ShippedSection';
import MapSection from './MapSection';
import ContextSection from './ContextSection';
import SettingsSection from './SettingsSection';

const TABS = ['gaps', 'map', 'context', 'shipped', 'settings'] as const;
type TabId = (typeof TABS)[number];

const TAB_DEFS: Array<{ id: TabId; label: string; icon: typeof AlertOctagon }> = [
  { id: 'gaps', label: 'Gaps', icon: AlertOctagon },
  { id: 'map', label: 'Map', icon: Users },
  { id: 'context', label: 'Context', icon: FileText },
  { id: 'shipped', label: 'Shipped', icon: GitCommit },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const PLACEHOLDERS: Record<TabId, { icon: typeof AlertOctagon; title: string }> = {
  gaps: { icon: AlertOctagon, title: 'Gaps will appear here in Phase 3' },
  map: { icon: Users, title: 'Personas and jobs will appear here in Phase 5' },
  context: { icon: FileText, title: 'Project context will appear here in Phase 5' },
  shipped: { icon: GitCommit, title: 'Shipped commits will appear here in Phase 4' },
  settings: { icon: Settings, title: 'Settings will appear here.' },
};

function readHashTab(): TabId {
  if (typeof window === 'undefined') return 'gaps';
  const raw = window.location.hash.replace(/^#/, '').toLowerCase();
  return (TABS as readonly string[]).includes(raw) ? (raw as TabId) : 'gaps';
}

export default function ProjectV2() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<ProjectWithEntries | null>(null);
  // Best-effort fetch — failures don't block the page. The cached
  // `project.security_score` is the fallback for the header score; the
  // tab-badge sub-indicator just stays hidden if we couldn't load.
  const [securitySummary, setSecuritySummary] = useState<SecuritySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>(readHashTab);
  const [reanalyzeModalOpen, setReanalyzeModalOpen] = useState(false);

  const handleReanalyzeTriggered = useCallback((projectId: string) => {
    setReanalyzeModalOpen(false);
    navigate(`/takeoff/${projectId}`);
  }, [navigate]);

  // `reload` is the user-triggered Retry path on the load-error view.
  // We only block on the main project fetch for the error UI; the
  // product-map + security summary are best-effort and their failures
  // never surface as the page error.
  const reload = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const p = await fetchProjectDetail(id);
      setProject(p);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to load project');
    } finally {
      setLoading(false);
    }
    fetchSecuritySummary(id).then(setSecuritySummary).catch(() => { /* best-effort */ });
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchProjectDetail(id)
      .then((p) => { if (!cancelled) setProject(p); })
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    fetchSecuritySummary(id)
      .then((s) => { if (!cancelled) setSecuritySummary(s); })
      .catch(() => { /* security summary is best-effort — header falls
                        back to the cached score on the project row. */ });

    return () => { cancelled = true; };
  }, [id]);

  useEffect(() => {
    function onHashChange() { setActiveTab(readHashTab()); }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (!loading && project && (project.status === 'analyzing' || project.status === 'pending')) {
      navigate(`/takeoff/${id}`, { replace: true });
    }
  }, [loading, project, id, navigate]);

  const setTab = useCallback((next: string) => {
    if ((TABS as readonly string[]).includes(next)) {
      window.location.hash = next;
      setActiveTab(next as TabId);
    }
  }, []);

  const readiness = project?.readiness_score ?? null;
  // Header score: prefer the live recompute (catches any post-analysis
  // triage), fall back to the cached column on the project row, else
  // null (= hide the security block, e.g. for projects analyzed before
  // migration 014).
  const securityScore = securitySummary?.score
    ?? (typeof project?.security_score === 'number' ? project.security_score : null);
  const securityActiveCount = securitySummary?.totalUnaddressed ?? 0;
  const securityScoreLow = typeof securityScore === 'number' && securityScore < 60;

  // Tab descriptors are recomputed when the security count changes so
  // the Gaps badge updates as soon as the summary lands. The badge
  // doubles as the "🛡️ s" sub-indicator from the spec — same surface,
  // just a single red pill instead of two stacked tokens.
  const tabsWithBadges = useMemo(() => TAB_DEFS.map((tab) => (
    tab.id === 'gaps' && securityActiveCount > 0
      ? { ...tab, badge: securityActiveCount, badgeColor: 'red' as const }
      : tab
  )), [securityActiveCount]);

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 v2-font-sans flex items-center justify-center">
        <div className="text-stone-500 text-sm">Loading project…</div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="min-h-screen bg-stone-50 v2-font-sans flex items-center justify-center px-6">
        <EmptyState
          icon={AlertOctagon}
          title="Couldn't load this project"
          description={error ?? 'Project not found.'}
          action={
            <button
              type="button"
              onClick={() => void reload()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-700 bg-white border border-stone-300 rounded hover:bg-stone-50 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
            </button>
          }
        />
      </div>
    );
  }

  const placeholder = PLACEHOLDERS[activeTab];
  const showRealGaps = activeTab === 'gaps' && !!id;
  const showRealShipped = activeTab === 'shipped' && !!id;
  const showRealMap = activeTab === 'map' && !!id;
  const showRealContext = activeTab === 'context' && !!id;
  const showRealSettings = activeTab === 'settings' && !!id;

  // Local uploads (`local://…`) can't be re-analyzed because we don't
  // persist the original files. Hide the workspace-header affordance
  // rather than show a button that always 400s. The same gate is
  // applied on SecurityReport + ContextSection.
  const isLocalProject = typeof project.repo_url === 'string' && project.repo_url.startsWith('local://');

  return (
    <div className="min-h-screen bg-stone-50 v2-font-sans">
      <Header
        variant="workspace"
        title={project.repo}
        actions={
          <>
            {!isLocalProject ? (
              <button
                type="button"
                onClick={() => setReanalyzeModalOpen(true)}
                className="text-xs text-stone-700 bg-white hover:bg-stone-50 border border-stone-300 px-3 py-1.5 rounded inline-flex items-center gap-1.5 transition-colors"
                title="Re-run analysis on the latest commit"
              >
                <RefreshCw className="w-3 h-3" aria-hidden />
                Re-analyze
              </button>
            ) : null}
            <Link
              to="/"
              className="text-sm text-stone-600 hover:text-stone-900 transition-colors px-2"
            >
              + New project
            </Link>
          </>
        }
      />

      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="mb-8">
          <p className="text-xs uppercase tracking-widest text-stone-500 mb-2">Your project</p>
          <div className="flex items-baseline justify-between flex-wrap gap-4 mb-3">
            <h2 className="text-4xl font-bold text-stone-900 tracking-tight v2-font-serif">
              {project.repo || project.repo_url}
            </h2>
            <div className="flex items-center gap-6 text-sm">
              <Link
                to={`/read/${id}`}
                className="text-xs text-stone-500 hover:text-stone-900 underline underline-offset-2"
              >
                The read →
              </Link>
              {readiness !== null ? (
                <div className="flex items-center gap-3">
                  <span className="text-stone-500">Readiness</span>
                  <span className="text-2xl font-bold text-stone-900">{readiness}</span>
                  <span className="text-stone-400">/ 100</span>
                </div>
              ) : null}
              {securityScore !== null ? (
                <div
                  className="flex items-center gap-3"
                  title="Computed from active security gaps weighted by severity."
                >
                  <span className="text-stone-500 inline-flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5" aria-hidden />
                    Security
                  </span>
                  <span className="text-2xl font-bold text-stone-900 inline-flex items-center gap-1.5">
                    {securityScore}
                    {securityScoreLow ? (
                      <span
                        className="w-2 h-2 rounded-full bg-red-500"
                        aria-label="Low security score — review urgently"
                        title="Low security score — review urgently"
                      />
                    ) : null}
                  </span>
                  <span className="text-stone-400">/ 100</span>
                  <Link
                    to={`/v2/projects/${id}/security`}
                    className="text-xs text-stone-500 hover:text-stone-900 underline underline-offset-2 ml-1"
                  >
                    Open report →
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
          <p className="text-stone-600 text-sm">
            {project.description ?? project.framework ?? 'Project'}
          </p>
        </div>

        <TabBar
          tabs={tabsWithBadges}
          activeId={activeTab}
          onChange={setTab}
          className="mb-8"
        />

        {showRealGaps ? (
          <GapsSection projectId={id!} />
        ) : showRealShipped ? (
          <ShippedSection projectId={id!} />
        ) : showRealMap ? (
          <MapSection projectId={id!} />
        ) : showRealContext ? (
          <ContextSection projectId={id!} />
        ) : showRealSettings ? (
          <SettingsSection projectId={id!} />
        ) : (
          <EmptyState icon={placeholder.icon} title={placeholder.title} />
        )}
      </main>

      {!isLocalProject && id ? (
        <ReanalyzeModal
          open={reanalyzeModalOpen}
          onClose={() => setReanalyzeModalOpen(false)}
          projectId={id}
          projectLabel={project.repo ? `${project.owner}/${project.repo}` : project.repo_url || id}
          onTriggered={handleReanalyzeTriggered}
        />
      ) : null}
    </div>
  );
}
