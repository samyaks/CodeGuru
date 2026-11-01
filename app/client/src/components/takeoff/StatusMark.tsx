import { StatusIcon } from './StatusIcon';
import { STATUS, cx, type Status } from './status';
import styles from './StatusMark.module.css';

export interface StatusMarkProps {
  status: Status;
  /** Show the plain meaning beside the chip. Do this on first use in a screen. */
  showHint?: boolean;
  /** Replaces the default hint ("Matches your plan"). */
  hint?: string;
}

export function StatusMark({ status, showHint, hint }: StatusMarkProps) {
  const chip = (
    <span className={cx(styles.chip, styles[status])}>
      <StatusIcon status={status} />
      {STATUS[status].word}
    </span>
  );
  if (!showHint) return chip;
  return (
    <span className={styles.wrap}>
      {chip}
      <span className={styles.hint}>{hint ?? STATUS[status].hint}</span>
    </span>
  );
}
