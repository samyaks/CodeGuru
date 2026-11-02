import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertOctagon, ArrowRight, ChevronDown, ChevronRight, ExternalLink, EyeOff,
  FileText, RefreshCw, Server, Share2, Shield, Wrench,
} from 'lucide-react';
import {
  EmptyState, MetadataLabel, ShareSecurityModal, ReanalyzeModal,
} from '../../components/v2';
import Header from '../../components/Header';
import type { SecuritySeverity } from '../../components/v2';
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
  good: 'text-cleared',
  okay: 'text-ink-muted',
  warn: 'text-holding',
  bad:  'text-grounded',
};

const SEVERITY_TILES: Array<{
  key: SecuritySeverity;
  label: string;
  bg: string;
  text: string;
  border: string;
  ring: string;
}> = [
  { key: 'critical', label: 'Critical', bg: 'bg-grounded-soft',    text: 'text-grounded',    border: 'border-grounded',   ring: 'ring-grounded' },
  { key: 'high',     label: 'High',     bg: 'bg-grounded-soft',    text: 'text-grounded',    border: 'border-grounded',   ring: 'ring-grounded' },
  { key: 'medium',   label: 'Medium',   bg: 'bg-holding-soft',  text: 'text-holding',  border: 'border-holding', ring: 'ring-holding' },
  { key: 'low',      label: 'Low',      bg: 'bg-paper-sunk', text: 'text-ink',  border: 'border-line', ring: 'ring-line-strong' },
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

function severityToneClass(s: SecuritySeverity): string {
  switch (s) {
    case 'critical': return 'text-grounded';
    case 'high':     return 'text-grounded';
    case 'medium':   return 'text-holding';
    case 'low':      return 'text-ink-muted';
  }
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
  const [reanalyzeModalOpen, setReanalyzeModalOpen] = useState(false);
  // Bumped by the Retry button on the load-error empty state to
  // re-trigger the loader useEffect below. Cheaper than extracting
  // the (mode-switching, dual-shape) async loader into a reusable
  // callback.
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const reload = useCallback(() => setReloadTrigger((n) => n + 1), []);

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
  }, [isShared, params.id, params.slug, reloadTrigger]);

  // Owner-mode: bounce in-flight projects to the takeoff progress page
  // exactly like the project workspace does. Effect rather than inline
  // navigate-during-render to satisfy React's render purity.
  useEffect(() => {
    if (mode === 'owner' && pendingStatus && params.id) {
      navigate(`/takeoff/${params.id}`, { replace: true });
    }
  }, [mode, pendingStatus, params.id, navigate]);

  // Open the confirmation modal. The actual POST + navigation happens
  // in `handleReanalyzeTriggered` below, called by the modal once the
  // server returns 202. We don't unconditionally navigate to /takeoff
  // anymore — the previous behavior bounced users to a no-op progress
  // page that replayed the cached `complete` event from the prior run.
  const reAnalyze = useCallback(() => {
    if (params.id) setReanalyzeModalOpen(true);
  }, [params.id]);

  const handleReanalyzeTriggered = useCallback((projectId: string) => {
    setReanalyzeModalOpen(false);
    navigate(`/takeoff/${projectId}`);
  }, [navigate]);

  // Local uploads (`local://…`) can't be re-analyzed because we don't
  // persist the original files. Hide the button on this page rather
  // than show a button that always errors. SettingsSection.tsx uses
  // the same `local://` check on `repoUrl`.
  const isLocalProject = typeof data?.repoUrl === 'string' && data.repoUrl.startsWith('local://');

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
      <div className="takeoff min-h-screen bg-paper v2-font-sans flex items-center justify-center" data-theme="light">
        <div className="text-ink-muted text-sm">Loading security report…</div>
      </div>
    );
  }

  if (error || !data) {
    const isGone = errorCode === 410;
    return (
      <div className="takeoff min-h-screen bg-paper v2-font-sans flex items-center justify-center px-6" data-theme="light">
        <EmptyState
          icon={Shield}
          title={isGone ? 'This share link is no longer active' : "Couldn't load this security report"}
          description={isGone
            ? 'The link has been revoked or has expired. Ask the project owner for a new one.'
            : (error ?? 'Project not found.')}
          /* No Retry for the 410 case — the share link is
             permanently revoked, retrying won't bring it back.
             Generic errors (network blips, 5xx) get a Retry. */
          action={isGone ? undefined : (
            <button
              type="button"
              onClick={reload}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-ink bg-paper-raised border border-line-strong rounded hover:bg-paper-sunk transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
            </button>
          )}
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
    <div className="takeoff min-h-screen bg-paper v2-font-sans" data-theme="light">
      <Header
        variant="takeoff"
        backTo={showAdminActions ? `/read/${params.id}#build` : undefined}
        actions={
          <>
            {showAdminActions ? (
              <Link
                to={`/read/${params.id}#build`}
                className="text-xs text-ink-muted hover:text-ink px-3 py-1.5 rounded border border-line hover:border-line-strong transition-colors"
              >
                ← Back to project
              </Link>
            ) : null}
            {showShareButton ? (
              <button
                type="button"
                onClick={() => setShareModalOpen(true)}
                className="text-xs text-ink bg-paper-raised hover:bg-paper-sunk border border-line-strong px-3 py-1.5 rounded inline-flex items-center gap-1.5 transition-colors"
              >
                <Share2 className="w-3 h-3" aria-hidden />
                Share
              </button>
            ) : null}
            {showAdminActions && !isLocalProject ? (
              <button
                type="button"
                onClick={reAnalyze}
                className="text-xs text-on-night bg-night hover:bg-night px-3 py-1.5 rounded inline-flex items-center gap-1.5 transition-colors"
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
          <p className="type-eyebrow text-ink-muted mb-2">{data.projectName}</p>
          <p className="text-xs uppercase tracking-widest text-ink-muted mb-3">
            Security score
            {data.redacted ? ' · redacted' : ''}
            {data.lastAnalyzed ? ` · ${formatLastAnalyzed(data.lastAnalyzed)}` : ''}
          </p>
          {typeof data.score === 'number' ? (
            <>
              <div className="inline-flex items-baseline gap-2">
                <span className="text-7xl font-bold text-ink tracking-tight tabular-nums v2-font-serif">
                  {data.score}
                </span>
                <span className="text-2xl text-ink-muted font-light">/ 100</span>
              </div>
              {verdict ? (
                <p className={`mt-3 text-base font-medium ${VERDICT_COLOR[verdict.tone]}`}>
                  {verdict.headline}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-ink-muted">
                {totalUnaddressed === 0
                  ? 'No unaddressed findings.'
                  : `${totalUnaddressed} unaddressed ${totalUnaddressed === 1 ? 'finding' : 'findings'}.`}
              </p>
            </>
          ) : (
            <p className="text-ink-muted text-sm">No security score yet.</p>
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
            <p className="text-xs text-ink-muted mt-2">
              Filtered to {severityFilter}.{' '}
              <button
                type="button"
                onClick={() => setSeverityFilter(null)}
                className="underline hover:text-ink"
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
                  to={`/read/${params.id}#build`}
                  className="text-xs text-ink-muted hover:text-ink"
                >
                  Triage in Gaps tab →
                </Link>
              ) : null}
            </div>
            <div className="bg-paper-raised border border-line rounded-lg overflow-hidden">
              <ul className="divide-y divide-line">
                {filteredTopRisks.map((risk) => (
                  <CompactRiskRow
                    key={risk.id}
                    gap={risk}
                    fixHref={showAdminActions && data.projectId
                      ? `/read/${data.projectId}?focus=${encodeURIComponent(risk.id)}#build`
                      : null}
                  />
                ))}
              </ul>
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
              <span className="text-ink-muted group-hover:text-ink transition-colors">
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
                    <div key={cat} className="bg-paper-raised border border-line rounded-lg overflow-hidden">
                      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-line bg-paper-sunk">
                        <CatIcon className="w-3.5 h-3.5 text-ink-muted" aria-hidden />
                        <p className="text-xs uppercase tracking-wider font-semibold text-ink">
                          {cm.label} <span className="text-ink-muted font-normal">· {items.length}</span>
                        </p>
                      </div>
                      <ul className="divide-y divide-line">
                        {items.map((g) => (
                          <CompactRiskRow
                            key={g.id}
                            gap={g}
                            fixHref={showAdminActions && data.projectId
                              ? `/read/${data.projectId}?focus=${encodeURIComponent(g.id)}#build`
                              : null}
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
          <div className="bg-paper-raised border border-line rounded-lg p-5">
            {detectors.length === 0 ? (
              <p className="text-sm text-ink-muted">
                No detectors registered. This shouldn't happen in production —
                please re-run analysis or contact support.
              </p>
            ) : (
              <>
                <p className="text-xs text-ink-muted mb-3">
                  This report ran {detectors.length} security detector{detectors.length === 1 ? '' : 's'} against
                  the codebase. Each looks for a specific class of issue, with conservative
                  patterns to keep false positives low.
                </p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                  {detectors.map((d) => (
                    <li key={d} className="text-xs text-ink inline-flex items-center gap-1.5">
                      <FileText className="w-3 h-3 text-ink-muted" aria-hidden />
                      <span className="font-mono">{d}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-ink-muted mt-3">
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
          <section className="bg-cleared-soft border border-cleared rounded-lg p-6 text-center">
            <Shield className="w-8 h-8 text-cleared mx-auto mb-2" aria-hidden />
            <p className="font-semibold text-ink">No security gaps detected</p>
            <p className="text-sm text-ink-muted mt-1">
              All {detectors.length} detector{detectors.length === 1 ? '' : 's'} ran clean.
              {showAdminActions ? ' Re-analyze after each material change to keep this badge honest.' : null}
            </p>
          </section>
        ) : null}

        {/* ── Shared-only footer CTA ─────────────────────────────── */}
        {isShared ? (
          <section className="border-t border-line pt-8 mt-8 text-center">
            <p className="text-sm text-ink">
              This report was generated by Takeoff.
            </p>
            <p className="text-sm text-ink-muted mt-1">Want to audit your own app?</p>
            <a
              href="/"
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-ink hover:text-ink"
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

      {/* ── Owner-only: Re-analyze confirmation ─────────────────── */}
      {showAdminActions && data.projectId && !isLocalProject ? (
        <ReanalyzeModal
          open={reanalyzeModalOpen}
          onClose={() => setReanalyzeModalOpen(false)}
          projectId={data.projectId}
          projectLabel={data.projectName}
          onTriggered={handleReanalyzeTriggered}
        />
      ) : null}
    </div>
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
  const sevTone = sev ? severityToneClass(sev) : 'text-ink-muted';
  const filesCount = typeof gap.files === 'number' && gap.files > 0 ? gap.files : null;
  const titleEl = fixHref
    ? (
      <Link to={fixHref} className="block text-sm font-medium text-ink hover:text-ink">
        {gap.title}
      </Link>
    )
    : <span className="block text-sm font-medium text-ink">{gap.title}</span>;
  return (
    <li className="px-4 py-3 hover:bg-paper-sunk transition-colors">
      <div className="flex items-start gap-3">
        <Shield className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${sevTone}`} aria-hidden />
        <div className="flex-1 min-w-0">
          {titleEl}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-muted mt-0.5">
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
            className="text-ink-muted hover:text-ink flex-shrink-0 mt-0.5"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        ) : null}
      </div>
    </li>
  );
}
