import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, ButtonLink, StatusMark, type Status } from '../../components/takeoff';
import { cx } from '../../components/takeoff/status';
import { ApiError } from '../../lib/api-error';
import { fetchOverview, type Overview, type OverviewPr, type PendingAgreement, type Verdict, type View } from '../../services/overviewApi';
import { AGREEMENTS_CHANGED_EVENT } from './AgreementsSection';
import { decisionLine } from './DriftSection';
import { LogLinks, logSentence } from './logLine';
import styles from './Team.module.css';
import { TEAM_CHANGED_EVENT } from './TeamSection';

const VERDICT: Record<Verdict, { status: Status; hint: string }> = {
  matches: { status: 'cleared', hint: 'Matches takeoff.yaml' },
  drifts: { status: 'grounded', hint: 'Drifts from takeoff.yaml' },
  needs_decision: { status: 'holding', hint: 'Needs a decision' },
};

const INTENT_REASON: Record<string, (branch: string | null) => string> = {
  no_takeoff_yaml: (b) => `There’s no takeoff.yaml on ${b || 'the default branch'} yet, so there are no areas to show.`,
  invalid_takeoff_yaml: (b) => `takeoff.yaml on ${b || 'the default branch'} has errors, so its areas can’t be shown. Run \`takeoff validate\` to see them.`,
  github_unavailable: () => 'Takeoff can’t reach GitHub right now, so the areas aren’t shown. Reload in a minute.',
  app_not_installed: () => 'Connect this project to GitHub through the Takeoff App to see its areas and pull requests.',
};

function connectGithub() {
  const back = `${window.location.pathname}${window.location.search}`;
  window.location.href = `/api/github-app/authorize?returnTo=${encodeURIComponent(back)}`;
}

function PrRow({ pr, projectId, showAuthor }: { pr: OverviewPr; projectId: string; showAuthor: boolean }) {
  const v = pr.verdict ? VERDICT[pr.verdict] : null;
  return (
    <li className={styles.row}>
      <div className={styles.who}>
        <span className="type-body">PR #{pr.prNumber}{pr.title ? `: ${pr.title}` : ''}</span>
        {v ? <span><StatusMark status={v.status} showHint hint={v.hint} /></span> : null}
        {showAuthor && pr.author ? <span className={cx('type-small', styles.muted)}>Opened by {pr.author}</span> : null}
        {pr.summary && pr.verdict !== 'matches' ? <span className={cx('type-small', styles.muted)}>{pr.summary}</span> : null}
        {pr.checking ? <span className={cx('type-small', styles.muted)}>Takeoff is checking this pull request now.</span> : null}
        {pr.checkFailed ? <span className={cx('type-small', styles.muted)}>The latest Takeoff check didn’t finish. Re-run it from the check on GitHub.</span> : null}
        {pr.newerPush ? <span className={cx('type-small', styles.muted)}>There’s a newer push that Takeoff hasn’t checked yet.</span> : null}
        {pr.lastDecision ? <span className={cx('type-small', styles.muted)}>{decisionLine(pr.lastDecision)}</span> : null}
      </div>
      <div className={styles.actions}>
        {pr.needsDecision ? (
          <ButtonLink variant="quiet" size="sm" to={`/read/${encodeURIComponent(projectId)}/drift/${pr.prNumber}`}>Review</ButtonLink>
        ) : null}
        {pr.url && /^https:\/\//i.test(pr.url) ? (
          <a className={cx('type-small', styles.link)} href={pr.url} target="_blank" rel="noreferrer noopener">On GitHub</a>
        ) : null}
      </div>
    </li>
  );
}

function AgreementRow({ a }: { a: PendingAgreement }) {
  const yours = a.yourVote === 'agree' ? 'You agreed.' : a.yourVote === 'not_yet' ? 'You said not yet.' : 'You haven’t voted yet.';
  return (
    <li className={styles.row}>
      <div className={styles.who}>
        <span className="type-body">“{a.text}”</span>
        <span className={cx('type-small', styles.muted)}>
          {a.areaName ? `${a.areaName}. ` : ''}Proposed by {a.proposedBy.name || 'a teammate'}. {a.agreed} of {a.members} agreed
          {a.notYet ? `, ${a.notYet} said not yet` : ''}. {yours}
        </span>
      </div>
      <div className={styles.actions}>
        <a className={cx('type-small', styles.link)} href="#agreements-title">Vote</a>
      </div>
    </li>
  );
}

/**
 * The project at a glance (Milestone 7). A Creator lands on what waits for a
 * decision; a Builder on their own pull requests. Either can switch.
 * Renders nothing for people who aren't members.
 */
export function OverviewSection({ projectId }: { projectId: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);

  // Only the newest request may set state, so a slow answer can't overwrite a newer one.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const next = await fetchOverview(projectId);
      if (ticket !== latest.current) return;
      setData(next);
      setHidden(false);
      setError(null);
    } catch (err) {
      if (ticket !== latest.current) return;
      if (err instanceof ApiError && [401, 403, 404, 503].includes(err.status)) setHidden(true);
      else setError((err as Error).message || 'Couldn’t load the overview.');
    }
  }, [projectId]);

  // Another project starts from nothing, not from the last one's overview.
  useEffect(() => {
    setData(null);
    setHidden(false);
    setError(null);
    setView(null);
    void load();
  }, [load]);
  useEffect(() => {
    const onChange = () => { void load(); };
    window.addEventListener(TEAM_CHANGED_EVENT, onChange);
    window.addEventListener(AGREEMENTS_CHANGED_EVENT, onChange);
    return () => {
      window.removeEventListener(TEAM_CHANGED_EVENT, onChange);
      window.removeEventListener(AGREEMENTS_CHANGED_EVENT, onChange);
    };
  }, [load]);

  if (hidden) return null;
  const shown: View = view || data?.view.default || 'creator';
  const logHref = `/read/${encodeURIComponent(projectId)}/decisions`;

  const toDecide = data?.pullRequests.filter((p) => p.needsDecision) || [];
  const mine = data?.pullRequests.filter((p) => p.yours) || [];

  return (
    <section aria-labelledby="overview-title" className={styles.section}>
      <div className={styles.head}>
        <h2 id="overview-title" className="type-title">Overview</h2>
        <div className={styles.switch} role="group" aria-label="Show">
          <Button variant="quiet" size="sm" aria-pressed={shown === 'creator'} onClick={() => setView('creator')}>Needs a decision</Button>
          <Button variant="quiet" size="sm" aria-pressed={shown === 'builder'} onClick={() => setView('builder')}>Your pull requests</Button>
        </div>
      </div>
      {error ? <p role="alert" className={cx('type-small', styles.error)}>{error}</p> : null}
      {!data ? (
        <p className={cx('type-small', styles.muted)} role="status">Loading the overview…</p>
      ) : (
        <>
          {shown === 'creator' ? (
            <div className={styles.block}>
              <h3 className="type-body">Waiting on a decision</h3>
              {!toDecide.length && !data.pendingAgreements.length ? (
                <p className={cx('type-small', styles.muted)}>Nothing is waiting on a decision.</p>
              ) : (
                <ul className={styles.list}>
                  {toDecide.map((pr) => <PrRow key={`pr${pr.prNumber}`} pr={pr} projectId={projectId} showAuthor />)}
                  {data.pendingAgreements.map((a) => <AgreementRow key={a.id} a={a} />)}
                </ul>
              )}
            </div>
          ) : (
            <div className={styles.block}>
              <h3 className="type-body">Your open pull requests</h3>
              {!data.githubLinked ? (
                <div className={styles.inviteRow}>
                  <p className={cx('type-small', styles.muted)}>Connect GitHub so Takeoff knows which pull requests are yours.</p>
                  <Button variant="quiet" size="sm" onClick={connectGithub}>Connect GitHub</Button>
                </div>
              ) : !mine.length && !data.githubReachable ? (
                <p className={cx('type-small', styles.muted)}>Takeoff can’t reach GitHub right now, so it can’t tell which pull requests are yours. Reload in a minute.</p>
              ) : !mine.length ? (
                <p className={cx('type-small', styles.muted)}>None of your open pull requests has a Takeoff check yet.</p>
              ) : (
                <ul className={styles.list}>
                  {mine.map((pr) => <PrRow key={pr.prNumber} pr={pr} projectId={projectId} showAuthor={false} />)}
                </ul>
              )}
            </div>
          )}

          <div className={styles.block}>
            <h3 className="type-body">Areas</h3>
            {!data.areas.length ? (
              <p className={cx('type-small', styles.muted)}>
                {(INTENT_REASON[data.intent.reason || ''] || (() => 'takeoff.yaml has no areas yet.'))(data.intent.branch)}
              </p>
            ) : (
              <ul className={styles.list}>
                {data.areas.map((a) => (
                  <li key={a.id} className={styles.row}>
                    <div className={styles.who}>
                      <span className="type-body">{a.name}</span>
                      <span className={cx('type-small', styles.muted)}>
                        {a.creators.length
                          ? `${a.creators.length === 1 ? 'Creator' : 'Creators'}: ${a.creators.map((c) => c.name || c.email).join(', ')}`
                          : 'No Creator yet, so drift here goes to everyone with write access.'}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {data.linked ? (
            <div className={styles.block}>
              <h3 className="type-body">Open pull requests</h3>
              {!data.pullRequests.length ? (
                <p className={cx('type-small', styles.muted)}>No open pull request has a Takeoff check yet.</p>
              ) : (
                <ul className={styles.list}>
                  {data.pullRequests.map((pr) => <PrRow key={pr.prNumber} pr={pr} projectId={projectId} showAuthor />)}
                </ul>
              )}
            </div>
          ) : null}

          <div className={styles.block}>
            <div className={styles.head}>
              <h3 className="type-body">Recent decisions</h3>
              <Link className={cx('type-small', styles.link)} to={logHref}>See the decision log</Link>
            </div>
            {!data.recentDecisions.length ? (
              <p className={cx('type-small', styles.muted)}>Nothing has been decided yet.</p>
            ) : (
              <ul className={styles.list}>
                {data.recentDecisions.map((e) => (
                  <li key={`${e.kind}${e.id}`} className={styles.row}>
                    <div className={styles.who}>
                      <span className="type-small">{logSentence(e)}</span>
                      <LogLinks entry={e} className={cx('type-small', styles.muted)} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
