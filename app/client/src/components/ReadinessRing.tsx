type ReadinessRingProps = {
  score: number;
  size?: number;
  stroke?: number;
  color?: string;
  label?: string;
  sublabel?: string;
  className?: string;
};

function scoreHue(score: number) {
  if (score >= 70) return '#16a34a';
  if (score >= 40) return '#d97706';
  return '#dc2626';
}

export function ReadinessRing({
  score,
  size = 100,
  stroke = 8,
  color,
  label,
  sublabel,
  className = '',
}: ReadinessRingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = c - (clamped / 100) * c;
  const scoreColor = color || scoreHue(clamped);

  return (
    <div
      className={`flex flex-col items-center gap-1 ${className}`}
      style={{ fontFamily: "'DM Sans', ui-sans-serif, sans-serif" }}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          className="block"
          style={{ transform: 'rotate(-90deg)' }}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={scoreColor}
            strokeWidth={stroke}
            strokeDasharray={c}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)' }}
          />
        </svg>
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          style={{ fontFamily: "'DM Mono', ui-monospace, monospace" }}
        >
          <span
            className="font-extrabold"
            style={{ fontSize: size * 0.28, color: scoreColor, lineHeight: 1 }}
          >
            {Math.round(clamped)}
          </span>
          <span
            className="mt-[-2px] text-[#94a3b8]"
            style={{ fontSize: size * 0.09, fontFamily: "'DM Mono', monospace" }}
          >
            / 100
          </span>
        </div>
      </div>
      {label && (
        <span className="text-xs font-semibold text-[#0f172a]">{label}</span>
      )}
      {sublabel && <span className="text-[10px] text-[#94a3b8]">{sublabel}</span>}
    </div>
  );
}

type MiniScoreBarProps = {
  score: number;
  width?: number;
  color?: string;
  className?: string;
};

export function MiniScoreBar({ score, width = 50, color, className = '' }: MiniScoreBarProps) {
  const c = color || scoreHue(score);
  return (
    <div
      className={`flex items-center gap-1.5 ${className}`}
      style={{ fontFamily: "'DM Mono', monospace" }}
    >
      <div
        className="h-1 overflow-hidden rounded-sm bg-surface-2"
        style={{ width }}
      >
        <div
          className="h-full rounded-sm transition-[width] duration-500"
          style={{
            width: `${Math.max(0, Math.min(100, score))}%`,
            background: c,
            transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      </div>
      <span
        className="min-w-[28px] text-[10px] font-bold"
        style={{ color: c, fontFamily: "'DM Mono', monospace" }}
      >
        {Math.round(score)}%
      </span>
    </div>
  );
}

type DeltaBadgeProps = { delta: number; className?: string };

export function DeltaBadge({ delta, className = '' }: DeltaBadgeProps) {
  if (delta === 0) return null;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11px] font-bold text-success ${className}`}
      style={{ fontFamily: "'DM Mono', monospace" }}
    >
      +{delta}%
    </span>
  );
}

type ImpactArrowProps = { before: number; after: number };

function arrowHue(v: number) {
  if (v >= 70) return '#16a34a';
  if (v >= 40) return '#d97706';
  return '#dc2626';
}

export function ImpactArrow({ before, after }: ImpactArrowProps) {
  return (
    <div
      className="flex items-center gap-1.5 text-xs"
      style={{ fontFamily: "'DM Mono', monospace" }}
    >
      <span className="font-bold" style={{ color: arrowHue(before) }}>{before}%</span>
      <span className="text-[#cbd5e1]">→</span>
      <span className="font-bold" style={{ color: arrowHue(after) }}>{after}%</span>
    </div>
  );
}
