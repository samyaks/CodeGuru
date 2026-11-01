import { useEffect, useState, type CSSProperties } from 'react';
import { cx } from './status';
import styles from './ConformanceRing.module.css';

export interface ConformanceRingProps {
  cleared: number;
  total: number;
  /** Shown under the count. */
  label?: string;
  /** Diameter in px. Under 96 the ring is dropped and the count is written as text. */
  size?: number;
  strokeWidth?: number;
}

const MIN_RING_SIZE = 96;

export function ConformanceRing({
  cleared,
  total,
  label = 'Intents cleared',
  size = 200,
  strokeWidth = 12,
}: ConformanceRingProps) {
  const all = Math.max(0, total);
  const done = Math.min(all, Math.max(0, cleared));
  const fraction = all > 0 ? done / all : 0;
  const count = `${done} of ${all}`;
  const spoken = `${count} ${label.charAt(0).toLowerCase()}${label.slice(1)}`;

  // Start empty and fill on the next frame so the arc animates on load.
  // prefers-reduced-motion turns the transition off in CSS.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(fraction));
    return () => cancelAnimationFrame(id);
  }, [fraction]);

  if (size < MIN_RING_SIZE) {
    return <span className={cx('type-small', styles.text)}>{spoken}</span>;
  }

  const center = size / 2;
  // Inset by 4px so the knob's outline stays inside the box.
  const r = (size - strokeWidth) / 2 - 4;
  const circumference = 2 * Math.PI * r;
  // The count takes about a fifth of the diameter, shrinking further so long
  // counts ("12 of 12") fit inside the hole. The label scales from 9 to 16px.
  const inner = 2 * (r - strokeWidth / 2) * 0.82;
  const numSize = Math.min(size * 0.2, inner / (count.length * 0.5));
  const labelSize = Math.max(9, Math.min(16, size * 0.055));
  const vars = {
    width: size,
    height: size,
    '--ring-num': `${numSize.toFixed(1)}px`,
    '--ring-label': `${labelSize.toFixed(1)}px`,
    '--ring-inner': `${inner.toFixed(0)}px`,
  } as CSSProperties;

  return (
    <div className={styles.ring} style={vars} role="img" aria-label={spoken}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className={styles.track} cx={center} cy={center} r={r} strokeWidth={strokeWidth} />
        {fraction > 0 && (
          <circle
            className={styles.arc}
            cx={center}
            cy={center}
            r={r}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - shown)}
          />
        )}
        {fraction > 0 && fraction < 1 && (
          <g
            className={styles.knobTurn}
            style={{ transformOrigin: `${center}px ${center}px`, transform: `rotate(${shown * 360}deg)` }}
          >
            <circle className={styles.knob} cx={center + r} cy={center} r={strokeWidth / 2 + 2} />
          </g>
        )}
      </svg>
      <div className={styles.middle} aria-hidden="true">
        <span className={styles.count}>{count}</span>
        <span className={cx('type-eyebrow', styles.label)}>{label}</span>
      </div>
    </div>
  );
}
