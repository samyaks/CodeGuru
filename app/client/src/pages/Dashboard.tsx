import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { FolderGit2, Plus, AlertCircle, type LucideProps } from 'lucide-react';
import Header from '../components/Header';
import { Button, ButtonLink } from '../components/takeoff';
import { cx } from '../components/takeoff/status';
import { fetchProjects, type DashboardProject } from '../services/api';
import { ProjectCard } from './dashboard/ProjectCard';
import styles from './Dashboard.module.css';

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
  onRetry: () => void;
  projects: DashboardProject[];
  projectsError: string | null;
}

// Everything the dashboard shows, with no data loading, so /design/dashboard
// can render it with sample projects in development.
export function DashboardView({
  loading,
  onRetry,
  projects,
  projectsError,
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

        {loading && (
          <p className={cx('type-body', styles.muted, styles.loading)} role="status">
            Loading your projects…
          </p>
        )}

        {!loading && projectsError && (
          <Notice
            icon={AlertCircle}
            title="Couldn't load projects"
            description={`${projectsError} Check your connection and try again.`}
            action={retryButton}
          />
        )}

        {!loading && !projectsError && projects.length === 0 && (
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

        {!loading && !projectsError && projects.length > 0 && (
          <div className={styles.grid}>
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default function Dashboard() {
  const [projects, setProjects] = useState<DashboardProject[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    setProjectsError(null);
    try {
      setProjects(await fetchProjects());
    } catch (err) {
      setProjects([]);
      setProjectsError(err instanceof Error ? err.message : 'Failed to load projects.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <DashboardView
      loading={loading}
      onRetry={() => void reload()}
      projects={projects}
      projectsError={projectsError}
    />
  );
}
