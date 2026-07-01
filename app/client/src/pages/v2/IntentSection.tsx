import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown, ChevronRight, RefreshCw, Target, CheckCheck, Download, Sparkles,
  Wrench, Unlink, AlertTriangle, X,
} from 'lucide-react';
import { EmptyState, ProgressBar } from '../../components/v2';
import { IntentStatementCard } from '../../components/v2/IntentStatementCard';
import { INTENT_MOCK } from '../../components/v2/intentMock';
import {
  fetchIntent, confirmStatement, editStatement, rejectStatement, restoreStatement,
  fetchIntentSpec, fetchIntentTriage, applyRelink, markLinkBroken, fetchIntentGaps,
  type IntentListResponse, type IntentAreaGroup, type IntentStatement,
  type IntentEditPayload, type IntentStatus, type IntentLink,
  type IntentTriageItem, type IntentGap,
} from '../../services/intentApi';

type Filter = 'candidate' | 'confirmed' | 'rejected';

export interface IntentSectionProps {
  projectId: string;
}

function areaKey(area: IntentAreaGroup): string {
  return area.featureArea ?? '__unassigned__';
}

function areaTitle(area: IntentAreaGroup): string {
  return area.featureArea ?? 'Unassigned';
}

type VisibleArea = { area: IntentAreaGroup; statements: IntentStatement[] };

interface JobGroup {
  key: string;
  title: string | null;
  priority: 'high' | 'medium' | 'low' | null;
  areas: VisibleArea[];
}
interface PersonaGroup {
  key: string;
  name: string | null;
  emoji: string | null;
  jobs: JobGroup[];
}

// Fold the flat feature areas into a Persona -> Job -> Feature tree, preserving
// the server's (sort_order-based) area ordering. Used to render intent as a
// plan. When no synthesis metadata is present every area lands under a single
// null persona/job, which the renderer shows as a flat list (back-compat).
function groupByPersonaJob(visible: VisibleArea[]): PersonaGroup[] {
  const personas: PersonaGroup[] = [];
  const personaByKey = new Map<string, PersonaGroup>();

  for (const v of visible) {
    const pName = v.area.persona?.name ?? null;
    const pKey = pName ?? '__none__';
    let persona = personaByKey.get(pKey);
    if (!persona) {
      persona = { key: pKey, name: pName, emoji: v.area.persona?.emoji ?? null, jobs: [] };
      personaByKey.set(pKey, persona);
      personas.push(persona);
    }
    const jTitle = v.area.job?.title ?? null;
    const jKey = jTitle ?? '__none__';
    let job = persona.jobs.find((j) => j.key === jKey);
    if (!job) {
      job = { key: jKey, title: jTitle, priority: v.area.job?.priority ?? null, areas: [] };
      persona.jobs.push(job);
    }
    job.areas.push(v);
  }
  return personas;
}

const PRIORITY_STYLES: Record<string, string> = {
  high: 'bg-rose-50 text-rose-700 border-rose-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-stone-100 text-stone-500 border-stone-200',
};

// Edited links come back from the form without a health status; until Phase 5
// reconciles them we treat every human-supplied anchor as healthy.
function toLinks(links: NonNullable<IntentEditPayload['links']>): IntentLink[] {
  return links.map((l) => ({ filePath: l.filePath, symbol: l.symbol, linkStatus: 'healthy' as const }));
}

// Uniquely identifies a triage row by the statement + the specific link on it.
function triageKey(item: IntentTriageItem): string {
  return `${item.statementId}::${item.link.filePath}::${item.link.symbol ?? ''}`;
}

export function IntentSection({ projectId }: IntentSectionProps) {
  const [areas, setAreas] = useState<IntentAreaGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('candidate');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyArea, setBusyArea] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [specBusy, setSpecBusy] = useState(false);
  // True when the backend 501'd and we swapped in the dev fixture. Mutations
  // then stay optimistic instead of reverting, so the demo flow works.
  const [usingMock, setUsingMock] = useState(false);
  const usingMockRef = useRef(false);
  usingMockRef.current = usingMock;

  // Phase 5 (link triage) + Phase 6 (drift) surfaces. These ride on separate
  // endpoints that may 501 independently of the main list, so they get their
  // own state and degrade to empty rather than taking down the whole section.
  const [triage, setTriage] = useState<IntentTriageItem[]>([]);
  const [triageBusyKey, setTriageBusyKey] = useState<string | null>(null);
  const [gaps, setGaps] = useState<IntentGap[]>([]);
  const [driftDismissed, setDriftDismissed] = useState(false);

  const applyResponse = useCallback((data: IntentListResponse) => {
    setAreas(data.areas);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchIntent(projectId);
      applyResponse(data);
      setUsingMock(false);
    } catch (err) {
      // DEV FALLBACK: the Phase 4 backend endpoints return HTTP 501 until they
      // land. In dev builds we render a realistic fixture so the review UI is
      // demoable end-to-end; in production we surface the real error + Retry.
      if (import.meta.env.DEV) {
        applyResponse(INTENT_MOCK);
        setUsingMock(true);
      } else {
        setError((err as Error).message ?? 'Failed to load intent');
      }
    } finally {
      setLoading(false);
    }
  }, [projectId, applyResponse]);

  useEffect(() => { void reload(); }, [reload]);

  // Link-triage list (Phase 5). Guarded so we never call it while on the dev
  // fixture (the endpoint 501s there); on any handled failure we quietly show
  // no triage rather than a hard error.
  const reloadTriage = useCallback(async () => {
    if (usingMockRef.current) { setTriage([]); return; }
    try {
      setTriage(await fetchIntentTriage(projectId));
    } catch {
      setTriage([]);
    }
  }, [projectId]);

  // Drift gaps (Phase 6). Same degrade-to-empty contract as triage.
  const reloadGaps = useCallback(async () => {
    if (usingMockRef.current) { setGaps([]); return; }
    try {
      setGaps(await fetchIntentGaps(projectId));
    } catch {
      setGaps([]);
    }
  }, [projectId]);

  // Fetch the additive surfaces once the main list settles. On the mock
  // fixture (or a load error) we skip them entirely so a handled 501 doesn't
  // spam the network tab.
  useEffect(() => {
    if (loading || error) return;
    if (usingMock) { setTriage([]); setGaps([]); return; }
    void reloadTriage();
    void reloadGaps();
  }, [loading, error, usingMock, reloadTriage, reloadGaps]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const findStatement = useCallback(
    (id: string): IntentStatement | undefined => {
      for (const a of areas) {
        const s = a.statements.find((st) => st.id === id);
        if (s) return s;
      }
      return undefined;
    },
    [areas],
  );

  const replaceStatement = useCallback((updated: IntentStatement) => {
    setAreas((prev) =>
      prev.map((a) => ({
        ...a,
        statements: a.statements.map((s) => (s.id === updated.id ? updated : s)),
      })),
    );
  }, []);

  // Shared optimistic-transition helper. We flip local state immediately for a
  // snappy feel, then call the API. On failure we revert — unless we're on the
  // mock fixture, where the endpoint is expected to 501 and the optimistic
  // state is the whole point.
  const runMutation = useCallback(
    async (
      id: string,
      optimistic: (s: IntentStatement) => IntentStatement,
      apiCall: () => Promise<IntentStatement>,
      errLabel: string,
    ) => {
      const prev = findStatement(id);
      if (!prev) return;
      setBusyId(id);
      replaceStatement(optimistic(prev));
      try {
        const updated = await apiCall();
        replaceStatement(updated);
      } catch (err) {
        if (usingMockRef.current) {
          // Keep the optimistic state — backend not implemented yet.
        } else {
          replaceStatement(prev);
          setToast(`${errLabel}: ${(err as Error).message}`);
        }
      } finally {
        setBusyId(null);
      }
    },
    [findStatement, replaceStatement],
  );

  const onAccept = useCallback(
    (id: string) => runMutation(
      id,
      (s) => ({ ...s, status: 'confirmed' }),
      () => confirmStatement(projectId, id),
      "Couldn't confirm",
    ),
    [projectId, runMutation],
  );

  const onReject = useCallback(
    (id: string) => runMutation(
      id,
      (s) => ({ ...s, status: 'rejected' }),
      () => rejectStatement(projectId, id),
      "Couldn't reject",
    ),
    [projectId, runMutation],
  );

  const onRestore = useCallback(
    (id: string) => runMutation(
      id,
      (s) => ({ ...s, status: 'candidate' }),
      () => restoreStatement(projectId, id),
      "Couldn't restore",
    ),
    [projectId, runMutation],
  );

  const onEdit = useCallback(
    (id: string, payload: IntentEditPayload) => runMutation(
      id,
      (s) => ({
        ...s,
        text: payload.text ?? s.text,
        kind: payload.kind ?? s.kind,
        links: payload.links ? toLinks(payload.links) : s.links,
        source: 'human',
      }),
      () => editStatement(projectId, id, payload),
      "Couldn't save",
    ),
    [projectId, runMutation],
  );

  const onConfirmArea = useCallback(async (key: string) => {
    const area = areas.find((a) => areaKey(a) === key);
    if (!area) return;
    const pending = area.statements.filter((s) => s.status === 'candidate');
    if (pending.length === 0) return;
    setBusyArea(key);
    // Optimistically confirm every candidate in the area at once.
    setAreas((prev) =>
      prev.map((a) =>
        areaKey(a) === key
          ? { ...a, statements: a.statements.map((s) => (s.status === 'candidate' ? { ...s, status: 'confirmed' } : s)) }
          : a,
      ),
    );
    try {
      const results = await Promise.all(pending.map((s) => confirmStatement(projectId, s.id)));
      results.forEach((r) => replaceStatement(r));
    } catch (err) {
      if (!usingMockRef.current) {
        setToast(`Couldn't confirm all: ${(err as Error).message}`);
        void reload();
      }
    } finally {
      setBusyArea(null);
    }
  }, [areas, projectId, replaceStatement, reload]);

  const onExportSpec = useCallback(async () => {
    setSpecBusy(true);
    try {
      const markdown = await fetchIntentSpec(projectId);
      if (!markdown.trim()) {
        setToast('The living spec is empty — confirm some statements first.');
        return;
      }
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'intent-spec.md';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      // Phase 4b implements /intent/spec; until then it 501s. Degrade to a
      // friendly notice rather than a stack trace.
      setToast('Living spec export isn\u2019t available yet — coming with the intent backend.');
    } finally {
      setSpecBusy(false);
    }
  }, [projectId]);

  // Shared optimistic helper for triage rows. We drop the row immediately for a
  // snappy feel, then reconcile the real statement + triage list on success.
  // On failure we revert by re-fetching triage — unless we're on the mock, in
  // which case the endpoint is expected to 501 and the optimistic drop stands.
  const runTriageAction = useCallback(
    async (
      item: IntentTriageItem,
      apiCall: () => Promise<IntentStatement>,
      errLabel: string,
    ) => {
      const key = triageKey(item);
      setTriageBusyKey(key);
      setTriage((prev) => prev.filter((t) => triageKey(t) !== key));
      try {
        const updated = await apiCall();
        replaceStatement(updated);
        await Promise.all([reloadTriage(), reload()]);
      } catch (err) {
        if (!usingMockRef.current) {
          setToast(`${errLabel}: ${(err as Error).message}`);
          await reloadTriage();
        }
      } finally {
        setTriageBusyKey(null);
      }
    },
    [replaceStatement, reloadTriage, reload],
  );

  const onAcceptRelink = useCallback(
    (item: IntentTriageItem) => runTriageAction(
      item,
      // Omit newSymbol/newFilePath to accept the reconciler's suggestion.
      () => applyRelink(projectId, item.statementId, {
        filePath: item.link.filePath,
        symbol: item.link.symbol,
      }),
      "Couldn't relink",
    ),
    [projectId, runTriageAction],
  );

  const onMarkBroken = useCallback(
    (item: IntentTriageItem) => runTriageAction(
      item,
      () => markLinkBroken(projectId, item.statementId, {
        filePath: item.link.filePath,
        symbol: item.link.symbol,
      }),
      "Couldn't mark broken",
    ),
    [projectId, runTriageAction],
  );

  // Broken links have no server-side dismiss; clearing one is a local-only
  // acknowledgement so the reviewer can hide rows they've already noted.
  const onDismissTriage = useCallback((item: IntentTriageItem) => {
    const key = triageKey(item);
    setTriage((prev) => prev.filter((t) => triageKey(t) !== key));
  }, []);

  const totals = useMemo(() => {
    let total = 0, confirmed = 0, candidates = 0, rejected = 0;
    for (const a of areas) {
      for (const s of a.statements) {
        total += 1;
        if (s.status === 'confirmed') confirmed += 1;
        else if (s.status === 'candidate') candidates += 1;
        else rejected += 1;
      }
    }
    return { total, confirmed, candidates, rejected, areaCount: areas.length };
  }, [areas]);

  const rejectedStatements = useMemo(
    () => areas.flatMap((a) => a.statements.filter((s) => s.status === 'rejected')),
    [areas],
  );

  // For candidate/confirmed filters, keep only areas that have a statement in
  // the active status; each area renders just its matching statements.
  const visibleAreas = useMemo(() => {
    const wanted: IntentStatus = filter === 'confirmed' ? 'confirmed' : 'candidate';
    return areas
      .map((a) => ({ area: a, statements: a.statements.filter((s) => s.status === wanted) }))
      .filter((x) => x.statements.length > 0);
  }, [areas, filter]);

  const personaGroups = useMemo(() => groupByPersonaJob(visibleAreas), [visibleAreas]);

  if (loading && areas.length === 0) {
    return <div className="text-sm text-stone-500">Loading intent…</div>;
  }

  if (error) {
    return (
      <EmptyState
        icon={Target}
        title="Couldn't load intent"
        description={error}
        action={
          <button
            type="button"
            onClick={() => void reload()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-700 bg-white border border-stone-300 rounded hover:bg-stone-50 transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Retry
          </button>
        }
      />
    );
  }

  if (totals.total === 0) {
    return (
      <EmptyState
        icon={Target}
        title="No intent captured yet"
        description="Once Takeoff drafts intent statements from your codebase, they'll show up here for review."
      />
    );
  }

  const confirmPct = totals.total > 0 ? Math.round((totals.confirmed / totals.total) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-2xl font-bold text-stone-900 mb-2 v2-font-serif">What this app is meant to do</h3>
          <p className="text-stone-600 text-sm leading-relaxed max-w-2xl">
            Takeoff drafted these intent statements from your code. Confirm the ones that match your
            product, edit the ones that are close, and reject anything that's wrong. Confirmed
            statements become your living spec.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onExportSpec()}
          disabled={specBusy}
          aria-label="Export living spec"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-stone-700 bg-white border border-stone-300 rounded hover:bg-stone-50 disabled:opacity-50 transition-colors flex-shrink-0"
        >
          <Download className="w-3 h-3" />
          {specBusy ? 'Exporting…' : 'Export living spec'}
        </button>
      </div>

      {usingMock ? (
        /* Dev-only banner: makes it obvious the review flow is running on the
           bundled fixture because the backend isn't wired yet. */
        <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <Sparkles className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
          <span>Preview data — the intent backend isn't implemented yet, so this is a local mock.</span>
        </div>
      ) : null}

      {gaps.length > 0 && !driftDismissed ? (
        <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden />
          <div className="flex-1 min-w-0">
            <span>
              <span className="font-semibold">{gaps.length}</span> confirmed{' '}
              {gaps.length === 1 ? 'behavior has' : 'behaviors have'} drifted out of sync with the code.
            </span>{' '}
            <button
              type="button"
              onClick={() => setFilter('confirmed')}
              className="font-medium underline underline-offset-2 hover:text-amber-900"
            >
              Review confirmed
            </button>
          </div>
          <button
            type="button"
            onClick={() => setDriftDismissed(true)}
            aria-label="Dismiss drift notice"
            className="text-amber-500 hover:text-amber-800 transition-colors flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : null}

      <div className="bg-white border border-stone-200 rounded-lg p-5">
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <p className="text-sm text-stone-700">
            Takeoff drafted <span className="font-semibold text-stone-900">{totals.total}</span>{' '}
            {totals.total === 1 ? 'statement' : 'statements'} across{' '}
            <span className="font-semibold text-stone-900">{totals.areaCount}</span>{' '}
            {totals.areaCount === 1 ? 'area' : 'areas'} —{' '}
            <span className="font-semibold text-stone-900">{totals.confirmed}</span> of {totals.total} confirmed
          </p>
          <span className="text-xs font-semibold text-stone-700">{confirmPct}%</span>
        </div>
        <ProgressBar value={confirmPct} label="Intent confirmed" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <FilterChip active={filter === 'candidate'} count={totals.candidates} onClick={() => setFilter('candidate')}>
          Needs review
        </FilterChip>
        <FilterChip active={filter === 'confirmed'} count={totals.confirmed} onClick={() => setFilter('confirmed')}>
          Confirmed
        </FilterChip>
        {totals.rejected > 0 ? (
          <FilterChip active={filter === 'rejected'} count={totals.rejected} onClick={() => setFilter('rejected')}>
            Rejected
          </FilterChip>
        ) : null}
      </div>

      {filter === 'rejected' ? (
        rejectedStatements.length === 0 ? (
          <EmptyState title="No rejected statements" description="Nothing to restore here." />
        ) : (
          <div className="space-y-3" aria-busy={busyId !== null}>
            {rejectedStatements.map((s) => (
              <IntentStatementCard
                key={s.id}
                statement={s}
                busy={busyId === s.id}
                onRestore={onRestore}
              />
            ))}
          </div>
        )
      ) : visibleAreas.length === 0 ? (
        <EmptyState
          title={filter === 'confirmed' ? 'Nothing confirmed yet' : 'All caught up'}
          description={
            filter === 'confirmed'
              ? 'Confirm statements from the Needs review tab to build your spec.'
              : 'Every drafted statement has been triaged. Nice work.'
          }
        />
      ) : (
        <div className="space-y-6">
          {personaGroups.map((persona) => (
            <div key={`${filter}-p-${persona.key}`} className="space-y-3">
              {persona.name ? <PersonaHeader name={persona.name} emoji={persona.emoji} /> : null}
              {persona.jobs.map((job) => (
                <div key={`j-${job.key}`} className={persona.name ? 'space-y-3 sm:pl-3' : 'space-y-3'}>
                  {job.title ? <JobHeader title={job.title} priority={job.priority} /> : null}
                  {job.areas.map(({ area, statements }) => {
                    const key = areaKey(area);
                    const pending = area.statements.filter((s) => s.status === 'candidate').length;
                    const confirmed = area.statements.filter((s) => s.status === 'confirmed').length;
                    const subtitle = `${pending} to review · ${confirmed} confirmed`;
                    return (
                      <AreaCollapsible
                        // Key includes the filter so switching filters re-evaluates the
                        // "open when there are pending candidates" default.
                        key={`${filter}-${key}`}
                        title={areaTitle(area)}
                        subtitle={subtitle}
                        summary={area.summary ?? null}
                        defaultOpen={filter === 'candidate' ? pending > 0 : true}
                        action={
                          filter === 'candidate' && pending > 0 ? (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => { e.stopPropagation(); void onConfirmArea(key); }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault(); e.stopPropagation(); void onConfirmArea(key);
                                }
                              }}
                              aria-label={`Confirm all ${pending} statements in ${areaTitle(area)}`}
                              className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded border transition-colors ${
                                busyArea === key
                                  ? 'border-stone-200 text-stone-400'
                                  : 'border-stone-300 text-stone-700 hover:bg-stone-100 cursor-pointer'
                              }`}
                            >
                              <CheckCheck className="w-3 h-3" />
                              {busyArea === key ? 'Confirming…' : 'Confirm all'}
                            </span>
                          ) : null
                        }
                      >
                        <div className="space-y-3" aria-busy={busyId !== null || busyArea === key}>
                          {statements.map((s) => (
                            <IntentStatementCard
                              key={s.id}
                              statement={s}
                              busy={busyId === s.id || busyArea === key}
                              showLinkHealth
                              onAccept={onAccept}
                              onReject={onReject}
                              onEdit={onEdit}
                            />
                          ))}
                        </div>
                      </AreaCollapsible>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Link triage (Phase 5): anchors reconciliation flagged as stale or
          gone. Rendered only when there's something to adjudicate, so a handled
          501 (or the dev mock) simply hides the surface. */}
      {triage.length > 0 ? (
        <AreaCollapsible
          title="Link health"
          subtitle={`${triage.length} ${triage.length === 1 ? 'link needs' : 'links need'} attention`}
          defaultOpen
        >
          <div className="space-y-3" aria-busy={triageBusyKey !== null}>
            {triage.map((item) => (
              <TriageRow
                key={triageKey(item)}
                item={item}
                busy={triageBusyKey === triageKey(item)}
                onAcceptRelink={onAcceptRelink}
                onMarkBroken={onMarkBroken}
                onDismiss={onDismissTriage}
              />
            ))}
          </div>
        </AreaCollapsible>
      ) : null}

      {/* Persistent quick-restore drawer, shown while triaging so a mistaken
          reject is one click from coming back. Hidden on the dedicated
          Rejected view (it'd duplicate the list). */}
      {filter !== 'rejected' && rejectedStatements.length > 0 ? (
        <AreaCollapsible
          title="Rejected"
          subtitle={`${rejectedStatements.length} hidden`}
          defaultOpen={false}
        >
          <div className="space-y-3" aria-busy={busyId !== null}>
            {rejectedStatements.map((s) => (
              <IntentStatementCard
                key={s.id}
                statement={s}
                busy={busyId === s.id}
                onRestore={onRestore}
              />
            ))}
          </div>
        </AreaCollapsible>
      ) : null}

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

function FilterChip({
  active, count, onClick, children,
}: { active: boolean; count: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
        active ? 'bg-stone-900 text-white' : 'bg-white border border-stone-200 text-stone-700 hover:border-stone-400'
      }`}
    >
      {children} <span className={active ? 'text-stone-300' : 'text-stone-400'}>{count}</span>
    </button>
  );
}

// One row in the Link health drawer. `needs_relink` offers Accept relink
// (repoint at the reconciler's suggestion) or Mark broken; a `broken` link
// offers Mark broken (confirm) or a local-only Dismiss.
function TriageRow({
  item, busy, onAcceptRelink, onMarkBroken, onDismiss,
}: {
  item: IntentTriageItem;
  busy: boolean;
  onAcceptRelink: (item: IntentTriageItem) => void;
  onMarkBroken: (item: IntentTriageItem) => void;
  onDismiss: (item: IntentTriageItem) => void;
}) {
  const { link } = item;
  const isRelink = link.linkStatus === 'needs_relink';
  const anchor = link.symbol ? `${link.filePath} \u00b7 ${link.symbol}` : link.filePath;
  return (
    <div className="border border-stone-200 rounded-lg p-3.5 bg-white">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span
          className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border font-medium inline-flex items-center gap-1 ${
            isRelink
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-red-50 text-red-600 border-red-200'
          }`}
        >
          {isRelink ? (
            <AlertTriangle className="w-3 h-3" aria-hidden />
          ) : (
            <Unlink className="w-3 h-3" aria-hidden />
          )}
          {isRelink ? 'Needs relink' : 'Broken link'}
        </span>
        {item.featureArea ? (
          <span className="text-[10px] uppercase tracking-wider text-stone-400">{item.featureArea}</span>
        ) : null}
      </div>

      <p className="text-sm text-stone-800 leading-relaxed v2-font-serif mb-2">{item.statementText}</p>

      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <code
          className="text-xs px-2 py-1 rounded border font-mono bg-stone-50 border-stone-200 text-stone-700"
          title={anchor}
        >
          <span className="text-stone-500">{link.filePath}</span>
          {link.symbol ? <span className="text-stone-400"> · </span> : null}
          {link.symbol ? <span>{link.symbol}</span> : null}
        </code>
        {isRelink && link.suggestedSymbol ? (
          <span className="text-xs text-amber-700 font-mono">{`\u2192 ${link.suggestedSymbol}`}</span>
        ) : null}
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        {isRelink ? (
          <>
            <button
              type="button"
              onClick={() => onAcceptRelink(item)}
              disabled={busy}
              aria-label={link.suggestedSymbol ? `Relink to ${link.suggestedSymbol}` : 'Accept relink'}
              className="flex items-center gap-2 px-3 py-1.5 bg-stone-900 hover:bg-stone-800 disabled:bg-stone-300 text-white rounded-md text-sm font-medium transition-colors"
            >
              <Wrench className="w-4 h-4" />
              {link.suggestedSymbol ? `Relink \u2192 ${link.suggestedSymbol}` : 'Accept relink'}
            </button>
            <button
              type="button"
              onClick={() => onMarkBroken(item)}
              disabled={busy}
              aria-label="Mark link broken"
              className="flex items-center gap-2 px-3 py-1.5 text-stone-600 hover:text-red-600 hover:bg-stone-100 disabled:opacity-40 rounded-md text-sm font-medium transition-colors"
            >
              <Unlink className="w-4 h-4" /> Mark broken
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onMarkBroken(item)}
              disabled={busy}
              aria-label="Confirm link broken"
              className="flex items-center gap-2 px-3 py-1.5 bg-stone-900 hover:bg-stone-800 disabled:bg-stone-300 text-white rounded-md text-sm font-medium transition-colors"
            >
              <Unlink className="w-4 h-4" /> Mark broken
            </button>
            <button
              type="button"
              onClick={() => onDismiss(item)}
              disabled={busy}
              aria-label="Dismiss broken link"
              className="flex items-center gap-2 px-3 py-1.5 text-stone-600 hover:text-stone-900 hover:bg-stone-100 disabled:opacity-40 rounded-md text-sm font-medium transition-colors"
            >
              <X className="w-4 h-4" /> Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Local collapsible matching ContextSection's pattern, extended with an
// optional right-aligned `action` slot for the per-area "Confirm all" control.
function AreaCollapsible({
  title, subtitle, summary, defaultOpen = false, action, children,
}: {
  title: string;
  subtitle?: string;
  summary?: string | null;
  defaultOpen?: boolean;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
      <div className="w-full px-5 py-3.5 flex items-start gap-3 hover:bg-stone-50 transition-colors">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-start gap-3 text-left flex-1 min-w-0"
        >
          {open ? (
            <ChevronDown className="w-4 h-4 text-stone-500 flex-shrink-0 mt-0.5" />
          ) : (
            <ChevronRight className="w-4 h-4 text-stone-500 flex-shrink-0 mt-0.5" />
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2 flex-wrap">
              <span className="text-sm font-semibold text-stone-900">{title}</span>
              {subtitle ? (
                <span className="text-xs text-stone-500 truncate">{subtitle}</span>
              ) : null}
            </span>
            {summary ? (
              <span className="block text-xs text-stone-500 mt-0.5 leading-snug">{summary}</span>
            ) : null}
          </span>
        </button>
        {action ? <div className="flex-shrink-0">{action}</div> : null}
      </div>
      {open ? <div className="px-5 pb-5">{children}</div> : null}
    </div>
  );
}

// Persona section header for the plan hierarchy.
function PersonaHeader({ name, emoji }: { name: string; emoji: string | null }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="text-lg leading-none" aria-hidden>{emoji || '\u{1F464}'}</span>
      <h4 className="text-xs font-bold uppercase tracking-wider text-stone-700">{name}</h4>
    </div>
  );
}

// Job-to-be-done sub-header, with an optional priority pill.
function JobHeader({
  title, priority,
}: { title: string; priority: 'high' | 'medium' | 'low' | null }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Target className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" aria-hidden />
      <span className="text-sm font-semibold text-stone-800 v2-font-serif">{title}</span>
      {priority ? (
        <span
          className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border font-medium ${
            PRIORITY_STYLES[priority] || PRIORITY_STYLES.low
          }`}
        >
          {priority}
        </span>
      ) : null}
    </div>
  );
}

export default IntentSection;
