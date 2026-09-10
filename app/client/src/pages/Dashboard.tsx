import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  FolderGit2,
  FileText,
  Loader2,
  ExternalLink,
  Plus,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import Header from '../components/Header';
import {
  fetchProjects,
  fetchAnalyses,
  fetchReviews,
  type DashboardProject,
} from '../services/api';
import { EmptyState, ProjectCard, TabBar } from '../components/v2';

interface Analysis {
  id: string;
  repo_url: string;
  owner: string;
  repo: string;
  status: string;
  completion_pct: number;
  created_at: string;
}

interface Review {
  id: string;
  type: string;
  repo_url: string;
  owner: string;
  repo: string;
  pr_number: number | null;
  status: string;
  created_at: string;
}

type Tab = 'projects' | 'analyses' | 'reviews';

function PrimaryButton({
  to,
  children,
}: {
  to: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 bg-stone-900 text-stone-50 hover:bg-stone-800 transition-colors rounded px-4 py-2 text-sm font-medium"
    >
      {children}
    </Link>
  );
}

function SecondaryButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-700 bg-white border border-stone-300 rounded hover:bg-stone-50 transition-colors"
    >
      {children}
    </button>
  );
}

export default function Dashboard() {
  const [searchParams] = useSearchParams();
  const legacyMode = searchParams.get('legacy') === 'true';

  const [projects, setProjects] = useState<DashboardProject[]>([]);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [analysesError, setAnalysesError] = useState<string | null>(null);
  const [reviewsError, setReviewsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('projects');

  // Force the projects tab whenever legacy mode is off, even if stale state
  // or a URL hint would have selected analyses/reviews.
  const activeTab: Tab = legacyMode ? tab : 'projects';

  const reload = useCallback(async () => {
    setLoading(true);
    setProjectsError(null);
    setAnalysesError(null);
    setReviewsError(null);
    const [pRes, aRes, rRes] = await Promise.allSettled([
      fetchProjects(),
      fetchAnalyses(),
      fetchReviews(),
    ]);
    if (pRes.status === 'fulfilled') setProjects(pRes.value);
    else {
      setProjects([]);
      setProjectsError(pRes.reason instanceof Error ? pRes.reason.message : 'Failed to load projects.');
    }
    if (aRes.status === 'fulfilled') setAnalyses(aRes.value);
    else {
      setAnalyses([]);
      setAnalysesError(aRes.reason instanceof Error ? aRes.reason.message : 'Failed to load analyses.');
    }
    if (rRes.status === 'fulfilled') setReviews(rRes.value);
    else {
      setReviews([]);
      setReviewsError(rRes.reason instanceof Error ? rRes.reason.message : 'Failed to load reviews.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const tabs = legacyMode
    ? [
        { id: 'projects', label: 'Projects' },
        { id: 'analyses', label: 'Analyses' },
        { id: 'reviews', label: 'Reviews' },
      ]
    : [];

  const retryButton = (
    <SecondaryButton onClick={() => void reload()}>
      <RefreshCw className="w-3 h-3" />
      Retry
    </SecondaryButton>
  );

  return (
    <div className="min-h-screen bg-stone-50 v2-font-sans">
      <Header variant="workspace" title="Dashboard" />

      <main className="max-w-6xl mx-auto px-6 py-12">
        <div className="mb-8 flex items-end justify-between flex-wrap gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-stone-500 mb-2">Your work</p>
            <h2 className="text-4xl font-bold text-stone-900 tracking-tight v2-font-serif">
              Dashboard
            </h2>
            <p className="text-stone-600 text-sm mt-2">
              {projects.length === 0
                ? 'No projects yet.'
                : `${projects.length} project${projects.length === 1 ? '' : 's'} connected.`}
            </p>
          </div>
          <PrimaryButton to="/">
            <Plus className="w-4 h-4" />
            Analyze new app
          </PrimaryButton>
        </div>

        {legacyMode && tabs.length > 0 ? (
          <TabBar
            tabs={tabs}
            activeId={activeTab}
            onChange={(id) => setTab(id as Tab)}
            className="mb-8"
          />
        ) : null}

        {loading && (
          <div className="flex justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-stone-400" />
          </div>
        )}

        {/* Projects */}
        {!loading && activeTab === 'projects' && projectsError && (
          <EmptyState
            icon={AlertCircle}
            title="Couldn't load projects"
            description={`${projectsError} Check your connection and try again.`}
            action={retryButton}
          />
        )}

        {!loading && activeTab === 'projects' && !projectsError && projects.length === 0 && (
          <EmptyState
            icon={FolderGit2}
            title="No projects yet"
            description="Analyze your first app to get started."
            action={
              <PrimaryButton to="/">
                <Plus className="w-4 h-4" />
                Analyze a repo
              </PrimaryButton>
            }
          />
        )}

        {!loading && activeTab === 'projects' && !projectsError && projects.length > 0 && (
          <div className="grid md:grid-cols-2 gap-5">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        )}

        {/* Analyses (legacy only) */}
        {!loading && legacyMode && activeTab === 'analyses' && analysesError && (
          <EmptyState
            icon={AlertCircle}
            title="Couldn't load analyses"
            description={`${analysesError} Check your connection and try again.`}
            action={retryButton}
          />
        )}

        {!loading && legacyMode && activeTab === 'analyses' && !analysesError && analyses.length === 0 && (
          <EmptyState
            icon={FolderGit2}
            title="No analyses yet"
            description="Run an analysis on a GitHub repo to see it here."
          />
        )}

        {!loading && legacyMode && activeTab === 'analyses' && !analysesError && analyses.length > 0 && (
          <div className="flex flex-col gap-2.5">
            {analyses.map((a) => (
              <Link
                key={a.id}
                to={a.status === 'completed' ? `/results/${a.id}` : `/analyze/${a.id}`}
                className="block bg-white border border-stone-200 rounded-lg px-5 py-4 transition-all hover:border-stone-400 hover:shadow-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-stone-900 truncate">
                      {a.owner}/{a.repo}
                    </p>
                    <p className="text-xs text-stone-500 mt-1">
                      {new Date(a.created_at).toLocaleDateString()} · {a.status}
                    </p>
                  </div>
                  {a.completion_pct != null && (
                    <span className="text-sm font-semibold text-stone-900 shrink-0">
                      {a.completion_pct}%
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Reviews (legacy only) */}
        {!loading && legacyMode && activeTab === 'reviews' && reviewsError && (
          <EmptyState
            icon={AlertCircle}
            title="Couldn't load reviews"
            description={`${reviewsError} Check your connection and try again.`}
            action={retryButton}
          />
        )}

        {!loading && legacyMode && activeTab === 'reviews' && !reviewsError && reviews.length === 0 && (
          <EmptyState
            icon={FileText}
            title="No reviews yet"
            description="Create a code review to see it here."
          />
        )}

        {!loading && legacyMode && activeTab === 'reviews' && !reviewsError && reviews.length > 0 && (
          <div className="flex flex-col gap-2.5">
            {reviews.map((r) => (
              <Link
                key={r.id}
                to={r.status === 'completed' ? `/review/${r.id}` : `/review/${r.id}/progress`}
                className="block bg-white border border-stone-200 rounded-lg px-5 py-4 transition-all hover:border-stone-400 hover:shadow-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-stone-900 truncate">
                      {r.owner}/{r.repo}
                      {r.pr_number && <span className="text-stone-500"> #{r.pr_number}</span>}
                    </p>
                    <p className="text-xs text-stone-500 mt-1">
                      {r.type} review · {new Date(r.created_at).toLocaleDateString()} · {r.status}
                    </p>
                  </div>
                  <ExternalLink className="w-4 h-4 text-stone-400 shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
