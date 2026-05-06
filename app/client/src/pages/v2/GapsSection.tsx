import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle } from 'lucide-react';
import { GapCard, EmptyState } from '../../components/v2';
import type { GapStatus } from '../../components/v2';
import {
  fetchV2Gaps, acceptV2Gap, rejectV2Gap, restoreV2Gap,
  markGapCommitted, refineV2Gap, fetchGapPrompt,
  type V2Gap, type GapsPersona,
} from '../../services/v2Api';

type Filter = 'untriaged' | 'all' | 'rejected';

export interface GapsSectionProps {
  projectId: string;
  /** Notified when a gap moves to 'shipped' so the parent can refresh shipped count. */
  onCommitted?: (gap: V2Gap) => void;
}

export function GapsSection({ projectId, onCommitted }: GapsSectionProps) {
  const [groups, setGroups] = useState<{ broken: V2Gap[]; missing: V2Gap[]; infra: V2Gap[] }>({ broken: [], missing: [], infra: [] });
  const [personas, setPersonas] = useState<GapsPersona[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('untriaged');
  // `null` means "all personas". An id narrows to gaps whose
  // affectedJobs include that persona.
  const [personaFilter, setPersonaFilter] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [promptLoadingId, setPromptLoadingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchV2Gaps(projectId);
      setGroups({ broken: data.broken, missing: data.missing, infra: data.infra });
      setPersonas(data.personas ?? []);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to load gaps');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void reload(); }, [reload]);

  const allGaps = useMemo<V2Gap[]>(
    () => [...groups.broken, ...groups.missing, ...groups.infra],
    [groups],
  );

  // Status filter narrows by lifecycle (untriaged/in-progress vs rejected
  // vs everything); persona filter narrows by which job is affected. The
  // two compose so a user can see "what's still TODO for Tom".
  const visible = useMemo(() => {
    let v = allGaps;
    if (filter === 'rejected') {
      v = v.filter((g) => g.status === 'rejected');
    } else if (filter === 'untriaged') {
      v = v.filter((g) => g.status === 'untriaged' || g.status === 'in-progress');
    }
    if (personaFilter) {
      v = v.filter((g) => Array.isArray(g.affectedJobs)
        && g.affectedJobs.some((j) => j.personaId === personaFilter));
    }
    return v;
  }, [allGaps, filter, personaFilter]);

  const counts = useMemo(() => {
    const inProgress = allGaps.filter((g) => g.status === 'in-progress').length;
    const untriaged  = allGaps.filter((g) => g.status === 'untriaged').length;
    const rejected   = allGaps.filter((g) => g.status === 'rejected').length;
    return { inProgress, untriaged, rejected, total: allGaps.length };
  }, [allGaps]);

  const replaceGap = useCallback((updated: V2Gap) => {
    setGroups((prev) => {
      const next = { broken: [...prev.broken], missing: [...prev.missing], infra: [...prev.infra] };
      for (const bucket of ['broken', 'missing', 'infra'] as const) {
        const idx = next[bucket].findIndex((g) => g.id === updated.id);
        if (idx >= 0) next[bucket][idx] = updated;
      }
      return next;
    });
  }, []);

  const onAccept = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      const updated = await acceptV2Gap(projectId, id);
      // Backend status is 'in_progress' (snake_case in DB) — map to component status
      replaceGap({ ...updated, status: 'in-progress' });
    } catch (err) {
      setToast(`Couldn't accept: ${(err as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }, [projectId, replaceGap]);

  const onReject = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      const updated = await rejectV2Gap(projectId, id);
      replaceGap({ ...updated, status: 'rejected' });
    } catch (err) {
      setToast(`Couldn't reject: ${(err as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }, [projectId, replaceGap]);

  const onRestore = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      const updated = await restoreV2Gap(projectId, id);
      replaceGap({ ...updated, status: 'untriaged' });
    } catch (err) {
      setToast(`Couldn't restore: ${(err as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }, [projectId, replaceGap]);

  const onMarkCommitted = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      const updated = await markGapCommitted(projectId, id);
      replaceGap({ ...updated, status: 'shipped' });
      setToast('Marked as committed. Takeoff will verify after your next push.');
      onCommitted?.(updated);
    } catch (err) {
      setToast(`Couldn't mark committed: ${(err as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }, [projectId, replaceGap, onCommitted]);

  const onRefine = useCallback(async (id: string, instructions: string) => {
    if (!instructions.trim()) return;
    setBusyId(id);
    try {
      const updated = await refineV2Gap(projectId, id, instructions);
      replaceGap({ ...updated, status: 'untriaged' });
    } catch (err) {
      setToast(`Couldn't refine: ${(err as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }, [projectId, replaceGap]);

  const onCopyPrompt = useCallback(async (id: string) => {
    const gap = allGaps.find((g) => g.id === id);
    if (!gap?.prompt) return;
    try {
      await navigator.clipboard.writeText(gap.prompt);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 2000);
    } catch {
      setToast("Couldn't copy to clipboard.");
    }
  }, [allGaps]);

  // Lazy prompt fetch for synthetic map-derived gaps. We only call
  // Claude when the user clicks "Get Cursor prompt" so projects with
  // dozens of synthetic gaps don't burn tokens for prompts no one reads.
  // The fetched prompt lives on the in-memory gap; it's regenerated on
  // every reload (synthetic gaps don't persist in the DB).
  const onGetPrompt = useCallback(async (id: string) => {
    setPromptLoadingId(id);
    try {
      const prompt = await fetchGapPrompt(projectId, id);
      if (!prompt) {
        setToast('No prompt was generated. Try again in a moment.');
        return;
      }
      replaceGap({ ...(allGaps.find((g) => g.id === id)!), prompt });
    } catch (err) {
      setToast(`Couldn't generate prompt: ${(err as Error).message}`);
    } finally {
      setPromptLoadingId((cur) => (cur === id ? null : cur));
    }
  }, [projectId, allGaps, replaceGap]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  if (loading && allGaps.length === 0) {
    return <div className="text-sm text-stone-500">Loading gaps…</div>;
  }

  if (error) {
    return (
      <EmptyState
        title="Couldn't load gaps"
        description={error}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-2xl font-bold text-stone-900 mb-2 v2-font-serif">What's missing or broken</h3>
        <p className="text-stone-600 text-sm leading-relaxed">
          Accept gaps to start working on them. The Cursor prompt opens inline — copy it, build, then mark committed. Takeoff will verify it landed.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <FilterChip active={filter === 'untriaged'} count={counts.untriaged + counts.inProgress} onClick={() => setFilter('untriaged')}>
          Active
        </FilterChip>
        <FilterChip active={filter === 'all'} count={counts.total} onClick={() => setFilter('all')}>
          All
        </FilterChip>
        {counts.rejected > 0 ? (
          <FilterChip active={filter === 'rejected'} count={counts.rejected} onClick={() => setFilter('rejected')}>
            Rejected
          </FilterChip>
        ) : null}
        {counts.inProgress > 0 ? (
          <div className="ml-auto text-xs text-stone-500 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 v2-animate-pulse" />
            {counts.inProgress} in progress
          </div>
        ) : null}
      </div>

      {personas.length > 0 ? (
        <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-stone-100">
          <span className="text-xs uppercase tracking-wider text-stone-500 font-semibold pr-1 pt-2.5">For:</span>
          <PersonaChip active={personaFilter === null} onClick={() => setPersonaFilter(null)}>
            All personas
          </PersonaChip>
          {personas.map((p) => {
            const personaGapCount = allGaps.filter((g) => Array.isArray(g.affectedJobs)
              && g.affectedJobs.some((j) => j.personaId === p.id)).length;
            return (
              <PersonaChip
                key={p.id}
                active={personaFilter === p.id}
                onClick={() => setPersonaFilter((cur) => (cur === p.id ? null : p.id))}
                emoji={p.emoji}
                count={personaGapCount}
              >
                {p.name}
              </PersonaChip>
            );
          })}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="bg-white border border-stone-200 rounded-lg p-8 text-center">
          <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto mb-3" />
          <p className="font-semibold text-stone-900 mb-1">
            {personaFilter
              ? `Nothing left for ${personas.find((p) => p.id === personaFilter)?.name ?? 'this persona'}.`
              : emptyTitle(filter)}
          </p>
          <p className="text-sm text-stone-600">
            {personaFilter
              ? 'Their jobs are unblocked. Switch persona or clear the filter.'
              : emptyDesc(filter)}
          </p>
        </div>
      ) : (
        <div className="space-y-3" aria-busy={busyId !== null}>
          {visible.map((gap) => (
            <GapCard
              key={gap.id}
              gap={gap}
              status={gap.status}
              copied={copiedId === gap.id}
              promptLoading={promptLoadingId === gap.id}
              onAccept={onAccept}
              onReject={onReject}
              onRestore={onRestore}
              onMarkCommitted={onMarkCommitted}
              onRefine={onRefine}
              onCopyPrompt={onCopyPrompt}
              onGetPrompt={onGetPrompt}
            />
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

function PersonaChip({
  active, onClick, children, emoji, count,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  emoji?: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1.5 mt-2 rounded-full text-xs font-medium transition-all inline-flex items-center gap-1.5 ${
        active
          ? 'bg-stone-100 border border-stone-400 text-stone-900'
          : 'bg-white border border-stone-200 text-stone-700 hover:border-stone-400'
      }`}
    >
      {emoji ? <span aria-hidden>{emoji}</span> : null}
      <span>{children}</span>
      {typeof count === 'number' ? (
        <span className={active ? 'text-stone-500' : 'text-stone-400'}>{count}</span>
      ) : null}
    </button>
  );
}

function emptyTitle(filter: Filter): string {
  if (filter === 'rejected') return 'No rejected gaps.';
  if (filter === 'all') return 'No gaps found.';
  return 'No active gaps.';
}

function emptyDesc(filter: Filter): string {
  if (filter === 'rejected') return 'Nothing to restore here.';
  if (filter === 'all') return 'Run analysis again to refresh.';
  return 'Switch filters to see other gaps.';
}

export default GapsSection;
