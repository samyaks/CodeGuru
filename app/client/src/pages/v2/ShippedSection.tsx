import { useCallback, useEffect, useState } from 'react';
import { GitCommit, Github, RefreshCw } from 'lucide-react';
import { ShippedItem, EmptyState } from '../../components/v2';
import {
  fetchV2Shipped,
  reopenShipped,
  backfillShipped,
  type V2ShippedResponse,
  type BackfillSummary,
} from '../../services/v2Api';

export interface ShippedSectionProps {
  projectId: string;
}

export function ShippedSection({ projectId }: ShippedSectionProps) {
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
      setToast('Reopened as a new gap. See the Gaps tab.');
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
    return <div className="text-sm text-stone-500">Loading shipped items…</div>;
  }
  if (error) {
    return (
      <EmptyState
        title="Couldn't load shipped commits"
        description={error}
      />
    );
  }
  if (!data) return null;

  const hasRepo = !!data.repo;
  const isEmpty = data.items.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold text-stone-900 mb-2 v2-font-serif">What you've shipped</h3>
        <p className="text-stone-600 text-sm leading-relaxed">
          Takeoff watches your repo. Every commit gets matched to a gap and verified — we re-scan the affected files to confirm the problem is actually gone.
        </p>
      </div>

      <div className="bg-white border border-stone-200 rounded-lg p-4 flex items-center gap-3 flex-wrap">
        <Github className="w-4 h-4 text-stone-500" />
        <span className="text-sm text-stone-700">
          {hasRepo ? (
            <>Connected to <span className="font-mono text-stone-900">{data.repo}</span></>
          ) : (
            'No GitHub repo connected'
          )}
        </span>
        {hasRepo ? (
          <span className="ml-auto flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Listening for commits
            </span>
            <button
              type="button"
              onClick={onSync}
              disabled={syncing}
              title="Pull recent commits from GitHub and match them to your gaps"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-700 hover:text-stone-900 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing…' : 'Sync recent commits'}
            </button>
          </span>
        ) : null}
      </div>

      {isEmpty ? (
        hasRepo ? (
          <EmptyState
            icon={GitCommit}
            title="Nothing shipped yet"
            description="New commits matching an open gap will land here automatically. To pull in the last few commits from before today, click 'Sync recent commits' above."
          />
        ) : (
          <EmptyState
            icon={GitCommit}
            title="No GitHub repo connected"
            description="Connect a GitHub repo so Takeoff can match your commits to open gaps."
          />
        )
      ) : (
        <div className="space-y-3" aria-busy={busyId !== null}>
          {data.items.map((item) => (
            <ShippedItem key={item.id} item={item} onReopenAsGap={onReopen} />
          ))}
        </div>
      )}

      {toast ? (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-stone-900 text-white text-sm px-4 py-2 rounded-md shadow-lg z-40 max-w-lg"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}

export default ShippedSection;
