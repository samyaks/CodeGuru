import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { ReadinessRing, MiniScoreBar, DeltaBadge } from '../components/ReadinessRing';
import { ModuleImpact, type ModuleImpactItem } from '../components/ModuleImpact';
import {
  ReadinessJobList,
  GroupedExpandableJobList,
  type ReadinessJobRow,
  type ExpandableJob,
  type JobNeedRow,
} from '../components/JobList';
import {
  fetchProductMap,
  fetchSimulate,
  type ProductMapData,
  type SimulateResult,
} from '../services/productMapApi';
import {
  getEntityStatus,
  scoreApp,
  scoreJob,
  scorePersona,
  rankModules,
  simulateModule,
  type MapEntity,
  type MapJob,
} from '../lib/productMapScoring';
import { ApiError } from '../lib/api-error';

type View = 'readiness' | 'jobs' | 'technical';

const VIEWS: { key: View; label: string; icon: string; desc: string; color: string }[] = [
  { key: 'readiness', label: 'Readiness', icon: '📊', desc: 'Score + module impact', color: '#f43f5e' },
  { key: 'jobs', label: 'Jobs', icon: '🎯', desc: 'By persona & job', color: '#d97706' },
  { key: 'technical', label: 'Technical', icon: '⚙️', desc: 'Code & routes', color: '#6366f1' },
];

function statusLabelFor(value: number): { label: 'Ready' | 'Partial' | 'Missing'; color: string } {
  if (value >= 1) return { label: 'Ready', color: '#16a34a' };
  if (value >= 0.3) return { label: 'Partial', color: '#d97706' };
  return { label: 'Missing', color: '#dc2626' };
}

function toMapEdges(map: ProductMapData) {
  return map.edges.map((e) => ({
    fromId: e.fromId,
    toId: e.toId,
    type: e.type,
  }));
}

function clientSimulate(
  map: ProductMapData,
  moduleId: string,
): Omit<SimulateResult, 'before'> & { before: number } {
  const jobs = map.jobs as MapJob[];
  const entities = map.entities as MapEntity[];
  const edges = toMapEdges(map);
  const base = simulateModule(moduleId, jobs, entities, edges);
  const cap = entities.find((e) => e.module === moduleId);
  const simEntities = cap
    ? entities.map((e) => (e.id === cap.id ? { ...e, status: 'full' as const } : e))
    : entities;
  const jobScores: Record<string, number> = {};
  for (const j of jobs) {
    jobScores[j.id] = scoreJob(j.id, simEntities, edges);
  }
  const personaScores: Record<string, number> = {};
  for (const p of map.personas) {
    personaScores[p.id] = scorePersona(p.id, jobs, simEntities, edges);
  }
  return {
    before: base.before,
    after: base.after,
    delta: base.delta,
    jobScores,
    personaScores,
    jobsUnblocked: base.jobsUnblocked,
  };
}

function heroMessage(score: number) {
  if (score < 30) return 'Your prototype needs backend infrastructure';
  if (score < 60) return 'Making progress — key capabilities missing';
  if (score < 80) return 'Almost there — a few gaps to fill';
  return 'Ready to ship';
}

export default function ProductMap() {
  const { id: projectId } = useParams<{ id: string }>();
  const [map, setMap] = useState<ProductMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('readiness');
  const [hoveredModule, setHoveredModule] = useState<string | null>(null);
  const [sim, setSim] = useState<SimulateResult | null>(null);
  const simReqId = useRef(0);

  const load = useCallback(() => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    fetchProductMap(projectId)
      .then((data) => {
        setMap(data);
        if (!data) setError(null);
      })
      .catch((err) => {
        setMap(null);
        setError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Failed to load product map',
        );
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const jobs = map?.jobs ?? [];
  const entities = map?.entities ?? [];
  const edges = useMemo(() => (map ? toMapEdges(map) : []), [map]);
  const personas = map?.personas ?? [];

  const baseAppScore = useMemo(() => {
    if (!map) return 0;
    if (map.appScore != null) return map.appScore;
    return scoreApp(jobs as MapJob[], entities as MapEntity[], edges);
  }, [map, jobs, entities, edges]);

  const jobScoreBase = useCallback(
    (jobId: string) => {
      if (map?.scores?.job && map.scores.job[jobId] != null) {
        return map.scores.job[jobId];
      }
      return scoreJob(jobId, entities as MapEntity[], edges);
    },
    [map, entities, edges],
  );

  const jobScoresForDisplay = useCallback(
    (jobId: string) => {
      if (hoveredModule && sim?.jobScores[jobId] != null) {
        return sim.jobScores[jobId];
      }
      return jobScoreBase(jobId);
    },
    [hoveredModule, sim, jobScoreBase],
  );

  const personaScoreForDisplay = useCallback(
    (personaId: string) => {
      if (hoveredModule && sim?.personaScores[personaId] != null) {
        return sim.personaScores[personaId];
      }
      if (map?.scores?.persona && map.scores.persona[personaId] != null) {
        return map.scores.persona[personaId];
      }
      return scorePersona(personaId, jobs as MapJob[], entities as MapEntity[], edges);
    },
    [hoveredModule, sim, map, jobs, entities, edges],
  );

  const readinessRows: ReadinessJobRow[] = useMemo(() => {
    if (!map) return [];
    return jobs.map((j) => {
      const needs = edges.filter((e) => e.fromId === j.id && e.type === 'needs');
      const builtCount = needs.filter(
        (e) => getEntityStatus(String(e.toId), entities as MapEntity[]) >= 1,
      ).length;
      const p = personas.find((x) => x.id === j.personaId);
      return {
        jobId: j.id,
        title: j.title,
        personaEmoji: p?.emoji ?? '👤',
        score: jobScoresForDisplay(j.id),
        baseScore: jobScoreBase(j.id),
        builtCount,
        needsCount: Math.max(needs.length, 1),
      };
    });
  }, [map, jobs, edges, entities, personas, jobScoresForDisplay, jobScoreBase]);

  const moduleItems: ModuleImpactItem[] = useMemo(() => {
    if (!map) return [];
    if (map.moduleRanking && map.moduleRanking.length > 0) {
      return map.moduleRanking.map((m, i) => {
        const cap = entities.find(
          (e) => e.type === 'capability' && e.module === m.module,
        );
        return {
          id: m.module,
          label: m.capLabel || cap?.label || m.module,
          status: m.capStatus || cap?.status || 'none',
          before: m.before,
          after: m.after,
          delta: m.delta,
          jobsUnblocked: [],
          rank: i + 1,
        };
      });
    }
    const ranked = rankModules(jobs as MapJob[], entities as MapEntity[], edges);
    return ranked.map((r, i) => {
      const cap = entities.find(
        (e) => e.type === 'capability' && e.module === r.module,
      );
      return {
        id: r.module,
        label: cap?.label || r.module,
        status: String(cap?.status ?? 'none'),
        before: r.before,
        after: r.after,
        delta: r.delta,
        jobsUnblocked: r.jobsUnblocked.map((j) => {
          const job = jobs.find((x) => x.id === j.id);
          const pers = job ? personas.find((p) => p.id === job.personaId) : undefined;
          return {
            id: j.id,
            title: j.title,
            before: j.before,
            after: j.after,
            personaEmoji: pers?.emoji,
          };
        }),
        rank: i + 1,
      };
    });
  }, [map, jobs, entities, edges, personas]);

  useEffect(() => {
    if (!map || !hoveredModule) {
      setSim(null);
      return;
    }
    const req = ++simReqId.current;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchSimulate(map.id, hoveredModule);
        if (cancelled || req !== simReqId.current) return;
        setSim(res);
      } catch {
        if (cancelled || req !== simReqId.current) return;
        const local = clientSimulate(map, hoveredModule);
        setSim({
          before: local.before,
          after: local.after,
          delta: local.delta,
          jobScores: local.jobScores,
          personaScores: local.personaScores,
          jobsUnblocked: local.jobsUnblocked,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [map, hoveredModule]);

  const simRingScore = useMemo(() => {
    if (!map || !hoveredModule) return baseAppScore;
    if (sim) return sim.after;
    return clientSimulate(map, hoveredModule).after;
  }, [map, hoveredModule, sim, baseAppScore]);

  const groupedJobs: { persona: { id: string; name: string; emoji: string }; jobs: ExpandableJob[] }[] =
    useMemo(() => {
      if (!map) return [];
      return personas.map((persona) => {
        const pjobs = jobs.filter((j) => j.personaId === persona.id);
        const ex: ExpandableJob[] = pjobs.map((j) => {
          const needsEdges = edges.filter(
            (e) => e.fromId === j.id && e.type === 'needs',
          );
          const needs: JobNeedRow[] = needsEdges.map((e) => {
            const toId = String(e.toId);
            const ent = entities.find((x) => x.id === toId);
            const st = getEntityStatus(toId, entities as MapEntity[]);
            const { label, color } = statusLabelFor(st);
            let detail = ent?.label || toId;
            if (ent?.type === 'page' && (ent.filePath || ent.file_path)) {
              detail = String(ent.filePath || ent.file_path);
            } else if (ent?.type === 'capability') {
              detail = ent.label;
            }
            let fixModule: string | undefined;
            if (st < 1 && toId.startsWith('cap:')) {
              const c = entities.find(
                (x) => x.id === toId && x.type === 'capability',
              );
              fixModule = c?.module || undefined;
            }
            return {
              label: ent?.label || toId,
              detail,
              statusLabel: label,
              statusColor: color,
              fixModule,
            };
          });
          return {
            id: j.id,
            title: j.title,
            priority: j.priority,
            score: jobScoreBase(j.id),
            needs,
          };
        });
        return {
          persona: {
            id: persona.id,
            name: persona.name,
            emoji: persona.emoji || '👤',
          },
          jobs: ex,
        };
      });
    }, [map, personas, jobs, edges, entities, jobScoreBase]);

  const technicalSections = useMemo(() => {
    if (!map) return [];
    const pages = entities
      .filter((e) => e.type === 'page')
      .map((e) => ({
        nodeId: e.id,
        name: e.label,
        sub: e.filePath || e.file_path || '—',
        dot: e.status === 'none' || e.status === 'missing' ? '#dc2626' : '#16a34a',
      }));
    const routes = entities
      .filter((e) => e.type === 'route')
      .map((e) => ({
        nodeId: e.id,
        name: e.label || e.key,
        sub: e.filePath || e.file_path || 'Not created',
        dot: e.status === 'stub' ? '#dc2626' : '#d97706',
      }));
    const components = entities
      .filter((e) => e.type === 'component')
      .map((e) => ({
        nodeId: e.id,
        name: e.label || e.key,
        sub: e.filePath || e.file_path || '—',
        dot: '#16a34a',
      }));
    const capabilities = entities
      .filter((e) => e.type === 'capability')
      .map((e) => {
        const st = e.status;
        const dot =
          st === 'none' || st === 'missing' ? '#dc2626' : st === 'partial' ? '#d97706' : '#16a34a';
        return {
          nodeId: e.id,
          name: e.label,
          sub: (e.module ? `${e.module} module` : '') as string,
          dot,
        };
      });
    return [
      { title: 'Pages', icon: '📄', items: pages },
      { title: 'API Routes', icon: '⚡', items: routes },
      { title: 'Components', icon: '🧩', items: components },
      { title: 'Capabilities', icon: '🔧', items: capabilities },
    ];
  }, [map, entities]);

  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);

  if (!projectId) {
    return <div className="min-h-screen bg-[#f8fafc] p-6 text-[#0f172a]">Invalid route.</div>;
  }

  if (loading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-[#f8fafc] text-[#64748b]"
        style={{ fontFamily: "'DM Sans', sans-serif" }}
      >
        <Loader2 className="h-6 w-6 animate-spin text-[#f43f5e]" />
        <span className="ml-2 text-sm">Loading product map…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="min-h-screen bg-[#f8fafc] p-6 text-[#0f172a]"
        style={{ fontFamily: "'DM Sans', sans-serif" }}
      >
        <p className="text-danger">{error}</p>
        <button
          type="button"
          onClick={load}
          className="mt-4 cursor-pointer rounded-lg border border-line bg-surface-2 px-4 py-2 text-sm text-[#0f172a] hover:bg-page"
        >
          Retry
        </button>
        <Link to={`/projects/${projectId}`} className="ml-3 text-sm text-[#f43f5e]">
          Back to project
        </Link>
      </div>
    );
  }

  // Do not use jobs.length: API can return a valid map with graph on siblings
  // (client merge); empty jobs alone is not "no map".
  if (!map?.id) {
    return (
      <div
        className="min-h-screen bg-[#f8fafc] p-6 text-[#0f172a]"
        style={{ fontFamily: "'DM Sans', sans-serif" }}
      >
        <h1 className="text-lg font-bold">Product map</h1>
        <p className="mt-2 max-w-md text-sm text-[#334155]">
          No product map for this project yet. Run onboarding to describe your app and generate a
          map.
        </p>
        <Link
          to={`/projects/${projectId}/map/onboard`}
          className="mt-4 inline-block rounded-lg bg-[#f43f5e] px-4 py-2 text-sm font-semibold text-white"
        >
          Create product map
        </Link>
        <div className="mt-4">
          <Link to={`/projects/${projectId}`} className="text-sm text-[#f43f5e]">
            Back to project
          </Link>
        </div>
      </div>
    );
  }

  const scoreBadge =
    baseAppScore >= 70
      ? { bg: 'rgba(34, 197, 94, 0.08)', border: 'rgba(34,197,94,0.12)', fg: '#16a34a' }
      : baseAppScore >= 40
        ? { bg: 'rgba(245, 158, 11, 0.08)', border: 'rgba(245,158,11,0.12)', fg: '#d97706' }
        : { bg: 'rgba(239, 68, 68, 0.08)', border: 'rgba(239,68,68,0.12)', fg: '#dc2626' };

  return (
    <div
      className="min-h-screen text-[#0f172a]"
      style={{
        background: '#f8fafc',
        fontFamily: "'DM Sans', ui-sans-serif, sans-serif",
      }}
    >
      <div className="border-b border-line px-4 py-3 pt-4 sm:px-6">
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div
              className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-[11px] font-extrabold text-white"
              style={{
                background: 'linear-gradient(135deg,#f43f5e,#e11d48)',
              }}
            >
              T
            </div>
            <span
              className="text-[13px] font-medium text-[#334155]"
              style={{ fontFamily: "'DM Mono', monospace" }}
            >
              takeoff<span className="text-[#f43f5e]">/map</span>
            </span>
            {map.projectName && (
              <span className="ml-1 text-[10px] text-[#cbd5e1]">{map.projectName}</span>
            )}
          </div>
          <div
            className="flex items-center gap-2 rounded-lg px-3 py-1.5"
            style={{
              background: scoreBadge.bg,
              border: `1px solid ${scoreBadge.border}`,
            }}
          >
            <span className="text-[11px] text-[#64748b]">Readiness</span>
            <span
              className="text-sm font-extrabold"
              style={{ color: scoreBadge.fg, fontFamily: "'DM Mono', monospace" }}
            >
              {baseAppScore}%
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 transition-all duration-150"
              style={{
                background: view === v.key ? `${v.color}12` : '#ffffff',
                border: `1px solid ${
                  view === v.key ? `${v.color}40` : '#e2e8f0'
                }`,
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              <span className="text-[13px]">{v.icon}</span>
              <div className="text-left">
                <div
                  className="text-xs font-bold"
                  style={{ color: view === v.key ? v.color : '#334155' }}
                >
                  {v.label}
                </div>
                <div className="text-[9px] text-[#cbd5e1]">{v.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-[720px] px-4 py-5 sm:px-5">
        {view === 'readiness' && (
          <div>
            <div
              className="mb-6 flex items-center gap-6 rounded-[14px] border border-line p-4 sm:p-5 sm:px-7"
              style={{ background: '#f8fafc' }}
            >
              <ReadinessRing
                score={hoveredModule ? simRingScore : baseAppScore}
                size={120}
                stroke={10}
                label="App Readiness"
                sublabel={
                  hoveredModule
                    ? `with ${hoveredModule} module`
                    : 'weighted by job priority'
                }
              />
              <div className="min-w-0 flex-1">
                <div className="mb-3 text-[15px] font-bold text-[#0f172a]">
                  {heroMessage(hoveredModule ? simRingScore : baseAppScore)}
                </div>
                {personas.map((persona) => {
                  const pScore = personaScoreForDisplay(persona.id);
                  const baseP = map.scores?.persona?.[persona.id] ?? scorePersona(
                    persona.id,
                    jobs as MapJob[],
                    entities as MapEntity[],
                    edges,
                  );
                  return (
                    <div key={persona.id} className="mb-1.5 flex items-center gap-2.5">
                      <span className="w-5 text-sm">{persona.emoji}</span>
                      <span className="w-[140px] text-xs text-[#64748b]">{persona.name}</span>
                      <MiniScoreBar score={pScore} width={80} />
                      {hoveredModule && pScore > baseP && (
                        <span
                          className="text-[10px] text-success"
                          style={{ fontFamily: "'DM Mono', monospace" }}
                        >
                          +{pScore - baseP}%
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <ReadinessJobList rows={readinessRows} hoveredModule={hoveredModule} />
            <ModuleImpact
              modules={moduleItems}
              hoveredModule={hoveredModule}
              onHover={setHoveredModule}
            />
          </div>
        )}

        {view === 'jobs' && <GroupedExpandableJobList groups={groupedJobs} />}

        {view === 'technical' && (
          <div>
            {technicalSections.map((section) => (
              <div key={section.title} className="mb-5">
                <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-[#0f172a]">
                  <span className="text-sm">{section.icon}</span>
                  {section.title}
                </div>
                {section.items.length === 0 ? (
                  <p className="text-xs text-[#94a3b8]">No {section.title.toLowerCase()} detected.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {section.items.map((item) => {
                      const isSelected = selectedEntity === item.nodeId;
                      const fromEdges = edges.filter((e) => e.fromId === item.nodeId);
                      const toEdges = edges.filter((e) => e.toId === item.nodeId);
                      return (
                        <div
                          key={item.nodeId}
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedEntity(isSelected ? null : item.nodeId)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedEntity(isSelected ? null : item.nodeId);
                            }
                          }}
                          className="cursor-pointer rounded-lg px-3.5 py-2"
                          style={{
                            background: isSelected
                              ? 'rgba(99, 102, 241, 0.04)'
                              : '#ffffff',
                            border: `1px solid ${
                              isSelected ? 'rgba(99, 102, 241, 0.12)' : '#e2e8f0'
                            }`,
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ background: item.dot }}
                            />
                            <span className="min-w-0 flex-1 text-xs font-semibold text-[#0f172a]">
                              {item.name}
                            </span>
                            <span
                              className="truncate text-[10px] text-[#94a3b8]"
                              style={{ fontFamily: "'DM Mono', monospace" }}
                            >
                              {item.sub}
                            </span>
                          </div>
                          {isSelected && (toEdges.length > 0 || fromEdges.length > 0) && (
                            <div className="mt-2 border-t border-divider pt-1.5">
                              {toEdges.map((edge, i) => {
                                const src = entities.find((n) => n.id === edge.fromId);
                                const fromJob = jobs.find((j) => j.id === edge.fromId);
                                const isProd = Boolean(fromJob) || edge.fromId?.includes('job');
                                const srcLabel = fromJob?.title
                                  || (src
                                    ? (src.label || (src as { name?: string }).name)
                                    : edge.fromId);
                                return (
                                  <div
                                    key={i}
                                    className="flex items-center gap-1.5 py-0.5 text-[11px]"
                                  >
                                    <span
                                      className="rounded px-1 py-px text-[8px] font-bold"
                                      style={{
                                        fontFamily: "'DM Mono', monospace",
                                        background: isProd
                                          ? 'rgba(244, 63, 94, 0.1)'
                                          : 'rgba(99, 102, 241, 0.1)',
                                        color: isProd ? '#f43f5e' : '#6366f1',
                                      }}
                                    >
                                      {edge.type}
                                    </span>
                                    <span
                                      style={{
                                        color: isProd ? '#f43f5e' : '#6366f1',
                                        fontWeight: 500,
                                      }}
                                    >
                                      {srcLabel || edge.fromId}
                                    </span>
                                  </div>
                                );
                              })}
                              {fromEdges.map((edge, i) => {
                                const tgt = entities.find((n) => n.id === edge.toId);
                                const tLabel = tgt?.label || String(edge.toId);
                                return (
                                  <div
                                    key={`f-${i}`}
                                    className="flex items-center gap-1.5 py-0.5 text-[11px]"
                                  >
                                    <span
                                      className="rounded px-1 py-px text-[8px] font-bold"
                                      style={{
                                        fontFamily: "'DM Mono', monospace",
                                        background: 'rgba(99, 102, 241, 0.1)',
                                        color: '#6366f1',
                                      }}
                                    >
                                      → {edge.type}
                                    </span>
                                    <span className="font-medium text-[#6366f1]">{tLabel}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="mt-8 border-t border-line pt-4 text-center text-[11px] text-[#94a3b8]">
          <Link to={`/projects/${projectId}`} className="text-[#f43f5e] hover:underline">
            ← Project
          </Link>
        </div>
      </div>
    </div>
  );
}
