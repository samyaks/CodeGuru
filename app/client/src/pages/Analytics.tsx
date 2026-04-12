import { useEffect, useState, useCallback } from 'react';
import {
  BarChart3,
  Users,
  Eye,
  Zap,
  Code,
  Copy,
  Check,
  Loader2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import {
  fetchAnalyticsOverview,
  fetchAnalyticsSetup,
  type AnalyticsOverview,
  type AnalyticsSetup,
} from '../services/api';

type Period = 'today' | 'week' | 'month';

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Today',
  week: '7d',
  month: '30d',
};

interface AnalyticsProps {
  projectId: string;
}

export default function Analytics({ projectId }: AnalyticsProps) {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [setup, setSetup] = useState<AnalyticsSetup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>('week');
  const [copiedScript, setCopiedScript] = useState(false);
  const [copiedNpm, setCopiedNpm] = useState(false);
  const [showNpm, setShowNpm] = useState(false);
  const [showSetupSnippet, setShowSetupSnippet] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!projectId) return;
      const silent = opts?.silent ?? false;
      if (silent) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const [ov, st] = await Promise.all([
          fetchAnalyticsOverview(projectId),
          fetchAnalyticsSetup(projectId),
        ]);
        setOverview(ov);
        setSetup(st);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load analytics');
      } finally {
        if (silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [projectId]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  const copyToClipboard = useCallback(async (text: string, setter: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text);
      setter(true);
      setTimeout(() => setter(false), 2000);
    } catch {
      setError('Failed to copy — clipboard access denied');
    }
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={32} className="animate-spin text-sky-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  if (!setup || !overview) {
    return (
      <div className="text-center py-16 space-y-3">
        <BarChart3 size={48} className="mx-auto text-sky-muted" />
        <h3 className="text-lg font-semibold text-sky-white">No analytics data</h3>
        <p className="text-sm text-sky-muted">Could not load analytics for this project.</p>
      </div>
    );
  }

  if (!setup.hasEvents) {
    return <SetupView setup={setup} showNpm={showNpm} setShowNpm={setShowNpm} copiedScript={copiedScript} copiedNpm={copiedNpm} onCopyScript={() => copyToClipboard(setup.scriptTag, setCopiedScript)} onCopyNpm={() => copyToClipboard(setup.npmUsage, setCopiedNpm)} error={error} onDismissError={() => setError(null)} />;
  }

  const statValue = (source: { today: number; week: number; month: number }) => source[period];

  return (
    <div className="space-y-6">
      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {/* Period toggle */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-sky-white flex items-center gap-2">
          <BarChart3 size={16} className="text-gold" />
          Analytics
        </h3>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => loadData({ silent: true })}
            disabled={refreshing}
            className="p-1.5 rounded-md text-sky-muted hover:text-sky-white transition-colors disabled:opacity-50"
            title="Refresh analytics"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <div className="flex gap-1 bg-navy rounded-lg p-1 border border-sky-border/50">
            {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  period === p
                    ? 'bg-gold/10 text-gold border border-gold/20'
                    : 'text-sky-muted hover:text-sky-white border border-transparent'
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon={<Users size={18} className="text-gold" />}
          label="Visitors"
          value={statValue(overview.visitors)}
          period={PERIOD_LABELS[period]}
        />
        <StatCard
          icon={<Eye size={18} className="text-gold" />}
          label="Page Views"
          value={statValue(overview.pageviews)}
          period={PERIOD_LABELS[period]}
        />
        <StatCard
          icon={<Zap size={18} className="text-gold" />}
          label="Events (30d)"
          value={overview.topEvents.reduce((sum, e) => sum + e.count, 0)}
          period="last 30 days"
        />
      </div>

      {/* Top Pages */}
      {overview.topPages.length > 0 && (
        <DataTable
          title="Top Pages (last 30 days)"
          headers={['Page', 'Views']}
          rows={overview.topPages.map((p) => [p.path, p.count.toLocaleString()])}
        />
      )}

      {/* Top Referrers */}
      {overview.topReferrers.length > 0 && (
        <DataTable
          title="Top Referrers (last 30 days)"
          headers={['Referrer', 'Visits']}
          rows={overview.topReferrers.map((r) => [r.referrer || 'Direct', r.count.toLocaleString()])}
        />
      )}

      {/* Top Events (only non-pageview custom events) */}
      {overview.topEvents.length > 0 && (
        <DataTable
          title="Top Events (last 30 days)"
          headers={['Event', 'Count']}
          rows={overview.topEvents.map((e) => [e.event, e.count.toLocaleString()])}
        />
      )}

      {/* Collapsible setup snippet */}
      <div className="border-t border-sky-border/30 pt-4">
        <button
          onClick={() => setShowSetupSnippet(!showSetupSnippet)}
          className="flex items-center gap-2 text-sm text-sky-muted hover:text-sky-white transition-colors"
        >
          {showSetupSnippet ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Code size={14} />
          Setup snippet
        </button>
        {showSetupSnippet && (
          <div className="mt-3">
            <SetupView
              setup={setup}
              showNpm={showNpm}
              setShowNpm={setShowNpm}
              copiedScript={copiedScript}
              copiedNpm={copiedNpm}
              onCopyScript={() => copyToClipboard(setup.scriptTag, setCopiedScript)}
              onCopyNpm={() => copyToClipboard(setup.npmUsage, setCopiedNpm)}
              error={null}
              onDismissError={() => {}}
              compact
            />
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  period,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  period: string;
}) {
  return (
    <div className="bg-navy border border-sky-border/50 rounded-xl p-5 space-y-2">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs font-medium text-sky-muted">{label}</span>
      </div>
      <div className="text-2xl font-bold text-sky-white">{value.toLocaleString()}</div>
      <div className="text-[11px] text-sky-muted">{period}</div>
    </div>
  );
}

function DataTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: [string, string];
  rows: [string, string][];
}) {
  return (
    <div className="bg-navy border border-sky-border/50 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-sky-border/30">
        <h4 className="text-sm font-medium text-sky-white">{title}</h4>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-sky-border/20">
            <th className="text-left px-5 py-2 text-xs font-medium text-sky-muted">{headers[0]}</th>
            <th className="text-right px-5 py-2 text-xs font-medium text-sky-muted">{headers[1]}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row[0]}
              className={i % 2 === 0 ? 'bg-navy' : 'bg-midnight/50'}
            >
              <td className="px-5 py-2.5 text-sky-off truncate max-w-[300px]">{row[0]}</td>
              <td className="px-5 py-2.5 text-sky-white text-right font-medium tabular-nums">{row[1]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SetupView({
  setup,
  showNpm,
  setShowNpm,
  copiedScript,
  copiedNpm,
  onCopyScript,
  onCopyNpm,
  error,
  onDismissError,
  compact = false,
}: {
  setup: AnalyticsSetup;
  showNpm: boolean;
  setShowNpm: (v: boolean) => void;
  copiedScript: boolean;
  copiedNpm: boolean;
  onCopyScript: () => void;
  onCopyNpm: () => void;
  error: string | null;
  onDismissError: () => void;
  compact?: boolean;
}) {
  return (
    <div className="space-y-4">
      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
          {error}
          <button onClick={onDismissError} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      <div className="bg-navy border border-sky-border/50 rounded-xl p-5 space-y-4">
        {!compact && (
          <div className="flex items-center gap-2">
            <Code size={18} className="text-gold" />
            <h3 className="font-medium text-sky-white">Add Analytics to Your App</h3>
          </div>
        )}

        {/* Script tag */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-sky-muted">Script tag</label>
          <div className="relative">
            <pre className="text-xs text-sky-off bg-midnight rounded-lg p-4 pr-12 border border-sky-border/30 overflow-auto font-mono">
              {setup.scriptTag}
            </pre>
            <button
              onClick={onCopyScript}
              className="absolute top-2.5 right-2.5 p-1.5 rounded-md bg-navy-mid border border-sky-border/50 text-sky-muted hover:text-sky-white transition-colors"
              title="Copy script tag"
            >
              {copiedScript ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
            </button>
          </div>
        </div>

        {/* npm alternative */}
        <div>
          <button
            onClick={() => setShowNpm(!showNpm)}
            className="flex items-center gap-2 text-xs text-sky-muted hover:text-sky-white transition-colors"
          >
            {showNpm ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            npm alternative
          </button>
          {showNpm && (
            <div className="mt-2 space-y-2">
              <pre className="text-xs text-sky-off bg-midnight rounded-lg p-4 border border-sky-border/30 overflow-auto font-mono">
                {setup.npmInstall}
              </pre>
              <div className="relative">
                <pre className="text-xs text-sky-off bg-midnight rounded-lg p-4 pr-12 border border-sky-border/30 overflow-auto font-mono">
                  {setup.npmUsage}
                </pre>
                <button
                  onClick={onCopyNpm}
                  className="absolute top-2.5 right-2.5 p-1.5 rounded-md bg-navy-mid border border-sky-border/50 text-sky-muted hover:text-sky-white transition-colors"
                  title="Copy npm usage"
                >
                  {copiedNpm ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          )}
        </div>

        {!compact && (
          <p className="text-xs text-sky-muted">
            Events will appear here within minutes of adding the snippet.
          </p>
        )}
      </div>
    </div>
  );
}
