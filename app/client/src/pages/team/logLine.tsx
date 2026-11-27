import type { LogEntry } from '../../services/overviewApi';

const who = (p: { name: string | null } | null | undefined) => p?.name || 'a teammate';

const VIA: Record<string, string> = {
  everyone_agreed: 'everyone agreed',
  stall_fallback: 'decided after 48 hours without objection',
};

/** One plain sentence on a decided agreement or a finished drift decision. */
export function logSentence(e: LogEntry): string {
  if (e.kind === 'agreement') {
    const via = e.via && VIA[e.via] ? ` (${VIA[e.via]})` : '';
    if (e.outcome === 'withdrawn') return `${who(e.proposedBy)} withdrew “${e.text}”.`;
    const verb = e.outcome === 'accepted' ? 'Agreed' : 'Declined';
    const by = e.decidedBy ? `, decided by ${who(e.decidedBy)}` : '';
    return `${verb}${via}: “${e.text}”${e.areaName ? ` for ${e.areaName}` : ''}. Proposed by ${who(e.proposedBy)}${by}.`;
  }
  const confirmed = e.confirmedBy ? `, confirmed by ${who(e.confirmedBy)}` : '';
  if (e.outcome === 'accepted') {
    return `PR #${e.prNumber}: ${who(e.by)} accepted the change into takeoff.yaml${confirmed}.${e.changes.length ? ` ${e.changes.join(' ')}` : ''}`;
  }
  return `PR #${e.prNumber}: ${who(e.by)} sent it back${confirmed}${e.note ? `: “${e.note}”` : '.'}`;
}

/** The links an entry has, in the order they matter. */
export function logLinks(e: LogEntry): Array<{ label: string; href: string }> {
  const out: Array<{ label: string; href: string | null }> = e.kind === 'agreement'
    ? [{ label: 'Commit', href: e.commitUrl }, { label: 'Pull request', href: e.commitPrUrl }, { label: 'Source', href: e.sourceUrl }]
    : [{ label: `PR #${e.prNumber}`, href: e.prUrl }, { label: 'Commit', href: e.commitUrl }, { label: 'Comment', href: e.commentUrl }];
  return out.filter((l): l is { label: string; href: string } => !!l.href && /^https:\/\//i.test(l.href));
}

export function LogLinks({ entry, className }: { entry: LogEntry; className?: string }) {
  const links = logLinks(entry);
  if (!links.length) return null;
  return (
    <span className={className}>
      {links.map((l, i) => (
        <span key={l.label}>
          {i ? ' · ' : ''}
          <a href={l.href} target="_blank" rel="noreferrer noopener">{l.label}</a>
        </span>
      ))}
    </span>
  );
}

export const formatDay = (at: string) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};
