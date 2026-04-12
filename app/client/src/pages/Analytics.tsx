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
  FileCode2,
  MousePointerClick,
  Shield,
  CircleHelp,
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
  const [showFaq, setShowFaq] = useState(false);

  if (compact) {
    return (
      <div className="space-y-4">
        <div className="bg-navy border border-sky-border/50 rounded-xl p-5 space-y-4">
          <CodeSnippetBlock
            label="Script tag — paste in your HTML"
            code={setup.scriptTag}
            copied={copiedScript}
            onCopy={onCopyScript}
          />
          <NpmAlternative
            setup={setup}
            showNpm={showNpm}
            setShowNpm={setShowNpm}
            copiedNpm={copiedNpm}
            onCopyNpm={onCopyNpm}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
          {error}
          <button onClick={onDismissError} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {/* Hero / intro */}
      <div className="bg-navy border border-sky-border/50 rounded-xl p-6 space-y-3">
        <div className="flex items-center gap-2.5">
          <BarChart3 size={22} className="text-gold" />
          <h3 className="text-lg font-semibold text-sky-white">Add Analytics to Your App</h3>
        </div>
        <p className="text-sm text-sky-off leading-relaxed">
          See how people use your app — which pages they visit, where they come from,
          and what actions they take. Setup takes about 2 minutes and a single line of code.
        </p>
      </div>

      {/* What you'll see */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FeatureCard
          icon={<Users size={16} className="text-gold" />}
          title="Visitor count"
          desc="How many people visit your app each day, week, and month"
        />
        <FeatureCard
          icon={<Eye size={16} className="text-gold" />}
          title="Page views"
          desc="Which pages are most popular and how people navigate your app"
        />
        <FeatureCard
          icon={<MousePointerClick size={16} className="text-gold" />}
          title="Custom events"
          desc="Track button clicks, sign-ups, purchases — anything you choose"
        />
      </div>

      {/* Step-by-step instructions */}
      <div className="bg-navy border border-sky-border/50 rounded-xl p-6 space-y-6">
        <h4 className="text-sm font-semibold text-sky-white flex items-center gap-2">
          <Code size={16} className="text-gold" />
          Setup Instructions
        </h4>

        {/* Step 1 */}
        <SetupStep number={1} title="Copy the script tag">
          <p className="text-sm text-sky-off leading-relaxed">
            Click the <strong className="text-sky-white">copy button</strong> on the right side of the code
            below to copy it to your clipboard.
          </p>
          <CodeSnippetBlock
            label=""
            code={setup.scriptTag}
            copied={copiedScript}
            onCopy={onCopyScript}
          />
        </SetupStep>

        {/* Step 2 */}
        <SetupStep number={2} title="Paste it into your HTML">
          <p className="text-sm text-sky-off leading-relaxed">
            Open your app's main HTML file and paste the script tag inside the{' '}
            <code className="px-1.5 py-0.5 rounded bg-midnight text-gold text-xs font-mono">&lt;head&gt;</code>{' '}
            section — right before the closing{' '}
            <code className="px-1.5 py-0.5 rounded bg-midnight text-gold text-xs font-mono">&lt;/head&gt;</code>{' '}
            tag.
          </p>
          <div className="bg-midnight rounded-lg p-4 border border-sky-border/30 text-xs font-mono text-sky-off leading-relaxed">
            <span className="text-sky-muted">&lt;head&gt;</span><br />
            <span className="text-sky-muted pl-4">  &lt;!-- your other tags ... --&gt;</span><br />
            <span className="pl-4 text-emerald-400">{setup.scriptTag}</span>
            <span className="text-emerald-400/60">  ← paste here</span><br />
            <span className="text-sky-muted">&lt;/head&gt;</span>
          </div>
          <details className="mt-2 text-sm">
            <summary className="text-sky-muted hover:text-sky-white cursor-pointer flex items-center gap-1.5">
              <FileCode2 size={13} />
              Where is my HTML file?
            </summary>
            <ul className="mt-2 space-y-1.5 text-sky-off text-xs leading-relaxed pl-5 list-disc">
              <li><strong className="text-sky-white">React</strong> (Vite / Create React App) → <code className="px-1 py-0.5 rounded bg-midnight text-gold font-mono">index.html</code> in the project root or <code className="px-1 py-0.5 rounded bg-midnight text-gold font-mono">public/</code> folder</li>
              <li><strong className="text-sky-white">Next.js</strong> → <code className="px-1 py-0.5 rounded bg-midnight text-gold font-mono">app/layout.tsx</code> (inside the <code className="font-mono text-gold">&lt;head&gt;</code>) or use <code className="font-mono text-gold">next/script</code></li>
              <li><strong className="text-sky-white">Plain HTML</strong> → your main <code className="px-1 py-0.5 rounded bg-midnight text-gold font-mono">.html</code> file</li>
              <li><strong className="text-sky-white">WordPress</strong> → Appearance → Theme Editor → <code className="px-1 py-0.5 rounded bg-midnight text-gold font-mono">header.php</code></li>
              <li><strong className="text-sky-white">Not sure?</strong> Ask your AI coding assistant: "Where should I put a script tag in my app?"</li>
            </ul>
          </details>
        </SetupStep>

        {/* Step 3 */}
        <SetupStep number={3} title="Deploy and visit your app">
          <p className="text-sm text-sky-off leading-relaxed">
            Push your changes and open your app in a browser. The script runs automatically —
            it will start tracking page views as soon as someone visits. Come back to this tab
            in a few minutes to see your first data.
          </p>
        </SetupStep>

        {/* Divider */}
        <div className="border-t border-sky-border/30" />

        {/* Optional: custom events */}
        <div className="space-y-2">
          <h5 className="text-xs font-semibold text-sky-white uppercase tracking-wider">Optional — Track custom events</h5>
          <p className="text-sm text-sky-off leading-relaxed">
            Want to know when someone clicks a button, submits a form, or completes a purchase?
            Add this one line of JavaScript anywhere in your app:
          </p>
          <div className="bg-midnight rounded-lg p-4 border border-sky-border/30 text-xs font-mono text-sky-off leading-relaxed space-y-1">
            <div><span className="text-sky-muted">// Example: track a button click</span></div>
            <div>
              <span className="text-sky-white">takeoff</span>
              <span className="text-sky-muted">.</span>
              <span className="text-sky-white">track</span>
              <span className="text-sky-muted">(</span>
              <span className="text-emerald-400">'signup_clicked'</span>
              <span className="text-sky-muted">);</span>
            </div>
            <div className="pt-2"><span className="text-sky-muted">// You can also attach extra info</span></div>
            <div>
              <span className="text-sky-white">takeoff</span>
              <span className="text-sky-muted">.</span>
              <span className="text-sky-white">track</span>
              <span className="text-sky-muted">(</span>
              <span className="text-emerald-400">'purchase'</span>
              <span className="text-sky-muted">, {'{'} </span>
              <span className="text-sky-white">plan</span>
              <span className="text-sky-muted">: </span>
              <span className="text-emerald-400">'pro'</span>
              <span className="text-sky-muted">, </span>
              <span className="text-sky-white">price</span>
              <span className="text-sky-muted">: </span>
              <span className="text-sky-white">29</span>
              <span className="text-sky-muted"> {'}'});</span>
            </div>
          </div>
        </div>

        {/* npm alternative */}
        <NpmAlternative
          setup={setup}
          showNpm={showNpm}
          setShowNpm={setShowNpm}
          copiedNpm={copiedNpm}
          onCopyNpm={onCopyNpm}
        />
      </div>

      {/* Privacy & FAQ */}
      <div className="bg-navy border border-sky-border/50 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Shield size={16} className="text-emerald-500" />
          <h4 className="text-sm font-medium text-sky-white">Privacy-friendly by default</h4>
        </div>
        <ul className="text-sm text-sky-off space-y-1.5 list-disc pl-5 leading-relaxed">
          <li>No cookies — uses a temporary session ID that resets when the browser tab closes</li>
          <li>No personal data collected — no names, emails, or IP addresses stored</li>
          <li>Lightweight — the script is under 2 KB and won't slow down your app</li>
          <li>Your data stays on your server — nothing is sent to third parties</li>
        </ul>

        <button
          onClick={() => setShowFaq(!showFaq)}
          className="flex items-center gap-2 text-xs text-sky-muted hover:text-sky-white transition-colors"
        >
          {showFaq ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <CircleHelp size={12} />
          Common questions
        </button>
        {showFaq && (
          <div className="space-y-3 text-sm">
            <FaqItem
              q="Do I need to modify my app's code beyond pasting the script?"
              a="No — just the one script tag. Page views are tracked automatically, including navigation in single-page apps (React, Vue, etc.)."
            />
            <FaqItem
              q="Will this slow down my app?"
              a="No. The script loads asynchronously and is under 2 KB. Analytics events are sent in the background using the browser's Beacon API, so they never block your app."
            />
            <FaqItem
              q="How long until I see data?"
              a="Within a few minutes of your first visit. Come back to this Analytics tab after you've deployed the change and visited your app."
            />
            <FaqItem
              q="Can I remove it later?"
              a="Yes — just delete the script tag from your HTML. No data will be collected after that. Existing data stays in your dashboard."
            />
          </div>
        )}
      </div>
    </div>
  );
}

function SetupStep({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gold/10 border border-gold/20 flex items-center justify-center">
        <span className="text-xs font-bold text-gold">{number}</span>
      </div>
      <div className="flex-1 space-y-3 pt-0.5">
        <h5 className="text-sm font-medium text-sky-white">{title}</h5>
        {children}
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="bg-navy border border-sky-border/50 rounded-xl p-4 space-y-1.5">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-medium text-sky-white">{title}</span>
      </div>
      <p className="text-xs text-sky-muted leading-relaxed">{desc}</p>
    </div>
  );
}

function CodeSnippetBlock({
  label,
  code,
  copied,
  onCopy,
}: {
  label: string;
  code: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-2">
      {label && <label className="block text-xs font-medium text-sky-muted">{label}</label>}
      <div className="relative">
        <pre className="text-xs text-sky-off bg-midnight rounded-lg p-4 pr-12 border border-sky-border/30 overflow-auto font-mono">
          {code}
        </pre>
        <button
          onClick={onCopy}
          className="absolute top-2.5 right-2.5 p-1.5 rounded-md bg-navy-mid border border-sky-border/50 text-sky-muted hover:text-sky-white transition-colors"
          title="Copy to clipboard"
        >
          {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
        </button>
      </div>
    </div>
  );
}

function NpmAlternative({
  setup,
  showNpm,
  setShowNpm,
  copiedNpm,
  onCopyNpm,
}: {
  setup: AnalyticsSetup;
  showNpm: boolean;
  setShowNpm: (v: boolean) => void;
  copiedNpm: boolean;
  onCopyNpm: () => void;
}) {
  return (
    <div>
      <button
        onClick={() => setShowNpm(!showNpm)}
        className="flex items-center gap-2 text-xs text-sky-muted hover:text-sky-white transition-colors"
      >
        {showNpm ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Alternative: install via npm (for advanced users)
      </button>
      {showNpm && (
        <div className="mt-3 space-y-3 pl-5 border-l-2 border-sky-border/30">
          <p className="text-xs text-sky-off leading-relaxed">
            If you prefer importing analytics as a dependency instead of a script tag,
            run this in your project folder:
          </p>
          <pre className="text-xs text-sky-off bg-midnight rounded-lg p-4 border border-sky-border/30 overflow-auto font-mono">
            {setup.npmInstall}
          </pre>
          <p className="text-xs text-sky-off leading-relaxed">
            Then add this to your app's entry point (e.g.{' '}
            <code className="px-1 py-0.5 rounded bg-midnight text-gold font-mono">main.tsx</code> or{' '}
            <code className="px-1 py-0.5 rounded bg-midnight text-gold font-mono">App.jsx</code>):
          </p>
          <CodeSnippetBlock label="" code={setup.npmUsage} copied={copiedNpm} onCopy={onCopyNpm} />
        </div>
      )}
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div className="bg-midnight/50 rounded-lg p-3 space-y-1">
      <p className="text-sky-white font-medium text-xs">{q}</p>
      <p className="text-sky-off text-xs leading-relaxed">{a}</p>
    </div>
  );
}
