import { useEffect, useRef, useState } from 'react';
import Header from '../../components/Header';
import { Button, PlanInput, StatusMark } from '../../components/takeoff';
import { cx } from '../../components/takeoff/status';
import type { IntakeFinding, IntakeQuestion, IntakeScript } from './types';
import styles from './IntakeView.module.css';

function unsureChoice(q: IntakeQuestion): string {
  return (q.choices.find((c) => c.unsure) ?? q.choices[q.choices.length - 1]).id;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function FindingRow({ finding, showHint }: { finding: IntakeFinding; showHint?: boolean }) {
  return (
    <li className={styles.finding}>
      <div className={styles.findingTop}>
        <span className="type-body">{finding.label}</span>
        <StatusMark status={finding.status} showHint={showHint} />
      </div>
      <p className={cx('type-small', styles.muted)}>{finding.note}</p>
    </li>
  );
}

export interface IntakeViewProps {
  script: IntakeScript;
  /** Called with the answer chosen for each question, keyed by question id. */
  onFinish: (answers: Record<string, string>) => void;
}

// The intake conversation: Takeoff proposes what the person is building from
// their code, they correct it, and Takeoff asks a few questions where the code
// is silent. Bounded on purpose: a handful of turns, each answer a button, and
// the result is a set of answers, not a transcript. No data loading, so
// /design/intake can render it with a made-up script in development.
export function IntakeView({ script, onFinish }: IntakeViewProps) {
  const { questions } = script;
  const [draftText, setDraftText] = useState(script.draft);
  const [editingDraft, setEditingDraft] = useState(false);
  const [draftOk, setDraftOk] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [reopen, setReopen] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  const answered = questions.filter((q) => answers[q.id]).length;
  const nextIndex = questions.findIndex((q) => !answers[q.id]);
  const finished = draftOk && nextIndex === -1;
  const shown = !draftOk ? 0 : nextIndex === -1 ? questions.length : nextIndex + 1;

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    endRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'nearest',
    });
  }, [shown, finished]);

  const choose = (q: IntakeQuestion, choiceId: string) => {
    setAnswers((a) => ({ ...a, [q.id]: choiceId }));
    setReopen(null);
  };

  const skipRest = () => {
    setAnswers((a) => {
      const next = { ...a };
      for (const q of questions) if (!next[q.id]) next[q.id] = unsureChoice(q);
      return next;
    });
  };

  return (
    <div className={cx('takeoff', styles.page)}>
      <Header variant="takeoff" />

      <main className={styles.main}>
        <div className={styles.talk}>
          <header className={styles.lede}>
            <p className={cx('type-eyebrow', styles.muted)}>
              {finished
                ? 'All answered'
                : draftOk && nextIndex >= 0
                  ? `Question ${nextIndex + 1} of ${questions.length}`
                  : 'Before we check'}
            </p>
            <h1 className="type-display">What are you building?</h1>
          </header>

          <div className={styles.thread} aria-live="polite">
            <section className={styles.turn}>
              <p className={cx('type-eyebrow', styles.muted)}>Takeoff</p>
              <p className="type-heading">I read your code. Here’s what I think you’re building.</p>
              {editingDraft ? (
                <>
                  <PlanInput
                    label="What you’re building"
                    hint="Change anything that’s off. Plain words are fine."
                    rows={4}
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                  />
                  <div className={styles.row}>
                    <Button variant="quiet" size="sm" onClick={() => setEditingDraft(false)}>
                      Save changes
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <blockquote className={cx('type-intent', styles.draft)}>{draftText}</blockquote>
                  <div className={styles.row}>
                    {!draftOk ? (
                      <Button variant="quiet" onClick={() => setDraftOk(true)}>That’s right</Button>
                    ) : null}
                    <Button
                      variant="quiet"
                      size={draftOk ? 'sm' : 'md'}
                      onClick={() => setEditingDraft(true)}
                    >
                      Change it
                    </Button>
                  </div>
                </>
              )}
            </section>

            {questions.slice(0, shown).map((q) => {
              const picked = answers[q.id];
              const choice = q.choices.find((c) => c.id === picked);
              const isOpen = !picked || reopen === q.id;
              return (
                <section key={q.id} className={styles.turn}>
                  <p className={cx('type-eyebrow', styles.muted)}>Takeoff</p>
                  <p className="type-heading" id={`ask-${q.id}`}>{q.ask}</p>
                  {q.because ? <p className={cx('type-small', styles.muted)}>{q.because}</p> : null}

                  {isOpen ? (
                    <>
                      <div className={styles.choices} role="group" aria-labelledby={`ask-${q.id}`}>
                        {q.choices.map((c) => (
                          <Button
                            key={c.id}
                            variant="quiet"
                            aria-pressed={picked === c.id}
                            className={cx(picked === c.id && styles.picked)}
                            onClick={() => choose(q, c.id)}
                          >
                            {c.label}
                          </Button>
                        ))}
                      </div>
                      {!picked && nextIndex >= 0 && questions.length - answered > 1 ? (
                        <div className={styles.row}>
                          <Button variant="quiet" size="sm" onClick={skipRest}>Skip the rest</Button>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className={styles.reply}>
                      <p className={cx('type-eyebrow', styles.muted)}>You</p>
                      <p className="type-intent">{choice?.label}</p>
                      {choice?.meaning ? (
                        <p className={cx('type-small', styles.muted)}>{choice.meaning}</p>
                      ) : null}
                      <div className={styles.row}>
                        <Button variant="quiet" size="sm" onClick={() => setReopen(q.id)}>Change</Button>
                      </div>
                    </div>
                  )}
                </section>
              );
            })}

            {finished ? (
              <section className={styles.turn}>
                <p className={cx('type-eyebrow', styles.muted)}>Takeoff</p>
                <p className="type-heading">That’s all I need.</p>
                <p className={cx('type-body', styles.muted)}>
                  I’ll check your app against what you told me. You can change any answer later.
                </p>
                <div className={styles.row}>
                  <Button variant="primary" onClick={() => onFinish(answers)}>
                    Check my app against this
                  </Button>
                </div>
              </section>
            ) : null}
            <div ref={endRef} />
          </div>
        </div>

        <aside className={styles.aside} aria-label="What we’ll check">
          <div>
            <h2 className="type-heading">What we’ll check</h2>
            <p className={cx('type-small', styles.muted)}>
              {answered} of {questions.length} answered
            </p>
          </div>

          <section className={styles.group}>
            <p className={cx('type-eyebrow', styles.muted)}>Already in your code</p>
            <ul className={styles.list}>
              {script.alreadyFound.map((f, i) => (
                <FindingRow key={f.label} finding={f} showHint={i === 0} />
              ))}
            </ul>
          </section>

          <section className={styles.group}>
            <p className={cx('type-eyebrow', styles.muted)}>From your answers</p>
            <ul className={styles.list}>
              {questions.map((q) => {
                const picked = answers[q.id];
                const choice = q.choices.find((c) => c.id === picked);
                if (!picked) {
                  return (
                    <li key={q.id} className={styles.finding}>
                      <span className={cx('type-body', styles.muted)}>{q.topic}</span>
                      <p className={cx('type-small', styles.muted)}>Waiting for your answer.</p>
                    </li>
                  );
                }
                if (choice?.skips) {
                  return (
                    <li key={q.id} className={styles.finding}>
                      <span className="type-body">{q.topic}</span>
                      <p className={cx('type-small', styles.muted)}>Skipped. {choice.meaning}</p>
                    </li>
                  );
                }
                return <FindingRow key={q.id} finding={q.finding} />;
              })}
            </ul>
          </section>
        </aside>
      </main>
    </div>
  );
}
