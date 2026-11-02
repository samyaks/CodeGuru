import { ExternalLink, GitPullRequest } from 'lucide-react';

export interface MergedPullData {
  number: number;
  title: string;
  summary?: string | null;
  author?: string | null;
  authorAvatar?: string | null;
  mergedAt?: string | null;
  url?: string | null;
}

export interface MergedPullCardProps {
  pull: MergedPullData;
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
  if (days < 14) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

export function MergedPullCard({ pull }: MergedPullCardProps) {
  return (
    <article className="bg-paper-raised border border-line rounded-lg px-4 py-3.5">
      <div className="flex items-start gap-3">
        <GitPullRequest className="w-4 h-4 text-ink-muted flex-shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h4 className="font-semibold text-ink text-sm leading-snug">
              <span className="text-ink-muted font-medium mr-1.5">#{pull.number}</span>
              {pull.url ? (
                <a
                  href={pull.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  {pull.title}
                </a>
              ) : (
                pull.title
              )}
            </h4>
            {pull.url ? (
              <a
                href={pull.url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 rounded text-ink-muted hover:text-ink transition-colors flex-shrink-0"
                title="Open in GitHub"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            ) : null}
          </div>
          {pull.summary ? (
            <p className="text-sm text-ink-muted leading-relaxed mt-1">{pull.summary}</p>
          ) : null}
          <div className="flex items-center gap-2 text-[11px] text-ink-muted mt-2">
            {pull.authorAvatar ? (
              <img src={pull.authorAvatar} alt="" className="w-4 h-4 rounded-full" />
            ) : null}
            {pull.author ? <span>{pull.author}</span> : null}
            {pull.author && pull.mergedAt ? <span className="text-ink-muted">·</span> : null}
            {pull.mergedAt ? <span>merged {timeAgo(pull.mergedAt)}</span> : null}
          </div>
        </div>
      </div>
    </article>
  );
}

export default MergedPullCard;
