import { ExternalLink, GitCommit } from 'lucide-react';
import { Badge } from './Badge';
import type { BadgeVariant } from './Badge';

export type RecentCommitSummarySource =
  | 'build_story'
  | 'build_draft'
  | 'ai_review'
  | 'gap_verification'
  | 'commit_body'
  | 'commit_title';

export interface RecentCommitData {
  sha: string;
  shortSha: string;
  title: string;
  summary: string;
  summaryTitle?: string | null;
  summarySource: RecentCommitSummarySource;
  author?: string | null;
  authorLogin?: string | null;
  authorAvatar?: string | null;
  date?: string | null;
  url?: string | null;
  matchedGap?: boolean;
  verification?: 'verified' | 'partial' | 'pending' | null;
}

export interface RecentCommitCardProps {
  commit: RecentCommitData;
  className?: string;
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

const SOURCE_HINT: Partial<Record<RecentCommitSummarySource, string>> = {
  build_story: 'From Build Story',
  build_draft: 'AI draft',
  ai_review: 'From AI review',
  gap_verification: 'Gap check',
};

function verificationBadge(verification: RecentCommitData['verification']): {
  label: string;
  variant: BadgeVariant;
} | null {
  if (verification === 'verified') return { label: 'Matched gap', variant: 'verified' };
  if (verification === 'partial') return { label: 'Partial match', variant: 'partial' };
  if (verification === 'pending') return { label: 'Checking…', variant: 'pending' };
  return null;
}

export function RecentCommitCard({ commit, className = '' }: RecentCommitCardProps) {
  const heading = commit.summaryTitle?.trim() || commit.title;
  const showTitleUnderHeading = !!commit.summaryTitle?.trim()
    && commit.summaryTitle.trim() !== commit.title;
  const badge = verificationBadge(commit.verification);
  const sourceHint = SOURCE_HINT[commit.summarySource];
  const who = commit.authorLogin || commit.author;

  return (
    <article
      className={`bg-white border border-stone-200 rounded-lg p-4 ${className}`.trim()}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-stone-700 bg-stone-50 border border-stone-200 px-1.5 py-0.5 rounded">
            <GitCommit className="w-3 h-3 text-stone-500" />
            {commit.shortSha}
          </span>
          {badge ? <Badge variant={badge.variant}>{badge.label}</Badge> : null}
          {sourceHint ? (
            <span className="text-[11px] text-stone-500">{sourceHint}</span>
          ) : null}
        </div>
        {commit.url ? (
          <a
            href={commit.url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded text-stone-400 hover:text-stone-700 transition-colors flex-shrink-0"
            title="Open in GitHub"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        ) : null}
      </div>

      <h4 className="font-semibold text-stone-900 text-sm mb-1 leading-snug">{heading}</h4>
      {showTitleUnderHeading ? (
        <p className="text-xs text-stone-500 mb-2 truncate" title={commit.title}>
          {commit.title}
        </p>
      ) : null}

      <p className="text-sm text-stone-600 leading-relaxed mb-3">{commit.summary}</p>

      <div className="flex items-center gap-2 text-[11px] text-stone-500">
        {commit.authorAvatar ? (
          <img
            src={commit.authorAvatar}
            alt=""
            className="w-4 h-4 rounded-full"
          />
        ) : null}
        {who ? <span>{who}</span> : null}
        {who && commit.date ? <span className="text-stone-300">·</span> : null}
        {commit.date ? <span>{timeAgo(commit.date)}</span> : null}
      </div>
    </article>
  );
}

export default RecentCommitCard;
