import { useCallback, useEffect, useState } from 'react';
import { GitCommit, Github } from 'lucide-react';
import { ShippedItem, EmptyState } from '../../components/v2';
import { fetchV2Shipped, reopenShipped, type V2ShippedResponse } from '../../services/v2Api';

export interface ShippedSectionProps {
  projectId: string;
}

export function ShippedSection({ projectId }: ShippedSectionProps) {
  const [data, setData] = useState<V2ShippedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
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

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold text-stone-900 mb-2 v2-font-serif">What you've shipped</h3>
        <p className="text-stone-600 text-sm leading-relaxed">
          Takeoff watches your repo. Every commit gets matched to a gap and verified — we re-scan the affected files to confirm the problem is actually gone.
        </p>
      </div>

      <div className="bg-white border border-stone-200 rounded-lg p-4 flex items-center gap-3">
        <Github className="w-4 h-4 text-stone-500" />
        <span className="text-sm text-stone-700">
          {data.repo ? (
            <>Connected to <span className="font-mono text-stone-900">{data.repo}</span></>
          ) : (
            'No GitHub repo connected'
          )}
        </span>
        {data.repo ? (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            Listening for commits
          </span>
        ) : null}
      </div>

      {data.items.length === 0 ? (
        <EmptyState
          icon={GitCommit}
          title="Nothing shipped yet"
          description="Accept a gap, commit your work, and it'll appear here verified."
        />
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
