import { cx } from '../../components/takeoff/status';
import type { AskView } from '../../services/askApi';
import { SUGGESTIONS } from './questions';
import styles from './Ask.module.css';

/** Suggested questions for this person's view. Picking one fills the box; it is never asked for them. */
export function Suggestions({ view, onPick }: { view: AskView; onPick: (q: string) => void }) {
  const list = SUGGESTIONS[view];
  return (
    <div className={styles.suggestions}>
      <p className={cx('type-eyebrow', styles.muted)}>Try asking</p>
      <ul className={styles.suggestionList}>
        {list.map((q) => (
          <li key={q}><button type="button" className={cx('type-small', styles.suggestion)} onClick={() => onPick(q)}>{q}</button></li>
        ))}
      </ul>
    </div>
  );
}
