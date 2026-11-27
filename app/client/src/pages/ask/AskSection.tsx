import { useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/takeoff';
import { cx } from '../../components/takeoff/status';
import { Suggestions } from './Suggestions';
import { MAX_QUESTION, askPath, useAskAccess, type AskRouteState } from './handoff';
import styles from './Ask.module.css';

const nonce = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

/**
 * Ask Takeoff on the project page (Milestone 8). Shown only to people Ask is
 * on for here. Pressing Ask opens the conversation page, which asks it.
 */
export function AskSection({ projectId }: { projectId: string }) {
  const { available, threads, view } = useAskAccess(projectId);
  const navigate = useNavigate();
  const boxId = useId();
  const [question, setQuestion] = useState('');

  if (!available) return null;

  const submit = () => {
    const q = question.trim();
    if (!q) return;
    const state: AskRouteState = { ask: { question: q.slice(0, MAX_QUESTION), nonce: nonce(), at: Date.now() } };
    navigate(askPath(projectId), { state });
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <section aria-labelledby="ask-title" className={styles.section}>
      <div className={styles.head}>
        <h2 id="ask-title" className="type-title">Ask Takeoff</h2>
      </div>
      <p className={cx('type-small', styles.muted)}>
        Ask about the plan, what the team agreed and decided, or the code. Each part of an answer says where it came
        from. Only you see your questions.
      </p>
      <form className={styles.composer} onSubmit={onSubmit}>
        <label htmlFor={boxId} className="type-heading">What do you want to know?</label>
        <textarea
          id={boxId}
          className={cx('type-body', styles.input)}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          maxLength={MAX_QUESTION}
          placeholder="For example: what does the plan say about refunds?"
        />
        <div className={styles.composerRow}>
          <span className={cx('type-small', styles.muted)}>Takeoff only reads. It never changes the repo or the plan.</span>
          <Button variant="quiet" type="submit" disabled={!question.trim()}>Ask</Button>
        </div>
      </form>
      {!question ? <Suggestions view={view} onPick={setQuestion} /> : null}
      {threads.length ? (
        <div className={styles.sources}>
          <p className={cx('type-eyebrow', styles.muted)}>Your questions</p>
          <ul className={styles.threads}>
            {threads.slice(0, 5).map((t) => (
              <li key={t.id}>
                <Link className={styles.threadLink} to={askPath(projectId, t.id)}>
                  <span className={styles.threadTitle}>{t.title || 'Untitled'}</span>
                  <span className={cx('type-small', styles.muted)}>{day(t.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** "Ask about this": opens a new conversation with the question filled in. It is never asked until the person presses Ask. */
export function AskAbout({ projectId, question, className, before }: { projectId: string; question: string; className?: string; before?: string }) {
  const { available } = useAskAccess(projectId);
  if (!available) return null;
  const state: AskRouteState = { prefill: question.slice(0, MAX_QUESTION) };
  return <>{before}<Link className={cx(styles.aboutLink, className)} to={askPath(projectId)} state={state}>Ask about this</Link></>;
}
