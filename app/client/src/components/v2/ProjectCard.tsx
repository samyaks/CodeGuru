import { Link } from 'react-router-dom';
import {
  BookOpen,
  GitCommit,
  Map,
  Rocket,
} from 'lucide-react';
import { Badge } from './Badge';
import type { BadgeVariant } from './Badge';
import type { DashboardMissingItem, DashboardProject } from '../../services/api';

export interface ProjectCardProps {
  project: DashboardProject;
}

const STATUS_PILL: Record<string, string> = {
  live: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  deployed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ready: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  scored: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  deploying: 'bg-amber-50 text-amber-700 border-amber-200',
  building: 'bg-amber-50 text-amber-700 border-amber-200',
  analyzing: 'bg-amber-50 text-amber-700 border-amber-200',
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  error: 'bg-red-50 text-red-700 border-red-200',
  missing: 'bg-red-50 text-red-700 border-red-200',
  partial: 'bg-stone-100 text-stone-700 border-stone-300',
};

function statusPillClass(status: string): string {
  return STATUS_PILL[status] ?? 'bg-stone-100 text-stone-700 border-stone-300';
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

function gapBadgeVariant(category: DashboardMissingItem['category']): BadgeVariant {
  if (category === 'broken') return 'broken';
  if (category === 'infra') return 'infra';
  return 'missing';
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
    <article className="group bg-white border border-stone-200 rounded-lg overflow-hidden transition-all hover:border-stone-400 hover:shadow-sm flex flex-col">
      <Link to={`/read/${project.id}`} className="block px-5 pt-5 pb-4 flex-1">
        <div className="flex items-start justify-between gap-2 mb-3">
          <p className="font-semibold text-stone-900 truncate">
            {project.owner}/{project.repo}
          </p>
          <span
            className={`text-xs px-2 py-0.5 rounded-full border font-medium capitalize shrink-0 ${statusPillClass(project.status)}`}
          >
            {project.status}
          </span>
        </div>

        {personas.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            {personas.map((persona) => (
              <span
                key={persona.id}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-700 border border-stone-200"
              >
                <span aria-hidden>{persona.emoji || '👤'}</span>
                {persona.name}
                {persona.readiness != null && (
                  <span className="text-stone-400">{persona.readiness}%</span>
                )}
              </span>
            ))}
          </div>
        )}

        {project.audience && (
          <p className="text-xs text-stone-500 mb-2 line-clamp-2">
            For {project.audience}
          </p>
        )}

        {summary ? (
          <p className="text-sm text-stone-700 leading-relaxed line-clamp-3">
            {summary}
          </p>
        ) : project.error ? (
          <p className="text-sm text-red-700 leading-relaxed line-clamp-2">
            {project.error}
          </p>
        ) : (
          <p className="text-sm text-stone-400 italic">
            No app summary yet.
          </p>
        )}
      </Link>

      <div className="px-5 pb-4">
        <div className="mb-4">
          <p className="text-[11px] uppercase tracking-widest text-stone-500 mb-2">
            What's missing
          </p>
          {nextTitle && (
            <Link
              to={gapsHref(project.id)}
              className="block text-sm text-stone-800 mb-2 hover:text-stone-900"
            >
              Next: <span className="font-medium underline-offset-2 hover:underline">{nextTitle}</span>
            </Link>
          )}
          {missingItems.length > 0 ? (
            <ul className="space-y-1.5">
              {missingItems.map((item) => (
                <li key={item.id}>
                  <Link
                    to={gapsHref(project.id, item.id)}
                    className="flex items-start gap-2 min-w-0 group/missing"
                  >
                    <Badge variant={gapBadgeVariant(item.category)} className="shrink-0 capitalize">
                      {item.category}
                    </Badge>
                    <span className="text-sm text-stone-700 truncate group-hover/missing:text-stone-900 group-hover/missing:underline underline-offset-2">
                      {item.title}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
              <Link
                to={gapsHref(project.id)}
                className="font-medium text-stone-700 hover:text-stone-900 underline underline-offset-2"
              >
                {stillAnalyzing ? 'Open Gaps' : 'View gaps'}
              </Link>
              <Link
                to={mapHref(project.id)}
                className="font-medium text-stone-700 hover:text-stone-900 underline underline-offset-2"
              >
                See the map
              </Link>
              <Link
                to={readHref(project.id)}
                className="font-medium text-stone-700 hover:text-stone-900 underline underline-offset-2"
              >
                Read the app
              </Link>
            </div>
          )}
          {extraMissing > 0 && (
            <Link
              to={gapsHref(project.id)}
              className="inline-block text-xs text-stone-500 mt-2 hover:text-stone-900 underline underline-offset-2"
            >
              +{extraMissing} more in Gaps
            </Link>
          )}
        </div>

        <div className="space-y-1 text-xs text-stone-500">
          <p>
            Last analyzed <span className="text-stone-700">{timeAgo(analyzedAt) || '—'}</span>
          </p>
          {project.last_commit ? (
            <p className="flex items-center gap-1.5 min-w-0">
              <GitCommit className="w-3 h-3 shrink-0" />
              <span className="shrink-0">Last commit</span>
              <span className="text-stone-700 shrink-0">
                {project.last_commit.date ? timeAgo(project.last_commit.date) : '—'}
              </span>
              {project.last_commit.title && (
                <span className="truncate">· {project.last_commit.title}</span>
              )}
              <span className="font-mono text-stone-400 shrink-0">
                {project.last_commit.shortSha}
              </span>
            </p>
          ) : (
            <p className="flex items-center gap-1.5">
              <GitCommit className="w-3 h-3 shrink-0" />
              Last commit not recorded yet
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 mt-4">
          <div className="flex items-center gap-2 flex-wrap">
            {score != null && (
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full border-2 border-stone-900 bg-white flex items-center justify-center">
                  <span className="text-[11px] font-bold text-stone-900">{score}</span>
                </div>
                <span className="text-xs text-stone-500">Readiness</span>
              </div>
            )}
            {project.framework && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-stone-100 text-stone-700 border border-stone-200">
                {project.framework}
              </span>
            )}
            {deployed && project.live_url && (
              <span className="flex items-center gap-1 text-emerald-700 font-medium text-xs">
                <Rocket className="w-3 h-3 -rotate-45" />
                Live
              </span>
            )}
          </div>
          <Link
            to={readHref(project.id)}
            className="text-xs text-stone-500 hover:text-stone-900 transition-colors shrink-0"
          >
            View →
          </Link>
        </div>
      </div>
      <div className="px-5 py-2.5 border-t border-stone-200 flex items-center gap-4">
        <Link
          to={`/read/${project.id}#map`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-600 hover:text-stone-900 transition-colors"
        >
          <Map className="w-3 h-3" />
          Product map →
        </Link>
        <Link
          to={`/read/${project.id}#gaps`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-600 hover:text-stone-900 transition-colors"
        >
          <BookOpen className="w-3 h-3" />
          Gaps →
        </Link>
      </div>
    </article>
  );
}

export default ProjectCard;
