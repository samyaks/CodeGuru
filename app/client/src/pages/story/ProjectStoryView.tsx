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

export type BuildTarget = { kind: 'next' } | { kind: 'gap'; id: string };
export type CopyResult = 'copied' | 'signin' | 'failed';

function jumpToBuild() {
  const el = document.getElementById('build');
  if (!el) return;
  el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  el.focus({ preventScroll: true });
}

const GAPS_SHOWN = 4;

function copyLabel(state: 'busy' | CopyResult | undefined): string {
  switch (state) {
    case 'busy': return 'Getting the prompt…';
    case 'copied': return 'Copied';
    case 'signin': return 'Sign in to copy';
    case 'failed': return 'Couldn’t copy. Try again';
    default: return 'Copy a prompt for your agent';
  }
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
  /** Copies the prompt for the next feature or a gap; resolves with what happened. */
  onCopyBuild?: (target: BuildTarget) => Promise<CopyResult>;
  /** Shown beside the next feature when its prompt is waiting for a sign-in. */
  onSignIn?: () => void;
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
  onCopyBuild,
  onSignIn,
  onEditTold,
  onRedo,
  readOnly = false,
  oldHref,
}: ProjectStoryViewProps) {
  const [doneOpen, setDoneOpen] = useState<boolean | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const doneId = useId();
  const [buildCopy, setBuildCopy] = useState<{ key: string; state: 'busy' | CopyResult } | null>(null);
  const [allGaps, setAllGaps] = useState(false);
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

  const toldStatus = story.toldStatus ?? (story.told.length > 0 ? 'ready' : 'drafting');
  const status = overall(story.checks);
  const counts = Object.fromEntries(
    STATUSES.map((s) => [s, story.checks.filter((c) => c.status === s).length]),
  ) as Record<Status, number>;
  const first = open[0];
  const showDone = doneOpen ?? open.length === 0;

  const copyBuild = async (key: string, target: BuildTarget) => {
    if (!onCopyBuild) return;
    setBuildCopy({ key, state: 'busy' });
    const state = await onCopyBuild(target).catch((): CopyResult => 'failed');
    setBuildCopy({ key, state });
    window.setTimeout(() => setBuildCopy((c) => (c?.key === key ? null : c)), 2500);
  };
  const copyState = (key: string) => (buildCopy?.key === key ? buildCopy.state : undefined);

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
            ) : story.build ? (
              <Button variant="primary" wide onClick={jumpToBuild}>See what to build next</Button>
            ) : null}
          </VerdictPanel>
          <section aria-labelledby="told-title" className={styles.intent}>
            <div className={styles.sectionHead}>
              <h2 id="told-title" className="type-heading">What you told us</h2>
              {toldStatus === 'ready' && !readOnly && onEditTold ? (
                <Button variant="quiet" size="sm" onClick={onEditTold}>Change answers</Button>
              ) : null}
            </div>
            {toldStatus === 'ready' ? (
              <>
                <p className={cx('type-small', styles.muted)}>
                  Every check on this page is measured against this. If it’s off, say so first.
                </p>
                <ul className={styles.told}>
                  {story.told.map((line) => (
                    <li key={line} className="type-intent">{line}</li>
                  ))}
                </ul>
              </>
            ) : (
              <div role="status" className={styles.toldNote}>
                <p className="type-body">
                  {toldStatus === 'drafting'
                    ? 'We’re still reading what this app is for. It will appear here when it’s done.'
                    : 'We couldn’t load what this app is for.'}
                </p>
                <p className={cx('type-small', styles.muted)}>
                  The checks below can’t be tested against your intent until it’s here.
                </p>
                {toldStatus === 'failed' ? (
                  <div>
                    <Button variant="quiet" size="sm" onClick={onRetry}>Try again</Button>
                  </div>
                ) : null}
              </div>
            )}
          </section>
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

          {story.build ? (
            <section id="build" tabIndex={-1} aria-labelledby="build-title" className={cx(styles.section, styles.build)}>
              <h2 id="build-title" className="type-title">What to build next</h2>
              {story.build.next ? (
                <article className={styles.buildNext}>
                  <p className={cx('type-eyebrow', styles.muted)}>The next feature</p>
                  <h3 className="type-heading">{story.build.next.title}</h3>
                  {story.build.next.why ? (
                    <p className={cx('type-body', styles.muted)}>{story.build.next.why}</p>
                  ) : null}
                  {onCopyBuild && story.build.next.prompt ? (
                    <div className={styles.buildFoot}>
                      <Button variant="quiet" size="sm" onClick={() => void copyBuild('next', { kind: 'next' })}>
                        {copyLabel(copyState('next'))}
                      </Button>
                    </div>
                  ) : story.build.next.gated && onSignIn ? (
                    <div className={styles.buildFoot}>
                      <Button variant="quiet" size="sm" onClick={onSignIn}>Sign in to get the prompt</Button>
                    </div>
                  ) : null}
                </article>
              ) : null}

              {story.build.gaps.length > 0 ? (
                <div className={styles.gapsBlock}>
                  <p className={cx('type-eyebrow', styles.muted)}>And after that</p>
                  <ol className={styles.gaps}>
                    {(allGaps ? story.build.gaps : story.build.gaps.slice(0, GAPS_SHOWN)).map((g) => (
                      <li key={g.id} className={styles.gap}>
                        <h3 className="type-heading">{g.title}</h3>
                        {g.summary ? <p className={cx('type-small', styles.muted)}>{g.summary}</p> : null}
                        {g.jobs.length > 0 ? (
                          <ul className={styles.jobs} aria-label="Who it helps">
                            {g.jobs.slice(0, 3).map((j) => (
                              <li key={`${j.persona}-${j.job}`} className="type-small">
                                {j.persona ? <><span className={styles.persona}>{j.persona}</span>: </> : null}{j.job}
                              </li>
                            ))}
                            {g.jobs.length > 3 ? (
                              <li className={cx('type-small', styles.muted)}>and {g.jobs.length - 3} more</li>
                            ) : null}
                          </ul>
                        ) : null}
                        {onCopyBuild ? (
                          <div className={styles.buildFoot}>
                            <Button
                              variant="quiet"
                              size="sm"
                              onClick={() => void copyBuild(`gap:${g.id}`, { kind: 'gap', id: g.id })}
                            >
                              {copyLabel(copyState(`gap:${g.id}`))}
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                  {story.build.gaps.length > GAPS_SHOWN ? (
                    <div>
                      <Button variant="quiet" size="sm" aria-expanded={allGaps} onClick={() => setAllGaps(!allGaps)}>
                        {allGaps ? 'Show fewer' : `Show ${story.build.gaps.length - GAPS_SHOWN} more`}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <span className={styles.srOnly} role="status">
                {buildCopy && buildCopy.state !== 'busy' ? copyLabel(buildCopy.state) : ''}
              </span>
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
            <p className={cx('type-small', styles.muted)}>Project updated {story.readAt}.</p>
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
