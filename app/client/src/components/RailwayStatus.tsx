import { useEffect, useState, useCallback } from 'react';
import { Loader, RefreshCw, ExternalLink, AlertTriangle, CheckCircle, XCircle, Clock, Train, Link2, Unplug, Search } from 'lucide-react';
import {
  fetchRailwayStatus,
  railwayConnectUrl,
  disconnectRailway,
  relookupRailwayProject,
  type RailwayStatusResponse,
  type RailwayDeployment,
} from '../services/api';

interface RailwayStatusProps {
  analysisId: string;
  initialFlag?: 'connected' | 'no-match' | 'denied' | null;
}

export default function RailwayStatus({ analysisId, initialFlag = null }: RailwayStatusProps) {
  const [data, setData] = useState<RailwayStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [relooking, setRelooking] = useState(false);

  const handleDisconnect = useCallback(async () => {
    if (!confirm('Disconnect your Railway account from this analysis?')) return;
    setDisconnecting(true);
    setError(null);
    try {
      await disconnectRailway(analysisId);
      setData({ connected: false });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to disconnect';
      setError(message);
    } finally {
      setDisconnecting(false);
    }
  }, [analysisId]);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await fetchRailwayStatus(analysisId);
      setData(result);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to load Railway status';
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [analysisId]);

  const handleRelookup = useCallback(async () => {
    setRelooking(true);
    setError(null);
    try {
      const result = await relookupRailwayProject(analysisId);
      setData(result);
      if (result && 'connected' in result && result.connected && 'matched' in result && result.matched) {
        await load(true);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to find Railway project';
      setError(message);
    } finally {
      setRelooking(false);
    }
  }, [analysisId, load]);

  useEffect(() => {
    if (initialFlag === 'connected' || initialFlag === 'no-match') {
      load(false);
    } else if (initialFlag === null) {
      load(false);
    }
  }, [initialFlag, load]);

  if (initialFlag === 'denied') {
    return (
      <RailwayCard>
        <div className="flex items-start gap-3">
          <XCircle size={20} className="text-warning flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-text">Railway connection cancelled</h3>
            <p className="text-xs text-text-muted mt-1">You denied access on the Railway consent screen. You can try again whenever you're ready.</p>
            <a
              href={railwayConnectUrl(analysisId)}
              className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand hover:bg-brand-hov text-text transition-colors"
            >
              Try connecting again
            </a>
          </div>
        </div>
      </RailwayCard>
    );
  }

  if (loading) {
    return (
      <RailwayCard>
        <div className="flex items-center gap-3 py-2">
          <Loader size={16} className="animate-spin text-brand" />
          <span className="text-sm text-text-muted">Loading Railway status...</span>
        </div>
      </RailwayCard>
    );
  }

  if (error) {
    return (
      <RailwayCard>
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="text-danger flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-text">Couldn't load Railway status</h3>
            <p className="text-xs text-text-muted mt-1">{error}</p>
            <button
              onClick={() => load(false)}
              className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-2 hover:bg-page text-text-soft transition-colors"
            >
              <RefreshCw size={12} /> Retry
            </button>
          </div>
        </div>
      </RailwayCard>
    );
  }

  if (!data || !data.connected) {
    return (
      <RailwayCard>
        <div className="flex items-start gap-4">
          <div className="p-2 rounded-lg bg-brand-tint flex-shrink-0">
            <Train size={20} className="text-brand" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-text">Railway detected in this repo</h3>
            <p className="text-xs text-text-muted mt-1">
              Connect your Railway account to see live deployment status, recent builds, and the deployed URL.
            </p>
            <a
              href={railwayConnectUrl(analysisId)}
              className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand hover:bg-brand-hov text-text transition-colors"
            >
              Connect with Railway
            </a>
          </div>
        </div>
      </RailwayCard>
    );
  }

  if (!data.matched) {
    return (
      <RailwayCard>
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="text-warning flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-text">No matching Railway project found</h3>
            <p className="text-xs text-text-muted mt-1">
              Your Railway account is connected, but we couldn't find a project linked to this GitHub repo. If you just connected the repo on Railway, click "Find my project" to retry the lookup.
            </p>
            <div className="flex gap-2 mt-3">
              <a
                href="https://railway.com/dashboard"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand hover:bg-brand-hov text-text transition-colors"
              >
                Open Railway dashboard <ExternalLink size={12} />
              </a>
              <button
                onClick={handleRelookup}
                disabled={relooking}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-brand hover:bg-brand-hov text-text transition-colors disabled:opacity-60"
              >
                <Search size={12} className={relooking ? 'animate-spin' : ''} />
                {relooking ? 'Searching...' : 'Find my project'}
              </button>
              <button
                onClick={() => load(true)}
                disabled={refreshing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-surface-2 hover:bg-page text-text-soft transition-colors disabled:opacity-60"
              >
                <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
          </div>
        </div>
      </RailwayCard>
    );
  }

  const latest = data.latestDeployment;

  return (
    <RailwayCard>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-brand-tint flex-shrink-0">
            <Train size={20} className="text-brand" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text">
              {data.project.name || 'Railway project'}
            </h3>
            <p className="text-xs text-text-muted mt-0.5">Connected via Railway OAuth</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-surface-2 hover:bg-page text-text-soft transition-colors disabled:opacity-60"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-text-muted hover:text-danger hover:bg-page transition-colors disabled:opacity-60"
            title="Disconnect Railway"
          >
            <Unplug size={12} />
            Disconnect
          </button>
        </div>
      </div>

      {data.url && (
        <a
          href={data.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 mb-3 rounded-lg bg-brand-tint border border-brand-tint-border hover:bg-brand-tint-2 transition-colors group"
        >
          <Link2 size={14} className="text-brand flex-shrink-0" />
          <span className="text-sm text-brand font-medium truncate flex-1">{data.url}</span>
          <ExternalLink size={12} className="text-brand opacity-60 group-hover:opacity-100 transition-opacity" />
        </a>
      )}

      {latest ? (
        <div className="bg-page border border-line rounded-lg p-4 mb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <StatusBadge status={latest.status} />
              <span className="text-xs text-text-muted">
                {formatRelativeTime(latest.createdAt)}
              </span>
            </div>
            {latest.canRollback && (
              <span className="text-xs text-text-muted">Can rollback</span>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-text-muted py-2">No deployments yet.</p>
      )}

      {data.recentDeployments.length > 1 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wide mt-4 mb-2">Recent deployments</h4>
          {data.recentDeployments.slice(1).map((d) => (
            <DeploymentRow key={d.id} d={d} />
          ))}
        </div>
      )}
    </RailwayCard>
  );
}

function RailwayCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-line rounded-xl p-5">
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const upper = (status || '').toUpperCase();
  let icon = <Clock size={12} />;
  let cls = 'bg-surface-2 text-text-muted border border-line';

  if (upper === 'SUCCESS') {
    icon = <CheckCircle size={12} />;
    cls = 'bg-green-500/10 text-success border border-green-500/20';
  } else if (upper === 'FAILED' || upper === 'CRASHED') {
    icon = <XCircle size={12} />;
    cls = 'bg-red-500/10 text-danger border border-red-500/20';
  } else if (upper === 'BUILDING' || upper === 'DEPLOYING' || upper === 'INITIALIZING') {
    icon = <Loader size={12} className="animate-spin" />;
    cls = 'bg-warning-bg text-warning border border-warning-border';
  } else if (upper === 'QUEUED' || upper === 'WAITING') {
    icon = <Clock size={12} />;
    cls = 'bg-brand-tint text-brand border border-brand-tint-border';
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {icon}
      {upper || 'UNKNOWN'}
    </span>
  );
}

function DeploymentRow({ d }: { d: RailwayDeployment }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-page">
      <StatusBadge status={d.status} />
      <span className="text-xs text-text-muted">{formatRelativeTime(d.createdAt)}</span>
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
