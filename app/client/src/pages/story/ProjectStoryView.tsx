import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { AlertCircle, ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import Header from '../../components/Header';
import {
  ArchitectureMap,
  Button,
  ButtonLink,
  ChangeNote,
  IntentCard,
  StatusMark,
  VerdictPanel,
} from '../../components/takeoff';
import { STATUSES, cx, type Status } from '../../components/takeoff/status';
import type { LaunchCheck, ProjectStory } from './types';
import styles from './ProjectStoryView.module.css';

const RANK: Record<Status, number> = { grounded: 0, holding: 1, cleared: 2 };

function overall(checks: LaunchCheck[]): Status {
  if (checks.some((c) => c.status === 'grounded')) return 'grounded';
  if (checks.some((c) => c.status === 'holding')) return 'holding';
  return 'cleared';
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Scrolls to a check's card, then calls `done` once the scroll has settled. */
function jumpTo(id: string, done: () => void) {
  const el = document.getElementById(`check-${id}`);
  if (!el) return;
  const reduced = prefersReducedMotion();
  el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  el.focus({ preventScroll: true });
  if (reduced) {
    done();
    return;
  }
  // `scrollend` where supported; otherwise a timer long enough for a smooth scroll.
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    window.removeEventListener('scrollend', finish);
    window.clearTimeout(fallback);
    done();
  };
  const fallback = window.setTimeout(finish, 900);
  window.addEventListener('scrollend', finish, { once: true });
}

export interface ProjectStoryViewProps {
  /** null with no error and not loading means nothing has been captured yet. */
  story: ProjectStory | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** Where the intake conversation lives, offered when there is no plan yet. */
  intakeHref?: string;
  /** The previous version of this page, linked from the top and the foot. */
  oldHref?: string;
  onCopyPrompt?: (checkId: string) => void;
  onEditTold?: () => void;
  onRedo?: () => void;
  /** Signed-out and non-owner visitors: no editing or copying. */
  readOnly?: boolean;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className={cx('takeoff', styles.page)}>
      <Header variant="takeoff" />
      {children}
    </div>
  );
}

function Notice({ title, description, action, busy }: {
  title: string;
  description?: string;
  action?: ReactNode;
  busy?: boolean;
}) {
  return (
    <main className={styles.notice} role={busy ? 'status' : undefined}>
      {!busy && <AlertCircle size={24} className={styles.muted} aria-hidden="true" />}
      <h1 className="type-title">{title}</h1>
      {description ? <p className={cx('type-body', styles.muted)}>{description}</p> : null}
      {action ? <div>{action}</div> : null}
    </main>
  );
}

// The project page as one story: the verdict, what the person told us, what to
// do next, what is already fine, and what changed lately. No data loading, so
// /design/project can render it with made-up data in development.
export function ProjectStoryView({
  story,
  loading,
  error,
  onRetry,
  intakeHref,
  onCopyPrompt,
  onEditTold,
  onRedo,
  readOnly = false,
  oldHref,
}: ProjectStoryViewProps) {
  const [doneOpen, setDoneOpen] = useState<boolean | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const doneId = useId();
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const goTo = (id: string) => {
    setHighlightId(null);
    jumpTo(id, () => setHighlightId(id));
  };

  useEffect(() => {
    if (!highlightId) return undefined;
    const t = window.setTimeout(() => setHighlightId(null), 3000);
    return () => window.clearTimeout(t);
  }, [highlightId]);

  useEffect(() => {
    if (!copiedId) return undefined;
    const t = window.setTimeout(() => setCopiedId(null), 2000);
    return () => window.clearTimeout(t);
  }, [copiedId]);

  const { open, done } = useMemo(() => {
    const checks = story?.checks ?? [];
    return {
      open: checks.filter((c) => c.status !== 'cleared').sort((a, b) => RANK[a.status] - RANK[b.status]),
      done: checks.filter((c) => c.status === 'cleared'),
    };
  }, [story]);

  if (loading) {
    return (
      <Shell>
        <Notice busy title="Reading your project" description="This page fills in as soon as the read finishes." />
      </Shell>
    );
  }

  if (error) {
    return (
      <Shell>
        <Notice
          title="We couldn’t load this project"
          description={error}
          action={<Button variant="quiet" size="sm" onClick={onRetry}>Try again</Button>}
        />
      </Shell>
    );
  }

  if (!story || story.checks.length === 0) {
    return (
      <Shell>
        <Notice
          title={intakeHref ? 'Tell us what you’re building' : 'Nothing to show yet'}
          description={
            intakeHref
              ? 'Answer a few questions and Takeoff checks your app against what you say it needs.'
              : 'We haven’t finished reading this project. Check back in a minute.'
          }
          action={
            readOnly || !intakeHref ? undefined : (
              <ButtonLink variant="primary" to={intakeHref}>Start the questions</ButtonLink>
            )
          }
        />
      </Shell>
    );
  }

  const status = overall(story.checks);
  const counts = Object.fromEntries(
    STATUSES.map((s) => [s, story.checks.filter((c) => c.status === s).length]),
  ) as Record<Status, number>;
  const first = open[0];
  const showDone = doneOpen ?? open.length === 0;

  const copy = (id: string) => {
    onCopyPrompt?.(id);
    setCopiedId(id);
  };

  return (
    <Shell>
      <main className={styles.main}>
        <div className={styles.panel}>
          <VerdictPanel status={status} eyebrow="Before you launch" counts={counts}>
            {first ? (
              <Button variant="primary" wide onClick={() => goTo(first.id)}>
                Start with {first.label.toLowerCase()}
              </Button>
            ) : null}
          </VerdictPanel>
        </div>

        <div className={styles.read}>
          <header className={styles.lede}>
            <div className={styles.nameRow}>
              <p className={cx('type-heading', styles.name)}>{story.name}</p>
              {oldHref ? (
                <Link className={cx('type-small', styles.oldLink)} to={oldHref}>See the old version</Link>
              ) : null}
            </div>
            <h1 className={cx('type-display', styles.headline)}>{story.headline}</h1>
            <p className={cx('type-body', styles.muted)}>{story.support}</p>
          </header>

          <ArchitectureMap
            name={story.name.split('/').pop() ?? story.name}
            nodes={story.checks.map((c) => ({ id: c.id, label: c.label, status: c.status }))}
            onSelect={goTo}
          />

          {story.told.length > 0 ? (
          <section aria-labelledby="told-title" className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 id="told-title" className="type-title">What you told us</h2>
              {!readOnly && onEditTold ? (
                <Button variant="quiet" size="sm" onClick={onEditTold}>Change answers</Button>
              ) : null}
            </div>
            <ul className={styles.told}>
              {story.told.map((line) => (
                <li key={line} className="type-intent">{line}</li>
              ))}
            </ul>
          </section>
          ) : null}

          {open.length > 0 ? (
            <section aria-labelledby="next-title" className={styles.section}>
              <h2 id="next-title" className="type-title">Next up</h2>
              <ol className={styles.checks}>
                {open.map((c) => (
                  <li
                    key={c.id}
                    id={`check-${c.id}`}
                    tabIndex={-1}
                    className={cx(styles.check, styles[c.status], highlightId === c.id && styles.highlight)}
                  >
                    <IntentCard
                      intent={c.need}
                      status={c.status}
                      explanation={c.explanation}
                      changes={c.changes}
                    />
                    <div className={styles.checkFoot}>
                      <span className={cx('type-small', styles.muted)}>
                        {c.where ? `In your app: ${c.where}` : ''}
                      </span>
                      {!readOnly && onCopyPrompt ? (
                        <Button variant="quiet" size="sm" onClick={() => copy(c.id)}>
                          {copiedId === c.id ? 'Copied' : 'Copy a prompt for your agent'}
                        </Button>
                      ) : null}
                      <span className={styles.srOnly} role="status">
                        {copiedId === c.id ? 'Prompt copied' : ''}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {done.length > 0 ? (
          <section className={styles.section}>
            <h2 className={cx('type-title', styles.disclosureTitle)}>
              <button
                type="button"
                className={styles.disclosure}
                aria-expanded={showDone}
                aria-controls={doneId}
                onClick={() => setDoneOpen(!showDone)}
              >
                <ChevronDown
                  size={20}
                  className={cx(styles.chevron, showDone && styles.chevronOpen)}
                  aria-hidden="true"
                />
                {done.length} already in place
              </button>
            </h2>
            <ul id={doneId} className={styles.done} hidden={!showDone}>
              {done.map((c) => (
                <li key={c.id} className={styles.doneRow}>
                  <span className="type-intent">{c.need}</span>
                  <StatusMark status="cleared" />
                </li>
              ))}
            </ul>
          </section>
          ) : null}

          {story.shipped.length > 0 ? (
          <section aria-labelledby="changed-title" className={styles.section}>
            <h2 id="changed-title" className="type-title">What changed lately</h2>
            <ol className={styles.shipped}>
              {story.shipped.map((s) => (
                <li key={s.id} className={styles.shippedItem}>
                  <span className={cx('type-small', styles.muted)}>{s.when}</span>
                  <ChangeNote summary={s.summary} status={s.status} where={s.where} />
                </li>
              ))}
            </ol>
          </section>
          ) : null}

          <footer className={styles.foot}>
            <p className={cx('type-small', styles.muted)}>Read from your code {story.readAt}.</p>
            {oldHref ? (
              <Link className={cx('type-small', styles.oldLink)} to={oldHref}>See the old version</Link>
            ) : null}
            {!readOnly && onRedo ? (
              <Button variant="quiet" size="sm" onClick={onRedo}>Redo from your code</Button>
            ) : null}
          </footer>
        </div>
      </main>
    </Shell>
  );
}
