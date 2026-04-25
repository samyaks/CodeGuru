import { useState } from 'react';
import { MiniScoreBar, DeltaBadge } from './ReadinessRing';

export type ReadinessJobRow = {
  jobId: string;
  title: string;
  personaEmoji: string;
  score: number;
  baseScore: number;
  builtCount: number;
  needsCount: number;
};

type ReadinessJobListProps = {
  rows: ReadinessJobRow[];
  hoveredModule: string | null;
  className?: string;
};

export function ReadinessJobList({
  rows,
  hoveredModule,
  className = '',
}: ReadinessJobListProps) {
  return (
    <div className={className}>
      <div
        className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-[#94a3b8]"
        style={{ fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em' }}
      >
        Job readiness
      </div>
      <div className="mb-7 flex flex-col gap-1.5">
        {rows.map((job) => {
          const delta = job.score - job.baseScore;
          const highlight = Boolean(hoveredModule && job.score > job.baseScore);
          return (
            <div
              key={job.jobId}
              className="flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 transition-colors duration-300"
              style={{
                background: highlight ? 'rgba(34, 197, 94, 0.03)' : '#ffffff',
                border: `1px solid ${
                  highlight ? 'rgba(34, 197, 94, 0.08)' : '#e2e8f0'
                }`,
              }}
            >
              <span className="w-4 text-xs">{job.personaEmoji}</span>
              <span className="min-w-0 flex-1 text-xs font-medium text-[#64748b]">
                {job.title}
              </span>
              <span
                className="text-[10px] text-[#94a3b8]"
                style={{ fontFamily: "'DM Mono', monospace" }}
              >
                {job.builtCount}/{job.needsCount} done
              </span>
              <MiniScoreBar score={job.score} width={60} />
              {hoveredModule && job.score > job.baseScore && <DeltaBadge delta={delta} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type PersonaGroup = {
  id: string;
  name: string;
  emoji: string;
};

export type JobNeedRow = {
  label: string;
  detail: string;
  statusLabel: 'Ready' | 'Partial' | 'Missing' | string;
  statusColor: string;
  fixModule?: string;
};

export type ExpandableJob = {
  id: string;
  title: string;
  priority: string;
  score: number;
  needs: JobNeedRow[];
};

type GroupedJobListProps = {
  groups: { persona: PersonaGroup; jobs: ExpandableJob[] }[];
  className?: string;
};

const PRIORITY_STY: Record<string, { bg: string; text: string }> = {
  high: { bg: 'rgba(244, 63, 94, 0.1)', text: '#f43f5e' },
  medium: { bg: 'rgba(245, 158, 11, 0.1)', text: '#d97706' },
  low: { bg: 'rgba(107, 114, 128, 0.1)', text: '#9ca3af' },
};

export function GroupedExpandableJobList({ groups, className = '' }: GroupedJobListProps) {
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  return (
    <div className={className}>
      {groups.map(({ persona, jobs }) => (
        <div key={persona.id} className="mb-6">
          <div className="mb-2.5 flex items-center gap-2 text-sm font-bold text-[#0f172a]">
            <span className="text-base">{persona.emoji}</span>
            {persona.name}
          </div>
          <div className="flex flex-col gap-1.5">
            {jobs.map((job) => {
              const isExpanded = expandedJob === job.id;
              const psty = PRIORITY_STY[job.priority] || PRIORITY_STY.medium;
              return (
                <div
                  key={job.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedJob(isExpanded ? null : job.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setExpandedJob(isExpanded ? null : job.id);
                    }
                  }}
                  className="cursor-pointer rounded-[10px] p-3 transition-colors duration-150"
                  style={{
                    background: isExpanded ? 'rgba(244, 63, 94, 0.04)' : '#ffffff',
                    border: `1px solid ${
                      isExpanded ? 'rgba(244, 63, 94, 0.12)' : '#e2e8f0'
                    }`,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-[13px] font-semibold text-[#0f172a]">
                        {job.title}
                      </span>
                      <span
                        className="rounded px-1.5 py-px text-[9px] font-bold uppercase"
                        style={{
                          fontFamily: "'DM Mono', monospace",
                          background: psty.bg,
                          color: psty.text,
                        }}
                      >
                        {job.priority}
                      </span>
                    </div>
                    <MiniScoreBar score={job.score} width={70} />
                  </div>
                  {isExpanded && job.needs.length > 0 && (
                    <div
                      className="mt-3 border-t border-divider pt-2.5"
                    >
                      {job.needs.map((n, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 py-1.5"
                          style={{
                            borderBottom:
                              i < job.needs.length - 1
                                ? '1px solid #f8fafc'
                                : 'none',
                          }}
                        >
                          <div
                            className="h-[7px] w-[7px] shrink-0 rounded-full"
                            style={{ background: n.statusColor }}
                          />
                          <span className="min-w-0 flex-1 text-xs text-[#64748b]">
                            {n.detail || n.label}
                          </span>
                          <span
                            className="rounded px-1.5 py-px text-[9px] font-bold"
                            style={{
                              fontFamily: "'DM Mono', monospace",
                              background: `${n.statusColor}14`,
                              color: n.statusColor,
                            }}
                          >
                            {n.statusLabel}
                          </span>
                          {n.fixModule && (
                            <span
                              className="rounded px-1.5 py-0.5 text-[9px] font-semibold text-[#f43f5e]"
                              style={{
                                fontFamily: "'DM Mono', monospace",
                                background: 'rgba(244, 63, 94, 0.08)',
                              }}
                            >
                              → {n.fixModule} module
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
