import type { ReactNode } from 'react';
import { StatusIcon } from './StatusIcon';
import { STATUS, STATUSES, cx, type Status } from './status';
import styles from './VerdictPanel.module.css';

export interface VerdictPanelProps {
  status: Status;
  summary?: string;
  /** Rows are shown only for the statuses given. */
  counts?: Partial<Record<Status, number>>;
  eyebrow?: string;
  /** At most two Buttons: one "primary", the rest "night". */
  children?: ReactNode;
}

export function VerdictPanel({ status, summary, counts = {}, eyebrow = 'Verdict', children }: VerdictPanelProps) {
  const rows = STATUSES.filter((s) => counts[s] != null);
  return (
    <aside className={cx(styles.panel, styles[status])} aria-label={eyebrow}>
      <div>
        <p className={cx('type-eyebrow', styles.eyebrow)}>{eyebrow}</p>
        <p className={styles.word}>
          <StatusIcon status={status} size={28} className={styles.wordIcon} />
          {STATUS[status].word}
        </p>
      </div>
      {summary && <p className={cx('type-body', styles.summary)}>{summary}</p>}
      {rows.length > 0 && (
        <ul className={styles.rows}>
          {rows.map((s) => (
            <li key={s} className={styles.row}>
              <span className={styles.rowKey}>
                <span className={cx(styles.dot, styles[`dot-${s}`])} aria-hidden="true" />
                {STATUS[s].word}
              </span>
              <span className={styles.rowValue}>{counts[s]}</span>
            </li>
          ))}
        </ul>
      )}
      {children && <div className={styles.actions}>{children}</div>}
    </aside>
  );
}
