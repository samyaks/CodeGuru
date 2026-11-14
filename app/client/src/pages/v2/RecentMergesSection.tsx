import { useCallback, useEffect, useState } from 'react';
import { GitPullRequest, RefreshCw } from 'lucide-react';
import { EmptyState, MergedPullCard } from '../../components/v2';
import { fetchV2Shipped, type V2ShippedResponse } from '../../services/v2Api';

export interface RecentMergesSectionProps {
  projectId: string;
}

// The repo's most recent merged pull requests, on the Spec tab. Reads the
// same payload as the Shipped tab, which shows them too.
export function RecentMergesSection({ projectId }: RecentMergesSectionProps) {
  const [data, setData] = useState<V2ShippedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchV2Shipped(projectId));
    } catch (err) {
      setError((err as Error).message ?? 'Failed to load recent merges');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void reload(); }, [reload]);

  if (loading && !data) {
    return <div className="text-sm text-ink-muted">Loading recent merges…</div>;
  }
  if (error) {
    return (
      <EmptyState
        title="Couldn't load recent merges"
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

  const recentMerges = Array.isArray(data.recentMerges) ? data.recentMerges : [];

  return (
    <section aria-labelledby="spec-recent-merges-heading" className="space-y-5">
      <div>
        <h3 id="spec-recent-merges-heading" className="text-2xl font-bold text-ink mb-2 v2-font-serif">
          Recent merges
        </h3>
        <p className="text-ink-muted text-sm leading-relaxed max-w-2xl">
          {recentMerges.length > 0
            ? `The last ${recentMerges.length === 1 ? 'merged pull request' : `${recentMerges.length} merged pull requests`} on this repo.`
            : 'Merged pull requests on this repo will show up here.'}
        </p>
      </div>
      {recentMerges.length > 0 ? (
        <div className="space-y-2">
          {recentMerges.map((pull) => (
            <MergedPullCard key={pull.number} pull={pull} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={GitPullRequest}
          title={data.repo ? 'No merged pull requests yet' : 'No GitHub repo connected'}
          description={data.repo
            ? 'Once a pull request is merged on this repo, it will be listed here.'
            : 'Connect a GitHub repo in Settings to see its merged pull requests here.'}
        />
      )}
    </section>
  );
}

export default RecentMergesSection;
