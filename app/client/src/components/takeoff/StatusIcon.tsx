import { cx, type Status } from './status';
import styles from './StatusIcon.module.css';

// Drawn on a 16px grid with a 2px round stroke. Draw new icons the same way.
const PATHS: Record<Status, string> = {
  cleared: 'M3.5 8.5l3 3 6-7',
  holding: 'M3 8h10M3 8a5 5 0 0 1 5-5M13 8a5 5 0 0 1-5 5',
  grounded: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
};

export interface StatusIconProps {
  status: Status;
  size?: number;
  className?: string;
}

export function StatusIcon({ status, size = 16, className }: StatusIconProps) {
  return (
    <svg
      className={cx(styles.icon, className)}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[status]} />
    </svg>
  );
}
