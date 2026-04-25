interface MiniBarProps {
  /** 0..1 fill */
  score: number;
  width?: number;
  height?: number;
  className?: string;
}

function thresholdColor(score: number) {
  if (score >= 0.7) return '#16a34a';
  if (score >= 0.4) return '#d97706';
  return '#dc2626';
}

export default function MiniBar({ score, width = 64, height = 5, className = '' }: MiniBarProps) {
  const clamped = Math.max(0, Math.min(1, score));
  return (
    <div
      className={['rounded-full overflow-hidden bg-surface-2 shrink-0', className].join(' ')}
      style={{ width, height }}
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${clamped * 100}%`,
          background: thresholdColor(clamped),
        }}
      />
    </div>
  );
}
