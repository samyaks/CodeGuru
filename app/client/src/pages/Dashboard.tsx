import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  FolderGit2,
  FileText,
  ExternalLink,
  Plus,
  AlertCircle,
  type LucideProps,
} from 'lucide-react';
import Header from '../components/Header';
import { Button, ButtonLink } from '../components/takeoff';
import { cx } from '../components/takeoff/status';
import {
  fetchProjects,
  fetchAnalyses,
  fetchReviews,
  type DashboardProject,
} from '../services/api';
import { ProjectCard } from './dashboard/ProjectCard';
import styles from './Dashboard.module.css';

export interface Analysis {
  id: string;
  repo_url: string;
  owner: string;
  repo: string;
  status: string;
  completion_pct: number;
  created_at: string;
}

export interface Review {
  id: string;
  type: string;
  repo_url: string;
  owner: string;
  repo: string;
  pr_number: number | null;
  status: string;
  created_at: string;
}

export type DashboardTab = 'projects' | 'analyses' | 'reviews';

const LEGACY_TABS: { id: DashboardTab; label: string }[] = [
  { id: 'projects', label: 'Projects' },
  { id: 'analyses', label: 'Analyses' },
  { id: 'reviews', label: 'Reviews' },
];

function Notice({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: ComponentType<LucideProps>;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.notice}>
      {Icon ? <Icon size={24} className={styles.muted} aria-hidden="true" /> : null}
      <h2 className="type-heading">{title}</h2>
      {description ? <p className={cx('type-body', styles.muted)}>{description}</p> : null}
      {action ? <div className={styles.noticeAction}>{action}</div> : null}
    </div>
  );
}

export interface DashboardViewProps {
  loading: boolean;
  legacyMode: boolean;
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  onRetry: () => void;
  projects: DashboardProject[];
  analyses: Analysis[];
  reviews: Review[];
  projectsError: string | null;
  analysesError: string | null;
  reviewsError: string | null;
}

// Everything the dashboard shows, with no data loading, so /design/dashboard
// can render it with sample projects in development.
export function DashboardView({
  loading,
  legacyMode,
  activeTab,
  onTabChange,
  onRetry,
  projects,
  analyses,
  reviews,
  projectsError,
  analysesError,
  reviewsError,
}: DashboardViewProps) {
  const retryButton = (
    <Button variant="quiet" size="sm" onClick={onRetry}>
      Try again
    </Button>
  );

  return (
    <div className={cx('takeoff', styles.page)}>
      <Header variant="takeoff" />

      <main className={styles.main}>
        <div className={styles.head}>
          <div className={styles.titles}>
            <p className={cx('type-eyebrow', styles.muted)}>Your work</p>
            <h1 className="type-display">Dashboard</h1>
            <p className={cx('type-body', styles.muted)}>
              {projects.length === 0
                ? 'No projects yet.'
                : `${projects.length} project${projects.length === 1 ? '' : 's'} connected.`}
            </p>
          </div>
          <ButtonLink variant="primary" to="/">
            <Plus size={16} aria-hidden="true" />
            Analyze new app
          </ButtonLink>
        </div>

        {legacyMode && (
          <div className={styles.tabs} role="tablist" aria-label="Show">
            {LEGACY_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                className={cx('type-button', styles.tab)}
                onClick={() => onTabChange(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

        {loading && (
          <p className={cx('type-body', styles.muted, styles.loading)} role="status">
            Loading your projects…
          </p>
        )}

        {/* Projects */}
        {!loading && activeTab === 'projects' && projectsError && (
          <Notice
            icon={AlertCircle}
            title="Couldn't load projects"
            description={`${projectsError} Check your connection and try again.`}
            action={retryButton}
          />
        )}

        {!loading && activeTab === 'projects' && !projectsError && projects.length === 0 && (
          <Notice
            icon={FolderGit2}
            title="No projects yet"
            description="Analyze your first app to get started."
            action={
              <ButtonLink variant="quiet" size="sm" to="/">
                Analyze a repo
              </ButtonLink>
            }
          />
        )}

        {!loading && activeTab === 'projects' && !projectsError && projects.length > 0 && (
          <div className={styles.grid}>
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        )}

        {/* Analyses (legacy only) */}
        {!loading && legacyMode && activeTab === 'analyses' && analysesError && (
          <Notice
            icon={AlertCircle}
            title="Couldn't load analyses"
            description={`${analysesError} Check your connection and try again.`}
            action={retryButton}
          />
        )}

        {!loading && legacyMode && activeTab === 'analyses' && !analysesError && analyses.length === 0 && (
          <Notice
            icon={FolderGit2}
            title="No analyses yet"
            description="Run an analysis on a GitHub repo to see it here."
          />
        )}

        {!loading && legacyMode && activeTab === 'analyses' && !analysesError && analyses.length > 0 && (
          <div className={styles.rows}>
            {analyses.map((a) => (
              <Link
                key={a.id}
                to={a.status === 'completed' ? `/results/${a.id}` : `/analyze/${a.id}`}
                className={styles.row}
              >
                <div className={styles.rowText}>
                  <p className={cx('type-body', styles.rowTitle)}>
                    {a.owner}/{a.repo}
                  </p>
                  <p className={cx('type-small', styles.muted)}>
                    {new Date(a.created_at).toLocaleDateString()} · {a.status}
                  </p>
                </div>
                {a.completion_pct != null && (
                  <span className={cx('type-body', styles.rowValue)}>{a.completion_pct}%</span>
                )}
              </Link>
            ))}
          </div>
        )}

        {/* Reviews (legacy only) */}
        {!loading && legacyMode && activeTab === 'reviews' && reviewsError && (
          <Notice
            icon={AlertCircle}
            title="Couldn't load reviews"
            description={`${reviewsError} Check your connection and try again.`}
            action={retryButton}
          />
        )}

        {!loading && legacyMode && activeTab === 'reviews' && !reviewsError && reviews.length === 0 && (
          <Notice
            icon={FileText}
            title="No reviews yet"
            description="Create a code review to see it here."
          />
        )}

        {!loading && legacyMode && activeTab === 'reviews' && !reviewsError && reviews.length > 0 && (
          <div className={styles.rows}>
            {reviews.map((r) => (
              <Link
                key={r.id}
                to={r.status === 'completed' ? `/review/${r.id}` : `/review/${r.id}/progress`}
                className={styles.row}
              >
                <div className={styles.rowText}>
                  <p className={cx('type-body', styles.rowTitle)}>
                    {r.owner}/{r.repo}
                    {r.pr_number && <span className={styles.muted}> #{r.pr_number}</span>}
                  </p>
                  <p className={cx('type-small', styles.muted)}>
                    {r.type} review · {new Date(r.created_at).toLocaleDateString()} · {r.status}
                  </p>
                </div>
                <ExternalLink size={16} className={styles.muted} aria-hidden="true" />
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
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
  const [tab, setTab] = useState<DashboardTab>('projects');

  // Force the projects tab whenever legacy mode is off, even if stale state
  // or a URL hint would have selected analyses/reviews.
  const activeTab: DashboardTab = legacyMode ? tab : 'projects';

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

  return (
    <DashboardView
      loading={loading}
      legacyMode={legacyMode}
      activeTab={activeTab}
      onTabChange={setTab}
      onRetry={() => void reload()}
      projects={projects}
      analyses={analyses}
      reviews={reviews}
      projectsError={projectsError}
      analysesError={analysesError}
      reviewsError={reviewsError}
    />
  );
}
