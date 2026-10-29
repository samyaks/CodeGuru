import { Link } from 'react-router-dom';
import { BookOpen, Map, Rocket } from 'lucide-react';
import { cx } from '../../components/takeoff/status';
import type { DashboardProject } from '../../services/api';
import styles from './ProjectCard.module.css';

// The dashboard's project card in the Takeoff design system. The older
// components/v2/ProjectCard stays for the v2 style guide.

// Where a project is in the pipeline, in plain words. This is not a
// Cleared / Holding / Grounded status, so it is shown as a neutral chip.
const STATE_LABEL: Record<string, string> = {
  live: 'Live',
  deployed: 'Live',
  ready: 'Ready',
  scored: 'Ready',
  deploying: 'Going live',
  building: 'Building',
  analyzing: 'Analyzing',
  pending: 'Analyzing',
  failed: "Didn't finish",
  error: "Didn't finish",
  missing: 'Missing',
  partial: 'Partial',
};

const CATEGORY_LABEL: Record<string, string> = {
  broken: 'Broken',
  missing: 'Missing',
  infra: 'Infra',
};

function stateLabel(status: string): string {
  return STATE_LABEL[status] ?? status.charAt(0).toUpperCase() + status.slice(1);
}

// Shown above the repo name. Folder uploads are stored with owner "local".
function ownerLabel(project: DashboardProject): string {
  return project.repo_url?.startsWith('local://') ? 'Uploaded folder' : project.owner;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.floor((Date.now() - then) / 1000);
  if (secs < 90) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

function analyzingStatus(status: string): boolean {
  return status === 'analyzing' || status === 'pending';
}

function isFocusableGapId(id: string): boolean {
  return Boolean(id) && !id.startsWith('readiness:') && !id.startsWith('summary:');
}

function gapsHref(projectId: string, gapId?: string): string {
  if (gapId && isFocusableGapId(gapId)) {
    return `/read/${projectId}?focus=${encodeURIComponent(gapId)}#gaps`;
  }
  return `/read/${projectId}#gaps`;
}

function mapHref(projectId: string): string {
  return `/read/${projectId}#map`;
}

function readHref(projectId: string): string {
  return `/read/${projectId}`;
}

export interface ProjectCardProps {
  project: DashboardProject;
}

export function ProjectCard({ project }: ProjectCardProps) {
  const score = project.readiness_score;
  const deployed = project.status === 'live' || project.status === 'deployed';
  const personas = project.personas?.length ? project.personas : (project.persona ? [project.persona] : []);
  const missingItems = project.missing?.items ?? [];
  const missingCount = project.missing?.count ?? missingItems.length;
  const extraMissing = Math.max(0, missingCount - missingItems.length);
  const nextTitle = project.missing?.next?.title || null;
  const analyzedAt = project.updated_at || project.created_at;
  const stillAnalyzing = analyzingStatus(project.status);

  const summary = stillAnalyzing && !project.app_summary
    ? 'Analysis is still running. The persona summary will show up here when it is done.'
    : project.app_summary;

  return (
    <article className={styles.card}>
      <Link to={readHref(project.id)} className={styles.top}>
        <div className={styles.titleRow}>
          <div className={styles.name}>
            <p className={cx('type-small', styles.muted)}>{ownerLabel(project)}</p>
            <h2 className={cx('type-title', styles.repo)}>{project.repo}</h2>
          </div>
          <span className={cx('type-small', styles.chip, styles.state)}>{stateLabel(project.status)}</span>
        </div>

        {personas.length > 0 && (
          <ul className={styles.chips} aria-label="Personas">
            {personas.map((persona) => (
              <li key={persona.id} className={cx('type-small', styles.chip)}>
                {persona.name}
                {persona.readiness != null && <span className={styles.muted}>{persona.readiness}%</span>}
              </li>
            ))}
          </ul>
        )}

        {project.audience && (
          <p className={cx('type-small', styles.muted, styles.clamp2)}>For {project.audience}</p>
        )}

        {summary ? (
          <p className={cx('type-body', styles.clamp3)}>{summary}</p>
        ) : project.error ? (
          <p className={cx('type-body', styles.clamp2)}>{project.error}</p>
        ) : (
          <p className={cx('type-small', styles.muted, styles.empty)}>No app summary yet.</p>
        )}
      </Link>

      <div className={styles.body}>
        <div className={styles.missing}>
          <p className={cx('type-eyebrow', styles.muted)}>What's missing</p>
          {nextTitle && (
            <Link to={gapsHref(project.id)} className={cx('type-body', styles.next)}>
              Next: <span className={styles.nextTitle}>{nextTitle}</span>
            </Link>
          )}
          {missingItems.length > 0 ? (
            <ul className={styles.items}>
              {missingItems.map((item) => (
                <li key={item.id}>
                  <Link to={gapsHref(project.id, item.id)} className={styles.item}>
                    <span className={cx('type-small', styles.chip, styles.category)}>
                      {CATEGORY_LABEL[item.category] ?? item.category}
                    </span>
                    <span className={cx('type-body', styles.itemTitle)}>{item.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className={cx('type-body', styles.links)}>
              <Link to={gapsHref(project.id)} className={styles.link}>
                {stillAnalyzing ? 'Open Gaps' : 'View gaps'}
              </Link>
              <Link to={mapHref(project.id)} className={styles.link}>
                See the map
              </Link>
              <Link to={readHref(project.id)} className={styles.link}>
                Read the app
              </Link>
            </div>
          )}
          {extraMissing > 0 && (
            <Link to={gapsHref(project.id)} className={cx('type-small', styles.link, styles.more)}>
              +{extraMissing} more in Gaps
            </Link>
          )}
        </div>

        <div className={cx('type-small', styles.meta)}>
          <p>
            Last analyzed <span className={styles.ink}>{timeAgo(analyzedAt) || '—'}</span>
          </p>
          {project.last_commit ? (
            <p className={styles.lastChange}>
              <span className={styles.noShrink}>Last change</span>
              <span className={cx(styles.ink, styles.noShrink)}>
                {project.last_commit.date ? timeAgo(project.last_commit.date) : '—'}
              </span>
              {project.last_commit.title && (
                <span className={styles.truncate}>· {project.last_commit.title}</span>
              )}
            </p>
          ) : (
            <p>No changes recorded yet</p>
          )}
        </div>

        <div className={styles.bottom}>
          <div className={styles.facts}>
            {score != null && (
              <span className={styles.score}>
                <span className={cx('type-numeral', styles.scoreNumber)}>{score}</span>
                <span className={cx('type-small', styles.muted)}>Readiness</span>
              </span>
            )}
            {project.framework && (
              <span className={cx('type-small', styles.chip)}>{project.framework}</span>
            )}
            {deployed && project.live_url && (
              <span className={cx('type-small', styles.live)}>
                <Rocket size={14} className={styles.rocket} aria-hidden="true" />
                Live
              </span>
            )}
          </div>
          <Link to={readHref(project.id)} className={cx('type-small', styles.link)}>
            View →
          </Link>
        </div>
      </div>

      <div className={cx('type-small', styles.foot)}>
        <Link to={mapHref(project.id)} className={styles.footLink}>
          <Map size={14} aria-hidden="true" />
          Product map →
        </Link>
        <Link to={gapsHref(project.id)} className={styles.footLink}>
          <BookOpen size={14} aria-hidden="true" />
          Gaps →
        </Link>
      </div>
    </article>
  );
}
