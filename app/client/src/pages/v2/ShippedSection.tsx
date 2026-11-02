import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { GitCommit, Github, RefreshCw, Settings } from 'lucide-react';
import { ShippedItem, EmptyState, MergedPullCard } from '../../components/v2';
import {
  fetchV2Shipped,
  reopenShipped,
  backfillShipped,
  type V2ShippedResponse,
  type BackfillSummary,
} from '../../services/v2Api';

export interface ShippedSectionProps {
  projectId: string;
  /** Signed-out / non-owner view: no sync or reopen controls. */
  readOnly?: boolean;
}

export function ShippedSection({ projectId, readOnly = false }: ShippedSectionProps) {
  const [data, setData] = useState<V2ShippedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchV2Shipped(projectId);
      setData(next);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to load shipped items');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void reload(); }, [reload]);

  const onReopen = useCallback(async (itemId: string) => {
    setBusyId(itemId);
    try {
      await reopenShipped(projectId, itemId);
      setToast('Reopened as a new gap. See the Build tab.');
      await reload();
    } catch (err) {
      setToast(`Couldn't reopen: ${(err as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }, [projectId, reload]);

  const onSync = useCallback(async () => {
    setSyncing(true);
    setToast(null);
    try {
      const summary: BackfillSummary = await backfillShipped(projectId, { limit: 30 });
      const summaryParts = [
        `${summary.matched} of ${summary.total} commit${summary.total === 1 ? '' : 's'} matched a gap`,
      ];
      if (summary.skippedExisting > 0) {
        summaryParts.push(`${summary.skippedExisting} already on file`);
      }
      if (summary.failed > 0) {
        summaryParts.push(`${summary.failed} failed`);
      }
      setToast(summaryParts.join(' · '));
      await reload();
    } catch (err) {
      setToast(`Sync failed: ${(err as Error).message}`);
    } finally {
      setSyncing(false);
    }
  }, [projectId, reload]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  if (loading && !data) {
    return <div className="text-sm text-ink-muted">Loading shipped items…</div>;
  }
  if (error) {
    return (
      <EmptyState
        title="Couldn't load shipped commits"
        description={error}
        action={
          <button
            type="button"
            onClick={() => void reload()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-ink bg-paper-raised border border-line-strong rounded hover:bg-paper-sunk transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        }
      />
    );
  }
  if (!data) return null;

  const hasRepo = !!data.repo;
  const recentMerges = Array.isArray(data.recentMerges) ? data.recentMerges : [];
  const isEmpty = data.items.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold text-ink mb-2 v2-font-serif">What you've shipped</h3>
        <p className="text-ink-muted text-sm leading-relaxed">
          Takeoff watches your repo. Every commit gets matched to a gap and verified — we re-scan the affected files to confirm the problem is actually gone.
        </p>
      </div>

      <div className="bg-paper-raised border border-line rounded-lg p-4 flex items-center gap-3 flex-wrap">
        <Github className="w-4 h-4 text-ink-muted" />
        <span className="text-sm text-ink">
          {hasRepo ? (
            <>Connected to <span className="font-mono text-ink">{data.repo}</span></>
          ) : (
            'No GitHub repo connected'
          )}
        </span>
        {hasRepo ? (
          <span className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs text-cleared font-medium">
              <span className="w-2 h-2 rounded-full bg-cleared" />
              Listening for commits
            </span>
            {!readOnly ? (
              <button
                type="button"
                onClick={onSync}
                disabled={syncing}
                title="Pull recent commits from GitHub and match them to your gaps"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-ink hover:text-ink disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Syncing…' : 'Sync recent commits'}
              </button>
            ) : null}
          </span>
        ) : null}
      </div>

      {recentMerges.length > 0 ? (
        <section aria-labelledby="recent-merges-heading" className="space-y-3">
          <div>
            <h4
              id="recent-merges-heading"
              className="text-sm font-semibold text-ink tracking-wide uppercase"
            >
              Recent merges
            </h4>
            <p className="text-xs text-ink-muted mt-1">
              The last {recentMerges.length === 1 ? 'merged pull request' : `${recentMerges.length} merged pull requests`} on this repo.
            </p>
          </div>
          <div className="space-y-2">
            {recentMerges.map((pull) => (
              <MergedPullCard key={pull.number} pull={pull} />
            ))}
          </div>
        </section>
      ) : null}

      {isEmpty ? (
        hasRepo ? (
          <EmptyState
            icon={GitCommit}
            title="Nothing matched a gap yet"
            description={readOnly
              ? 'New commits matching an open gap will land here automatically.'
              : "New commits matching an open gap will land here automatically. To pull in the last few commits from before today, click 'Sync recent commits' above."}
          />
        ) : (
          /* The Settings tab is where the GitHub integration lives —
             give users a way to get there rather than just describing
             what's missing. The hash + projectId pattern matches what
             the workspace TabBar uses internally. */
          <EmptyState
            icon={GitCommit}
            title="No GitHub repo connected"
            description="Connect a GitHub repo so Takeoff can match your commits to open gaps."
            action={
              <Link
                to={`/read/${projectId}#settings`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-ink bg-paper-raised border border-line-strong rounded hover:bg-paper-sunk transition-colors"
              >
                <Settings className="w-3 h-3" />
                Open Settings
              </Link>
            }
          />
        )
      ) : (
        <div className="space-y-3" aria-busy={busyId !== null}>
          <div>
            <h4 className="text-sm font-semibold text-ink tracking-wide uppercase">
              Gap-verified commits
            </h4>
            <p className="text-xs text-ink-muted mt-1">
              Commits Takeoff matched to an open gap and checked against the codebase.
            </p>
          </div>
          {data.items.map((item) => (
            <ShippedItem key={item.id} item={item} onReopenAsGap={readOnly ? undefined : onReopen} />
          ))}
        </div>
      )}

      {toast ? (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-night text-on-night text-sm px-4 py-2 rounded-md shadow-lg z-40 max-w-lg"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}

export default ShippedSection;
