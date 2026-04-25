interface ScoreRingProps {
  score: number;
  size?: number;
  /** Stroke width in px */
  stroke?: number;
  /** Show the percent number inside */
  showLabel?: boolean;
  className?: string;
}

function thresholdColor(score: number) {
  if (score >= 70) return '#16a34a';
  if (score >= 40) return '#d97706';
  return '#dc2626';
}

/**
 * Circular score ring (used across ProductMap, ProjectView analysis tab,
 * Dashboard project cards). Stroke color follows the kit thresholds:
 * ≥70 success, ≥40 warning, else danger.
 */
export default function ScoreRing({
  score,
  size = 88,
  stroke = 7,
  showLabel = true,
  className = '',
}: ScoreRingProps) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const color = thresholdColor(score);
  const labelSize = Math.max(11, Math.round(size * 0.22));

  return (
    <div
      className={['relative shrink-0', className].join(' ')}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#f1f5f9" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - score / 100)}
          strokeLinecap="round"
          style={{
            transform: 'rotate(-90deg)',
            transformOrigin: 'center',
            transition: 'stroke-dashoffset 0.5s ease',
          }}
        />
      </svg>
      {showLabel && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="font-mono font-extrabold leading-none text-text"
            style={{ fontSize: labelSize }}
          >
            {score}%
          </span>
        </div>
      )}
    </div>
  );
}
