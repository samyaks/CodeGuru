import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertOctagon, ChevronDown, ChevronRight, ExternalLink, FileText,
  RefreshCw, Server, Shield, Wrench, Zap,
} from 'lucide-react';
import {
  EmptyState, GapCard, MetadataLabel,
} from '../../components/v2';
import type { SecuritySeverity } from '../../components/v2';
import { fetchProjectDetail, type ProjectWithEntries } from '../../services/api';
import {
  fetchSecuritySummary, fetchV2Gaps,
  type SecuritySummary, type V2Gap,
} from '../../services/v2Api';

// Verdicts mirror the spec's severity bands. We use the live score
// (recomputed on the API every request) rather than the cached column
// so the verdict matches the breakdown shown directly below it — a
// stale verdict + fresh breakdown would be a credibility hit on a
// page whose entire job is to be shareable.
function verdictFor(score: number): { headline: string; tone: 'good' | 'okay' | 'warn' | 'bad' } {
  if (score >= 90) return { headline: 'Strong security posture', tone: 'good' };
  if (score >= 75) return { headline: 'Generally secure with some issues to address', tone: 'okay' };
  if (score >= 50) return { headline: 'Notable security gaps — fix before going to production', tone: 'warn' };
  return { headline: 'Critical security risks — do not deploy', tone: 'bad' };
}

const VERDICT_COLOR: Record<'good' | 'okay' | 'warn' | 'bad', string> = {
  good: 'text-emerald-600',
  okay: 'text-stone-600',
  warn: 'text-amber-700',
  bad:  'text-red-600',
};

// Severity → display config for the 4-column breakdown grid. Colors
// match the GapCard shield (Phase 2a) so the visual language is
// consistent across the working surface (Gaps tab) and the sharing
// surface (this page).
const SEVERITY_TILES: Array<{
  key: SecuritySeverity;
  label: string;
  bg: string;
  text: string;
  border: string;
  ring: string;
}> = [
  { key: 'critical', label: 'Critical', bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200',   ring: 'ring-red-300' },
  { key: 'high',     label: 'High',     bg: 'bg-red-50',    text: 'text-red-600',    border: 'border-red-100',   ring: 'ring-red-200' },
  { key: 'medium',   label: 'Medium',   bg: 'bg-amber-50',  text: 'text-amber-800',  border: 'border-amber-200', ring: 'ring-amber-300' },
  { key: 'low',      label: 'Low',      bg: 'bg-stone-100', text: 'text-stone-700',  border: 'border-stone-200', ring: 'ring-stone-300' },
];

function severityRank(s: SecuritySeverity | null | undefined): number {
  switch (s) {
    case 'critical': return 0;
    case 'high':     return 1;
    case 'medium':   return 2;
    case 'low':      return 3;
    default:         return 9;
  }
}

function categoryMeta(category: string) {
  if (category === 'broken') return { label: 'Broken',                 icon: AlertOctagon };
  if (category === 'missing') return { label: 'Missing Functionality', icon: Wrench };
  return                              { label: 'Missing Infrastructure', icon: Server };
}

function formatLastAnalyzed(iso: string | null): string {
  if (!iso) return 'Not analyzed yet';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Unknown';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return 'Unknown';
  }
}

export default function SecurityReport() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<ProjectWithEntries | null>(null);
  const [summary, setSummary] = useState<SecuritySummary | null>(null);
  // We fetch the full gap list separately because the summary endpoint
  // caps `topRisks` at 5. The collapsible "All security gaps" section
  // needs the full set, grouped by category. Filtering is done
  // client-side rather than adding a query param to the gaps endpoint:
  // this is a single network call instead of two and the data is
  // already sliced into the three categories we want to render.
  const [allGaps, setAllGaps] = useState<V2Gap[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<SecuritySeverity | null>(null);
  const [allOpen, setAllOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const tasks: Array<Promise<unknown>> = [
      fetchProjectDetail(id).then((p) => { if (!cancelled) setProject(p); }),
      fetchSecuritySummary(id).then((s) => { if (!cancelled) setSummary(s); }),
      fetchV2Gaps(id).then((data) => {
        if (cancelled) return;
        const merged = [...data.broken, ...data.missing, ...data.infra]
          .filter((g) => g.isSecurity === true);
        setAllGaps(merged);
      }),
    ];

    Promise.allSettled(tasks).then((results) => {
      if (cancelled) return;
      // The project + summary fetches are required; gap fetch is best
      // effort (it enriches the "All security gaps" section). If the
      // first two fail, surface the most informative error.
      const projectFail = results[0].status === 'rejected' ? results[0].reason : null;
      const summaryFail = results[1].status === 'rejected' ? results[1].reason : null;
      const fail = projectFail ?? summaryFail;
      if (fail) setError((fail as Error)?.message ?? 'Failed to load security report');
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [id]);

  // Treat in-flight or pending projects the same way the project
  // workspace does — bounce to /takeoff/:id where the user can watch
  // analysis progress instead of a permanently-empty report.
  useEffect(() => {
    if (!loading && project && (project.status === 'analyzing' || project.status === 'pending')) {
      navigate(`/takeoff/${id}`, { replace: true });
    }
  }, [loading, project, id, navigate]);

  const reAnalyze = useCallback(() => {
    if (id) navigate(`/takeoff/${id}`);
  }, [id, navigate]);

  const score = summary?.score
    ?? (typeof project?.security_score === 'number' ? project.security_score : null);

  const verdict = useMemo(
    () => (typeof score === 'number' ? verdictFor(score) : null),
    [score],
  );

  const visibleAllGaps = useMemo(() => {
    let v = allGaps;
    if (severityFilter) v = v.filter((g) => g.securitySeverity === severityFilter);
    return v;
  }, [allGaps, severityFilter]);

  // Group + sort the "All security gaps" section. Within each
  // category we sort by severity (critical → low) then by title for
  // stable ordering across re-fetches.
  const groupedAllGaps = useMemo(() => {
    const buckets: Record<string, V2Gap[]> = { broken: [], missing: [], infra: [] };
    for (const g of visibleAllGaps) {
      const cat = (g.category as string) || 'broken';
      if (!buckets[cat]) buckets[cat] = [];
      buckets[cat].push(g);
    }
    for (const k of Object.keys(buckets)) {
      buckets[k].sort((a, b) => {
        const sa = severityRank(a.securitySeverity);
        const sb = severityRank(b.securitySeverity);
        if (sa !== sb) return sa - sb;
        return (a.title || '').localeCompare(b.title || '');
      });
    }
    return buckets;
  }, [visibleAllGaps]);

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 v2-font-sans flex items-center justify-center">
        <div className="text-stone-500 text-sm">Loading security report…</div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="min-h-screen bg-stone-50 v2-font-sans flex items-center justify-center px-6">
        <EmptyState
          icon={Shield}
          title="Couldn't load this security report"
          description={error ?? 'Project not found.'}
        />
      </div>
    );
  }

  const repoLabel = project.repo || project.repo_url;
  const totalUnaddressed = summary?.totalUnaddressed ?? 0;
  const breakdown = summary?.severityBreakdown ?? { critical: 0, high: 0, medium: 0, low: 0 };
  const detectors = summary?.detectors ?? [];
  const lastAnalyzed = summary?.lastAnalyzed ?? project.updated_at ?? null;

  return (
    <div className="min-h-screen bg-stone-50 v2-font-sans">
      {/* ── Sticky header ────────────────────────────────────────── */}
      <header className="border-b border-stone-200 bg-white/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 bg-stone-900 rounded flex items-center justify-center flex-shrink-0">
              <Zap className="w-4 h-4 text-stone-50" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-stone-900 tracking-tight truncate">
                {repoLabel}
              </h1>
              <p className="text-xs text-stone-500 inline-flex items-center gap-1.5">
                <Shield className="w-3 h-3" aria-hidden />
                Security Report · {formatLastAnalyzed(lastAnalyzed)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link
              to={`/v2/projects/${id}#gaps`}
              className="text-xs text-stone-600 hover:text-stone-900 px-3 py-1.5 rounded border border-stone-200 hover:border-stone-400 transition-colors"
            >
              ← Back to project
            </Link>
            <button
              type="button"
              onClick={reAnalyze}
              className="text-xs text-white bg-stone-900 hover:bg-stone-800 px-3 py-1.5 rounded inline-flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className="w-3 h-3" aria-hidden />
              Re-analyze
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12 space-y-12">

        {/* ── Score hero ─────────────────────────────────────────── */}
        <section className="text-center">
          <p className="text-xs uppercase tracking-widest text-stone-500 mb-3">Security Score</p>
          {typeof score === 'number' ? (
            <>
              <div className="inline-flex items-baseline gap-2">
                <span className="text-7xl font-bold text-stone-900 tracking-tight tabular-nums v2-font-serif">
                  {score}
                </span>
                <span className="text-2xl text-stone-400 font-light">/ 100</span>
              </div>
              {verdict ? (
                <p className={`mt-3 text-base font-medium ${VERDICT_COLOR[verdict.tone]}`}>
                  {verdict.headline}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-stone-500">
                {totalUnaddressed === 0
                  ? 'No unaddressed findings.'
                  : `${totalUnaddressed} unaddressed ${totalUnaddressed === 1 ? 'finding' : 'findings'}.`}
              </p>
            </>
          ) : (
            <p className="text-stone-500 text-sm">
              No security score yet — re-run analysis to populate this report.
            </p>
          )}
        </section>

        {/* ── Severity breakdown ─────────────────────────────────── */}
        <section>
          <MetadataLabel className="mb-3">By severity</MetadataLabel>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {SEVERITY_TILES.map((tile) => {
              const count = breakdown[tile.key] ?? 0;
              const isActive = severityFilter === tile.key;
              return (
                <button
                  key={tile.key}
                  type="button"
                  onClick={() => setSeverityFilter((cur) => (cur === tile.key ? null : tile.key))}
                  aria-pressed={isActive}
                  className={`p-4 rounded-lg border text-left transition-all ${tile.bg} ${tile.border} ${
                    isActive ? `ring-2 ${tile.ring}` : 'hover:shadow-sm'
                  }`}
                >
                  <p className={`text-xs font-semibold uppercase tracking-wider ${tile.text}`}>
                    {tile.label}
                  </p>
                  <p className={`text-3xl font-bold mt-2 tabular-nums ${tile.text}`}>
                    {count}
                  </p>
                </button>
              );
            })}
          </div>
          {severityFilter ? (
            <p className="text-xs text-stone-500 mt-2">
              Filtered to {severityFilter}.{' '}
              <button
                type="button"
                onClick={() => setSeverityFilter(null)}
                className="underline hover:text-stone-700"
              >
                Clear filter
              </button>
            </p>
          ) : null}
        </section>

        {/* ── Top risks ──────────────────────────────────────────── */}
        {summary && summary.topRisks.length > 0 ? (
          <section>
            <div className="flex items-center justify-between mb-3">
              <MetadataLabel>Top {Math.min(5, summary.topRisks.length)} risks</MetadataLabel>
              <Link
                to={`/v2/projects/${id}#gaps`}
                className="text-xs text-stone-500 hover:text-stone-900"
              >
                Triage in Gaps tab →
              </Link>
            </div>
            <div className="space-y-3">
              {(severityFilter
                ? summary.topRisks.filter((r) => r.securitySeverity === severityFilter)
                : summary.topRisks
              ).map((risk) => (
                // GapCard with no triage callbacks — the report is a
                // viewing surface, not a working surface. The "Triage
                // in Gaps tab" link in the section header points to
                // the working surface.
                <GapCard
                  key={risk.id}
                  gap={risk}
                  status={risk.status}
                />
              ))}
            </div>
          </section>
        ) : null}

        {/* ── All security gaps (collapsible) ─────────────────────── */}
        {allGaps.length > 0 ? (
          <section>
            <button
              type="button"
              onClick={() => setAllOpen((on) => !on)}
              aria-expanded={allOpen}
              className="w-full flex items-center justify-between text-left py-2 group"
            >
              <MetadataLabel>
                All security gaps ({severityFilter ? visibleAllGaps.length : allGaps.length})
              </MetadataLabel>
              <span className="text-stone-400 group-hover:text-stone-700 transition-colors">
                {allOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </span>
            </button>
            {allOpen ? (
              <div className="mt-3 space-y-5">
                {(['broken', 'missing', 'infra'] as const).map((cat) => {
                  const items = groupedAllGaps[cat] || [];
                  if (items.length === 0) return null;
                  const cm = categoryMeta(cat);
                  const CatIcon = cm.icon;
                  return (
                    <div key={cat} className="bg-white border border-stone-200 rounded-lg overflow-hidden">
                      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-stone-100 bg-stone-50">
                        <CatIcon className="w-3.5 h-3.5 text-stone-500" aria-hidden />
                        <p className="text-xs uppercase tracking-wider font-semibold text-stone-700">
                          {cm.label} <span className="text-stone-400 font-normal">· {items.length}</span>
                        </p>
                      </div>
                      <ul className="divide-y divide-stone-100">
                        {items.map((g) => (
                          <CompactRiskRow key={g.id} gap={g} projectId={id!} />
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>
        ) : null}

        {/* ── Detected by ────────────────────────────────────────── */}
        <section>
          <MetadataLabel className="mb-3">Detected by</MetadataLabel>
          <div className="bg-white border border-stone-200 rounded-lg p-5">
            {detectors.length === 0 ? (
              <p className="text-sm text-stone-500">
                No detectors registered. This shouldn't happen in production —
                please re-run analysis or contact support.
              </p>
            ) : (
              <>
                <p className="text-xs text-stone-500 mb-3">
                  This report ran {detectors.length} security detector{detectors.length === 1 ? '' : 's'} against
                  your codebase. Each looks for a specific class of issue, with conservative
                  patterns to keep false positives low.
                </p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                  {detectors.map((d) => (
                    <li key={d} className="text-xs text-stone-700 inline-flex items-center gap-1.5">
                      <FileText className="w-3 h-3 text-stone-400" aria-hidden />
                      <span className="font-mono">{d}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-stone-400 mt-3">
                  Last analyzed: {formatLastAnalyzed(lastAnalyzed)}
                </p>
              </>
            )}
          </div>
        </section>

        {/* No-findings reassurance */}
        {summary && totalUnaddressed === 0 && allGaps.length === 0 ? (
          <section className="bg-emerald-50 border border-emerald-100 rounded-lg p-6 text-center">
            <Shield className="w-8 h-8 text-emerald-600 mx-auto mb-2" aria-hidden />
            <p className="font-semibold text-stone-900">No security gaps detected</p>
            <p className="text-sm text-stone-600 mt-1">
              All {detectors.length} detector{detectors.length === 1 ? '' : 's'} ran clean.
              Re-analyze after each material change to keep this badge honest.
            </p>
          </section>
        ) : null}

      </main>
    </div>
  );
}

// Compact list row for the collapsible "All security gaps" section.
// Stays terse — title, severity, file count, and a deep-link to Gaps —
// so a project with dozens of findings doesn't blow up into pages of
// expanded cards.
function CompactRiskRow({ gap, projectId }: { gap: V2Gap; projectId: string }) {
  const sev = gap.securitySeverity;
  const sevTone = sev ? severityToneClass(sev) : 'text-stone-500';
  const filesCount = typeof gap.files === 'number' && gap.files > 0 ? gap.files : null;

  return (
    <li className="px-4 py-3 hover:bg-stone-50 transition-colors">
      <div className="flex items-start gap-3">
        <Shield className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${sevTone}`} aria-hidden />
        <div className="flex-1 min-w-0">
          <Link
            to={`/v2/projects/${projectId}#gaps`}
            className="block text-sm font-medium text-stone-900 hover:text-stone-700"
          >
            {gap.title}
          </Link>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-stone-500 mt-0.5">
            {sev ? <span className={`font-semibold ${sevTone}`}>{sev}</span> : null}
            {gap.cweId ? (
              <span className="font-mono">{gap.cweId}</span>
            ) : null}
            {gap.securityDetector ? (
              <span className="font-mono">{gap.securityDetector}</span>
            ) : null}
            {filesCount !== null ? <span>{filesCount} file{filesCount === 1 ? '' : 's'}</span> : null}
          </div>
        </div>
        <Link
          to={`/v2/projects/${projectId}#gaps`}
          aria-label="Open in Gaps tab"
          className="text-stone-400 hover:text-stone-700 flex-shrink-0 mt-0.5"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </div>
    </li>
  );
}

function severityToneClass(s: SecuritySeverity): string {
  switch (s) {
    case 'critical': return 'text-red-700';
    case 'high':     return 'text-red-500';
    case 'medium':   return 'text-amber-700';
    case 'low':      return 'text-stone-500';
  }
}
