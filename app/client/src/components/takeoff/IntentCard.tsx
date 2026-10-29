import { StatusMark } from './StatusMark';
import { cx, type Status } from './status';
import styles from './IntentCard.module.css';

export interface IntentCardProps {
  /** The person's own words, exactly as written in their plan. */
  intent: string;
  status: Status;
  /** One or two sentences on why, describing what someone would notice in the app. */
  explanation?: string;
  /** How many changes were checked against this intent. */
  changes?: number;
  /** Position in the plan, shown as "Intent 02". */
  index?: number;
}

export function IntentCard({ intent, status, explanation, changes, index }: IntentCardProps) {
  const eyebrow = index != null ? `Intent ${String(index).padStart(2, '0')}` : 'Intent';
  return (
    <article className={styles.card}>
      <p className={cx('type-eyebrow', styles.eyebrow)}>{eyebrow}</p>
      <p className={cx('type-intent', styles.intent)}>{intent}</p>
      {explanation && <p className={cx('type-body', styles.explanation)}>{explanation}</p>}
      <div className={cx('type-small', styles.foot)}>
        <span>
          {changes != null && `Checked against ${changes} ${changes === 1 ? 'change' : 'changes'}`}
        </span>
        <StatusMark status={status} />
      </div>
    </article>
  );
}
