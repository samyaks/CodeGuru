import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  FolderGit2,
  FileText,
  Loader2,
  ExternalLink,
  Rocket,
  Plus,
  Lightbulb,
  Map,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import Header from '../components/Header';
import {
  fetchProjects,
  fetchAnalyses,
  fetchReviews,
  type Project,
} from '../services/api';
import { Badge, Button, Card, Pill, SegmentedTabs } from '../components/ui';
import type { BadgeStatus, TabItem } from '../components/ui';
import { EmptyState } from '../components/v2/EmptyState';

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

export default function Dashboard() {
  const [searchParams] = useSearchParams();
  const legacyMode = searchParams.get('legacy') === 'true';

  const [projects, setProjects] = useState<Project[]>([]);
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

  const tabs: TabItem<Tab>[] = legacyMode
    ? [
        { key: 'projects', label: 'Projects' },
        { key: 'analyses', label: 'Analyses' },
        { key: 'reviews', label: 'Reviews' },
      ]
    : [{ key: 'projects', label: 'Projects' }];

  const retryButton = (
    <Button size="sm" variant="secondary" onClick={() => void reload()}>
      <RefreshCw size={14} />
      Retry
    </Button>
  );

  return (
    <div className="min-h-screen flex flex-col bg-page">
      <Header backTo="/" title="Dashboard" />

      <main className="flex-1 max-w-[960px] mx-auto w-full px-6 py-8">
        <div className="flex items-center justify-between mb-7 gap-3 flex-wrap">
          {legacyMode ? (
            <SegmentedTabs<Tab> tabs={tabs} value={activeTab} onChange={setTab} />
          ) : (
            <div />
          )}
          <Link to="/">
            <Button size="sm" className="!h-9 !px-4">
              <Plus size={16} />
              Analyze New App
            </Button>
          </Link>
        </div>

        {loading && (
          <div className="flex justify-center py-24">
            <Loader2 size={32} className="animate-spin text-text-faint" />
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
              <Link to="/">
                <Button size="sm">
                  <Plus size={16} />
                  Analyze a repo
                </Button>
              </Link>
            }
          />
        )}

        {!loading && activeTab === 'projects' && !projectsError && projects.length > 0 && (
          <div className="grid md:grid-cols-2 gap-3.5">
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
          <div className="flex flex-col gap-2">
            {analyses.map((a) => (
              <Link
                key={a.id}
                to={a.status === 'completed' ? `/results/${a.id}` : `/analyze/${a.id}`}
                className="block bg-surface border border-line rounded-xl px-[18px] py-3.5 transition-all hover:border-brand hover:shadow-card-hov"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text truncate">
                      {a.owner}/{a.repo}
                    </p>
                    <p className="text-[11px] text-text-faint mt-0.5">
                      {new Date(a.created_at).toLocaleDateString()} · {a.status}
                    </p>
                  </div>
                  {a.completion_pct != null && (
                    <span className="text-sm font-semibold text-brand shrink-0">
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
          <div className="flex flex-col gap-2">
            {reviews.map((r) => (
              <Link
                key={r.id}
                to={r.status === 'completed' ? `/review/${r.id}` : `/review/${r.id}/progress`}
                className="block bg-surface border border-line rounded-xl px-[18px] py-3.5 transition-all hover:border-brand hover:shadow-card-hov"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text truncate">
                      {r.owner}/{r.repo}
                      {r.pr_number && <span className="text-text-muted"> #{r.pr_number}</span>}
                    </p>
                    <p className="text-[11px] text-text-faint mt-0.5">
                      {r.type} review · {new Date(r.created_at).toLocaleDateString()} · {r.status}
                    </p>
                  </div>
                  <ExternalLink size={16} className="text-text-faint shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const score = project.readiness_score;
  const deployed = project.status === 'live' || project.status === 'deployed';
  const displayDate = project.updated_at || project.created_at;

  return (
    <Card padding="none" className="group overflow-hidden">
      <Link
        to={`/projects/${project.id}`}
        className="block px-5 pt-[18px] pb-3.5 transition-colors hover:bg-page/50"
      >
        <div className="flex items-start justify-between gap-2 mb-3">
          <p className="font-semibold text-text truncate group-hover:text-brand transition-colors">
            {project.owner}/{project.repo}
          </p>
          <Badge status={asBadgeStatus(project.status)}>{project.status}</Badge>
        </div>

        <div className="flex items-center gap-3 mb-3 flex-wrap">
          {score != null && (
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full border-2 border-brand bg-brand-tint flex items-center justify-center">
                <span className="text-[11px] font-bold text-brand">{score}%</span>
              </div>
              <span className="text-xs text-text-muted">Readiness</span>
            </div>
          )}
          {project.framework && <Pill>{project.framework}</Pill>}
          {project.suggestions_count != null && project.suggestions_count > 0 && (
            <Badge status="medium">
              <Lightbulb size={10} />
              {project.suggestions_count}
            </Badge>
          )}
        </div>

        <div className="flex items-center justify-between text-xs">
          {deployed && project.live_url ? (
            <span className="flex items-center gap-1 text-success font-medium">
              <Rocket size={12} className="-rotate-45" />
              Live
            </span>
          ) : (
            <span className="text-text-faint">
              {displayDate ? new Date(displayDate).toLocaleDateString() : ''}
            </span>
          )}
          <span className="text-text-faint group-hover:text-brand-hov transition-colors">
            View &rarr;
          </span>
        </div>
      </Link>
      <div className="px-5 py-2 border-t border-divider">
        <Link
          to={`/projects/${project.id}#map`}
          className="inline-flex items-center gap-1 text-xs font-medium text-rose hover:opacity-80 transition-opacity"
        >
          <Map size={11} />
          Product map &rarr;
        </Link>
      </div>
    </Card>
  );
}

