import { ImpactArrow } from './ReadinessRing';

export type ModuleImpactItem = {
  id: string;
  label: string;
  status: 'none' | 'partial' | 'full' | string;
  before: number;
  after: number;
  delta: number;
  jobsUnblocked: { id: string; title: string; before: number; after: number; personaEmoji?: string }[];
  rank: number;
};

const STATUS_COL: Record<string, string> = {
  none: '#dc2626',
  partial: '#d97706',
  full: '#16a34a',
};

type ModuleImpactProps = {
  modules: ModuleImpactItem[];
  hoveredModule: string | null;
  onHover: (id: string | null) => void;
  onAddModule?: (moduleId: string, label: string) => void;
  showTopCta?: boolean;
  className?: string;
};

export function ModuleImpact({
  modules,
  hoveredModule,
  onHover,
  onAddModule,
  showTopCta = true,
  className = '',
}: ModuleImpactProps) {
  return (
    <div className={className}>
      <div
        className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-[#94a3b8]"
        style={{ fontFamily: "'DM Mono', monospace", letterSpacing: '0.1em' }}
      >
        Module impact — hover to simulate
      </div>
      <div className="flex flex-col gap-2">
        {modules.map((mod, i) => {
          const isHovered = hoveredModule === mod.id;
          const sc = STATUS_COL[mod.status] ?? '#334155';

          return (
            <div
              key={mod.id}
              role="button"
              tabIndex={0}
              onMouseEnter={() => onHover(mod.id)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(mod.id)}
              onBlur={() => onHover(null)}
              className="cursor-pointer rounded-[10px] p-3.5 transition-colors duration-200"
              style={{
                background: isHovered ? 'rgba(244, 63, 94, 0.04)' : '#ffffff',
                border: `1px solid ${
                  isHovered ? 'rgba(244,63,94,0.12)' : '#e2e8f0'
                }`,
              }}
            >
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span
                    className="w-[18px] text-[11px] font-extrabold text-[#f43f5e]"
                    style={{ fontFamily: "'DM Mono', monospace" }}
                  >
                    #{mod.rank}
                  </span>
                  <span className="text-sm font-bold text-[#0f172a]">{mod.label}</span>
                  <span
                    className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase"
                    style={{
                      fontFamily: "'DM Mono', monospace",
                      background: `${sc}14`,
                      color: sc,
                    }}
                  >
                    {mod.status === 'none' ? 'Not built' : mod.status}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <ImpactArrow before={mod.before} after={mod.after} />
                  <span
                    className="rounded-md px-2.5 py-0.5 text-[13px] font-extrabold text-success"
                    style={{
                      fontFamily: "'DM Mono', monospace",
                      background: 'rgba(34, 197, 94, 0.08)',
                    }}
                  >
                    +{mod.delta}%
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 pl-7">
                {mod.jobsUnblocked.map((job) => (
                  <span
                    key={job.id}
                    className="inline-flex items-center gap-1 rounded bg-page px-2 py-0.5 text-[10px] text-[#334155]"
                  >
                    {job.personaEmoji ? `${job.personaEmoji} ` : ''}
                    {job.title}
                    <span className="text-[9px] text-success" style={{ fontFamily: "'DM Mono', monospace" }}>
                      {job.before}→{job.after}%
                    </span>
                  </span>
                ))}
              </div>
              {showTopCta && i === 0 && onAddModule && (
                <div className="mt-2.5 pl-7">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddModule(mod.id, mod.label);
                    }}
                    className="cursor-pointer rounded-lg border-0 bg-[#f43f5e] px-4 py-2 text-xs font-semibold text-white transition hover:opacity-90"
                    style={{ fontFamily: "'DM Sans', sans-serif" }}
                  >
                    Add {mod.label} module →
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
