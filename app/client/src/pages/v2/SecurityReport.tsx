import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertOctagon, ArrowRight, ChevronDown, ChevronRight, ExternalLink, EyeOff,
  FileText, RefreshCw, Server, Share2, Shield, Wrench,
} from 'lucide-react';
import {
  EmptyState, MetadataLabel, ShareSecurityModal,
} from '../../components/v2';
import Header from '../../components/Header';
import type { GapCategory, SecuritySeverity } from '../../components/v2';
import { useAuth } from '../../hooks/useAuth';
import { fetchProjectDetail } from '../../services/api';
import {
  fetchSecuritySummary, fetchSharedSecurityReport, fetchV2Gaps,
  type V2Gap,
} from '../../services/v2Api';

// ── Types ──────────────────────────────────────────────────────────

export type SecurityReportMode = 'owner' | 'shared';

interface ReportData {
  /** Display label — repo URL for owner view, possibly redacted for shared view. */
  projectName: string;
  /** Direct repo identifier (`owner/repo`). Null when redacted in a shared view. */
  repo: string | null;
  /** Optional repo URL — null when redacted. */
  repoUrl: string | null;
  framework: string | null;
  description: string | null;
  lastAnalyzed: string | null;
  /** Project id is only set in owner mode — used for "Fix this gap" deep links. */
  projectId: string | null;
  score: number | null;
  severityBreakdown: { critical: number; high: number; medium: number; low: number };
  totalUnaddressed: number;
  topRisks: V2Gap[];
  allSecurityGaps: { broken: V2Gap[]; missing: V2Gap[]; infra: V2Gap[] };
  detectors: string[];
  /** True when the source share record was generated with redact_repo. */
  redacted: boolean;
}

export interface SecurityReportProps {
  mode?: SecurityReportMode;
}

// ── Pure helpers ───────────────────────────────────────────────────

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

const CATEGORY_META: Record<GapCategory, {
  label: string;
  icon: typeof AlertOctagon;
  pillBg: string;
  pillText: string;
  pillBorder: string;
}> = {
  broken:  { label: 'Broken',                  icon: AlertOctagon, pillBg: 'bg-red-50',    pillText: 'text-red-700',    pillBorder: 'border-red-200' },
  missing: { label: 'Missing Functionality',   icon: Wrench,       pillBg: 'bg-amber-50',  pillText: 'text-amber-800',  pillBorder: 'border-amber-200' },
  infra:   { label: 'Missing Infrastructure',  icon: Server,       pillBg: 'bg-stone-100', pillText: 'text-stone-700',  pillBorder: 'border-stone-300' },
};

const SEVERITY_PILL: Record<SecuritySeverity, { bg: string; text: string; border: string }> = {
  critical: { bg: 'bg-red-100',    text: 'text-red-700',    border: 'border-red-200' },
  high:     { bg: 'bg-red-50',     text: 'text-red-600',    border: 'border-red-100' },
  medium:   { bg: 'bg-amber-50',   text: 'text-amber-700',  border: 'border-amber-200' },
  low:      { bg: 'bg-stone-100',  text: 'text-stone-700',  border: 'border-stone-200' },
};

function severityToneClass(s: SecuritySeverity): string {
  switch (s) {
    case 'critical': return 'text-red-700';
    case 'high':     return 'text-red-500';
    case 'medium':   return 'text-amber-700';
    case 'low':      return 'text-stone-500';
  }
}

function cweUrl(cwe: string): string {
  const num = String(cwe).replace(/[^0-9]/g, '');
  return num ? `https://cwe.mitre.org/data/definitions/${num}.html` : 'https://cwe.mitre.org/';
}

function categoryMeta(category: string) {
  if (category === 'broken')  return { label: 'Broken',                 icon: AlertOctagon };
  if (category === 'missing') return { label: 'Missing Functionality',  icon: Wrench };
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

// ── Component ──────────────────────────────────────────────────────

export default function SecurityReport({ mode = 'owner' }: SecurityReportProps = {}) {
  const params = useParams<{ id?: string; slug?: string }>();
  const navigate = useNavigate();
  const auth = useAuth();
  const isShared = mode === 'shared';

  const [data, setData] = useState<ReportData | null>(null);
  // Tracks the in-flight project status separately from `data` so an
  // "analyzing" project can short-circuit to the takeoff route without
  // crashing the rest of the page.
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<number | null>(null);

  const [severityFilter, setSeverityFilter] = useState<SecuritySeverity | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  // ── Data loaders ────────────────────────────────────────────────
  //
  // The two modes have very different data shapes upstream — owner
  // mode hits three authed endpoints and the shared mode hits one
  // public endpoint that bundles everything. Both adapt to the same
  // internal `ReportData` so the render path below stays single.

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setErrorCode(null);

    async function loadOwner() {
      const id = params.id;
      if (!id) throw new Error('Missing project id');
      const [project, summary, gaps] = await Promise.all([
        fetchProjectDetail(id),
        fetchSecuritySummary(id),
        fetchV2Gaps(id).catch(() => ({ broken: [], missing: [], infra: [] } as { broken: V2Gap[]; missing: V2Gap[]; infra: V2Gap[] })),
      ]);
      if (cancelled) return;
      if (project.status === 'analyzing' || project.status === 'pending') {
        setPendingStatus(project.status);
        return;
      }
      const securityGaps = {
        broken:  gaps.broken.filter((g) => g.isSecurity === true),
        missing: gaps.missing.filter((g) => g.isSecurity === true),
        infra:   gaps.infra.filter((g) => g.isSecurity === true),
      };
      setData({
        projectName: project.repo || project.repo_url,
        repo: project.repo || null,
        repoUrl: project.repo_url || null,
        framework: project.framework,
        description: project.description,
        lastAnalyzed: summary.lastAnalyzed ?? project.updated_at ?? null,
        projectId: project.id,
        score: typeof summary.score === 'number'
          ? summary.score
          : (typeof project.security_score === 'number' ? project.security_score : null),
        severityBreakdown: summary.severityBreakdown,
        totalUnaddressed: summary.totalUnaddressed,
        topRisks: summary.topRisks,
        allSecurityGaps: securityGaps,
        detectors: summary.detectors,
        redacted: false,
      });
    }

    async function loadShared() {
      const slug = params.slug;
      if (!slug) throw new Error('Missing share slug');
      const r = await fetchSharedSecurityReport(slug);
      if (cancelled) return;
      setData({
        projectName: r.project.name,
        repo: r.project.repo,
        repoUrl: r.project.repoUrl,
        framework: r.project.framework,
        description: r.project.description,
        lastAnalyzed: r.project.lastAnalyzed,
        projectId: null,
        score: r.score,
        severityBreakdown: r.severityBreakdown,
        totalUnaddressed: r.totalUnaddressed,
        topRisks: r.topRisks,
        allSecurityGaps: r.allSecurityGaps,
        detectors: r.detectors,
        redacted: r.share.redactRepo,
      });
    }

    (isShared ? loadShared() : loadOwner())
      .catch((err: unknown) => {
        if (cancelled) return;
        const e = err as { message?: string; status?: number };
        setError(e?.message ?? 'Failed to load security report');
        setErrorCode(typeof e?.status === 'number' ? e.status : null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [isShared, params.id, params.slug]);

  // Owner-mode: bounce in-flight projects to the takeoff progress page
  // exactly like the project workspace does. Effect rather than inline
  // navigate-during-render to satisfy React's render purity.
  useEffect(() => {
    if (mode === 'owner' && pendingStatus && params.id) {
      navigate(`/takeoff/${params.id}`, { replace: true });
    }
  }, [mode, pendingStatus, params.id, navigate]);

  const reAnalyze = useCallback(() => {
    if (params.id) navigate(`/takeoff/${params.id}`);
  }, [params.id, navigate]);

  const visibleAllGaps = useMemo(() => {
    if (!data) return [] as V2Gap[];
    const flat = [...data.allSecurityGaps.broken, ...data.allSecurityGaps.missing, ...data.allSecurityGaps.infra];
    if (!severityFilter) return flat;
    return flat.filter((g) => g.securitySeverity === severityFilter);
  }, [data, severityFilter]);

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

  // ── Loading + error states ──────────────────────────────────────

  if (loading || (mode === 'owner' && pendingStatus)) {
    return (
      <div className="min-h-screen bg-stone-50 v2-font-sans flex items-center justify-center">
        <div className="text-stone-500 text-sm">Loading security report…</div>
      </div>
    );
  }

  if (error || !data) {
    const isGone = errorCode === 410;
    return (
      <div className="min-h-screen bg-stone-50 v2-font-sans flex items-center justify-center px-6">
        <EmptyState
          icon={Shield}
          title={isGone ? 'This share link is no longer active' : "Couldn't load this security report"}
          description={isGone
            ? 'The link has been revoked or has expired. Ask the project owner for a new one.'
            : (error ?? 'Project not found.')}
        />
      </div>
    );
  }

  const breakdown = data.severityBreakdown;
  const totalUnaddressed = data.totalUnaddressed;
  const detectors = data.detectors;
  const verdict = typeof data.score === 'number' ? verdictFor(data.score) : null;
  const filteredTopRisks = severityFilter
    ? data.topRisks.filter((r) => r.securitySeverity === severityFilter)
    : data.topRisks;

  // Visibility rules for admin affordances. We default to "hide" in
  // shared mode; owner-mode visibility additionally requires that the
  // user is signed in *or* the project is public-readable. We don't
  // know "public-readable" from the client perspective directly, but
  // an unauthenticated user reaching /v2/projects/:id/security has
  // already loaded data without a 401, so it's safe to assume the
  // project is public — but we still hide the Share button because
  // anonymous users can't create shares anyway.
  const showAdminActions = !isShared;
  const showShareButton  = !isShared && !!auth.user;

  return (
    <div className="min-h-screen bg-stone-50 v2-font-sans">
      <Header
        variant="workspace"
        title={data.projectName}
        subtitle={
          <>
            <Shield className="w-3 h-3" aria-hidden />
            Security Report · {formatLastAnalyzed(data.lastAnalyzed)}
            {data.redacted ? (
              <span className="inline-flex items-center gap-1 text-amber-700 ml-2">
                <EyeOff className="w-3 h-3" aria-hidden />
                Redacted
              </span>
            ) : null}
          </>
        }
        actions={
          <>
            {showAdminActions ? (
              <Link
                to={`/projects/${params.id}#gaps`}
                className="text-xs text-stone-600 hover:text-stone-900 px-3 py-1.5 rounded border border-stone-200 hover:border-stone-400 transition-colors"
              >
                ← Back to project
              </Link>
            ) : null}
            {showShareButton ? (
              <button
                type="button"
                onClick={() => setShareModalOpen(true)}
                className="text-xs text-stone-700 bg-white hover:bg-stone-50 border border-stone-300 px-3 py-1.5 rounded inline-flex items-center gap-1.5 transition-colors"
              >
                <Share2 className="w-3 h-3" aria-hidden />
                Share
              </button>
            ) : null}
            {showAdminActions ? (
              <button
                type="button"
                onClick={reAnalyze}
                className="text-xs text-white bg-stone-900 hover:bg-stone-800 px-3 py-1.5 rounded inline-flex items-center gap-1.5 transition-colors"
              >
                <RefreshCw className="w-3 h-3" aria-hidden />
                Re-analyze
              </button>
            ) : null}
          </>
        }
      />

      <main className="max-w-5xl mx-auto px-6 py-12 space-y-12">

        {/* ── Score hero ─────────────────────────────────────────── */}
        <section className="text-center">
          <p className="text-xs uppercase tracking-widest text-stone-500 mb-3">Security Score</p>
          {typeof data.score === 'number' ? (
            <>
              <div className="inline-flex items-baseline gap-2">
                <span className="text-7xl font-bold text-stone-900 tracking-tight tabular-nums v2-font-serif">
                  {data.score}
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
            <p className="text-stone-500 text-sm">No security score yet.</p>
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
        {filteredTopRisks.length > 0 ? (
          <section>
            <div className="flex items-center justify-between mb-3">
              <MetadataLabel>Top {Math.min(5, filteredTopRisks.length)} risks</MetadataLabel>
              {showAdminActions ? (
                <Link
                  to={`/projects/${params.id}#gaps`}
                  className="text-xs text-stone-500 hover:text-stone-900"
                >
                  Triage in Gaps tab →
                </Link>
              ) : null}
            </div>
            <div className="space-y-3">
              {filteredTopRisks.map((risk) => (
                <TopRiskCard
                  key={risk.id}
                  gap={risk}
                  fixHref={showAdminActions && data.projectId ? `/projects/${data.projectId}#gaps` : null}
                />
              ))}
            </div>
          </section>
        ) : null}

        {/* ── All security gaps (collapsible) ─────────────────────── */}
        {(data.allSecurityGaps.broken.length + data.allSecurityGaps.missing.length + data.allSecurityGaps.infra.length) > 0 ? (
          <section>
            <button
              type="button"
              onClick={() => setAllOpen((on) => !on)}
              aria-expanded={allOpen}
              className="w-full flex items-center justify-between text-left py-2 group"
            >
              <MetadataLabel>
                All security gaps (
                  {severityFilter
                    ? visibleAllGaps.length
                    : data.allSecurityGaps.broken.length + data.allSecurityGaps.missing.length + data.allSecurityGaps.infra.length}
                )
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
                          <CompactRiskRow
                            key={g.id}
                            gap={g}
                            fixHref={showAdminActions && data.projectId ? `/projects/${data.projectId}#gaps` : null}
                          />
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
                  the codebase. Each looks for a specific class of issue, with conservative
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
                  Last analyzed: {formatLastAnalyzed(data.lastAnalyzed)}
                </p>
              </>
            )}
          </div>
        </section>

        {/* No-findings reassurance */}
        {totalUnaddressed === 0
          && (data.allSecurityGaps.broken.length + data.allSecurityGaps.missing.length + data.allSecurityGaps.infra.length) === 0
          ? (
          <section className="bg-emerald-50 border border-emerald-100 rounded-lg p-6 text-center">
            <Shield className="w-8 h-8 text-emerald-600 mx-auto mb-2" aria-hidden />
            <p className="font-semibold text-stone-900">No security gaps detected</p>
            <p className="text-sm text-stone-600 mt-1">
              All {detectors.length} detector{detectors.length === 1 ? '' : 's'} ran clean.
              {showAdminActions ? ' Re-analyze after each material change to keep this badge honest.' : null}
            </p>
          </section>
        ) : null}

        {/* ── Shared-only footer CTA ─────────────────────────────── */}
        {isShared ? (
          <section className="border-t border-stone-200 pt-8 mt-8 text-center">
            <p className="text-sm text-stone-700">
              This report was generated by Takeoff.
            </p>
            <p className="text-sm text-stone-500 mt-1">Want to audit your own app?</p>
            <a
              href="/"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-stone-900 hover:text-stone-700"
            >
              Get a security report <ArrowRight className="w-3.5 h-3.5" aria-hidden />
            </a>
          </section>
        ) : null}

      </main>

      {/* ── Owner-only: Share modal ──────────────────────────────── */}
      {showShareButton && data.projectId ? (
        <ShareSecurityModal
          open={shareModalOpen}
          onClose={() => setShareModalOpen(false)}
          projectId={data.projectId}
        />
      ) : null}
    </div>
  );
}

// ── TopRiskCard ────────────────────────────────────────────────────
//
// Read-only card for the "Top 5 risks" section. Mirrors the visual
// language of GapCard's security shield + callout (Phase 2a) but
// strips out triage controls — the report is a viewing surface.
// `fixHref` adds a "Fix this gap →" deep link when set; in shared
// mode it's null and the CTA is omitted.
function TopRiskCard({ gap, fixHref }: { gap: V2Gap; fixHref: string | null }) {
  const cat = (gap.category as GapCategory) || 'broken';
  const cm = CATEGORY_META[cat];
  const CatIcon = cm.icon;
  const sev = gap.securitySeverity;
  const sevPill = sev ? SEVERITY_PILL[sev] : null;
  const filesCount = typeof gap.files === 'number' && gap.files > 0 ? gap.files : null;
  return (
    <article className={`bg-white border ${cm.pillBorder} rounded-lg p-5`}>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold border rounded-full px-2 py-0.5 ${cm.pillBg} ${cm.pillText} ${cm.pillBorder}`}>
          <CatIcon className="w-3 h-3" aria-hidden /> {cm.label}
        </span>
        {sev && sevPill ? (
          <span
            className={`inline-flex items-center gap-1 text-[11px] font-semibold border rounded-full px-2 py-0.5 ${sevPill.bg} ${sevPill.text} ${sevPill.border}`}
            aria-label={`Severity ${sev}`}
          >
            <Shield className="w-3 h-3" aria-hidden /> Security · {sev[0].toUpperCase() + sev.slice(1)}
          </span>
        ) : null}
        {gap.effort ? (
          <>
            <span className="text-xs text-stone-500">·</span>
            <span className="text-xs text-stone-500">{gap.effort} effort</span>
          </>
        ) : null}
        {filesCount !== null ? (
          <>
            <span className="text-xs text-stone-500">·</span>
            <span className="text-xs text-stone-500">{filesCount} file{filesCount === 1 ? '' : 's'}</span>
          </>
        ) : null}
      </div>
      <h4 className="font-semibold text-stone-900 mb-1.5">{gap.title}</h4>
      <p className="text-sm text-stone-600 leading-relaxed mb-3">{gap.description}</p>
      {sev ? (
        <div className="mb-3 px-3 py-2 bg-red-50/50 border border-red-100 rounded-md">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-red-700 mb-0.5">
            <Shield className="w-3 h-3" aria-hidden />
            Why this is a security risk
          </div>
          <div className="text-xs text-stone-600 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>
              Severity <span className={`font-medium ${severityToneClass(sev)}`}>{sev}</span>
            </span>
            {gap.cweId ? (
              <>
                <span aria-hidden className="text-stone-300">·</span>
                <a
                  href={cweUrl(gap.cweId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-red-700 hover:text-red-800 underline-offset-2 hover:underline"
                >
                  {gap.cweId}
                  <ExternalLink className="w-2.5 h-2.5 inline-block ml-0.5 -mt-0.5" aria-hidden />
                </a>
              </>
            ) : null}
            {gap.securityDetector ? (
              <>
                <span aria-hidden className="text-stone-300">·</span>
                <span>
                  Detected by <span className="font-mono text-stone-700">{gap.securityDetector}</span>
                </span>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      {fixHref ? (
        <Link
          to={fixHref}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-900 hover:text-stone-700"
        >
          Fix this gap <ArrowRight className="w-3.5 h-3.5" aria-hidden />
        </Link>
      ) : null}
    </article>
  );
}

// ── CompactRiskRow ─────────────────────────────────────────────────
//
// One-line list entry for the collapsible "All security gaps" section.
// `fixHref` controls whether the row is link-wrapped (owner mode) or
// rendered as plain text (shared mode), so a public viewer never gets
// dead links to the auth-gated Gaps tab.
function CompactRiskRow({ gap, fixHref }: { gap: V2Gap; fixHref: string | null }) {
  const sev = gap.securitySeverity;
  const sevTone = sev ? severityToneClass(sev) : 'text-stone-500';
  const filesCount = typeof gap.files === 'number' && gap.files > 0 ? gap.files : null;
  const titleEl = fixHref
    ? (
      <Link to={fixHref} className="block text-sm font-medium text-stone-900 hover:text-stone-700">
        {gap.title}
      </Link>
    )
    : <span className="block text-sm font-medium text-stone-900">{gap.title}</span>;
  return (
    <li className="px-4 py-3 hover:bg-stone-50 transition-colors">
      <div className="flex items-start gap-3">
        <Shield className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${sevTone}`} aria-hidden />
        <div className="flex-1 min-w-0">
          {titleEl}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-stone-500 mt-0.5">
            {sev ? <span className={`font-semibold ${sevTone}`}>{sev}</span> : null}
            {gap.cweId ? <span className="font-mono">{gap.cweId}</span> : null}
            {gap.securityDetector ? <span className="font-mono">{gap.securityDetector}</span> : null}
            {filesCount !== null ? <span>{filesCount} file{filesCount === 1 ? '' : 's'}</span> : null}
          </div>
        </div>
        {fixHref ? (
          <Link
            to={fixHref}
            aria-label="Open in Gaps tab"
            className="text-stone-400 hover:text-stone-700 flex-shrink-0 mt-0.5"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        ) : null}
      </div>
    </li>
  );
}
