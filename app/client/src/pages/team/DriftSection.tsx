import { useCallback, useEffect, useState } from 'react';
import { ButtonLink, StatusMark } from '../../components/takeoff';
import { cx } from '../../components/takeoff/status';
import { ApiError } from '../../lib/api-error';
import { fetchDriftList, type Decision, type DriftList } from '../../services/driftApi';
import styles from './Team.module.css';
import { TEAM_CHANGED_EVENT } from './TeamSection';

const who = (d: Decision) => d.by.name || 'a teammate';

/** One line on what happened to a decision. Shared with the review page. */
export function decisionLine(d: Decision): string {
  const what = d.type === 'accepted' ? 'accept the change into takeoff.yaml' : 'send it back';
  switch (d.state) {
    case 'done':
      return d.type === 'accepted'
        ? `Accepted by ${who(d)}${d.confirmedBy ? `, confirmed by ${d.confirmedBy.name || 'a teammate'}` : ''}. ${d.commitUrl ? 'takeoff.yaml on the PR’s branch was updated.' : 'The PR’s own takeoff.yaml was accepted as it is, so nothing new was committed.'}`
        : `Sent back by ${who(d)}${d.confirmedBy ? `, confirmed by ${d.confirmedBy.name || 'a teammate'}` : ''}, with a note on the PR.`;
    case 'waiting_for_write':
      return `${who(d)} asked to ${what}. Someone with write access to the repo can confirm it under “Who’s on this project”.`;
    case 'dismissed':
      return d.error
        ? `${who(d)} asked to ${what}. ${d.error}`
        : `${who(d)} asked to ${what}, and the request was dismissed.`;
    case 'failed':
      return `${who(d)} tried to ${what}, and it didn’t work: ${d.error || 'GitHub refused the change.'}`;
    default:
      return `${who(d)} is deciding on it now…`;
  }
}

/**
 * Pull requests the PR check says drift from takeoff.yaml or need a
 * decision. Renders nothing for people who aren't members, or when there's
 * nothing to review.
 */
export function DriftSection({ projectId }: { projectId: string }) {
  const [data, setData] = useState<DriftList | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchDriftList(projectId));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && [401, 403, 404, 503].includes(err.status)) setHidden(true);
      else setError((err as Error).message || 'Couldn’t load the pull requests to review.');
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);
  // Confirming a recommendation under the team list can settle a decision.
  useEffect(() => {
    const onChange = () => { void load(); };
    window.addEventListener(TEAM_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(TEAM_CHANGED_EVENT, onChange);
  }, [load]);

  if (hidden || (data && !data.reviews.length)) return null;

  return (
    <section aria-labelledby="drift-title" className={styles.section}>
      <div className={styles.head}>
        <h2 id="drift-title" className="type-title">Pull requests to review</h2>
      </div>
      <p className={cx('type-small', styles.muted)}>
        Takeoff checked these against takeoff.yaml and found something a person should decide: accept the change into the
        intent, or send it back with a note.
      </p>
      {error ? <p role="alert" className={cx('type-small', styles.error)}>{error}</p> : null}
      {!data ? (
        <p className={cx('type-small', styles.muted)} role="status">Loading pull requests…</p>
      ) : (
        <ul className={styles.list}>
          {data.reviews.map((r) => (
            <li key={r.prNumber} className={styles.row}>
              <div className={styles.who}>
                <span className="type-body">
                  PR #{r.prNumber}{r.title ? `: ${r.title}` : ''}
                </span>
                <span>
                  <StatusMark
                    status={r.verdict === 'drifts' ? 'grounded' : 'holding'}
                    showHint
                    hint={r.verdict === 'drifts' ? 'Drifts from takeoff.yaml' : 'Needs a decision'}
                  />
                </span>
                {r.summary ? <span className={cx('type-small', styles.muted)}>{r.summary}</span> : null}
                {r.newerPush ? <span className={cx('type-small', styles.muted)}>There’s a newer push that Takeoff hasn’t checked yet.</span> : null}
                {r.lastDecision ? <span className={cx('type-small', styles.muted)}>{decisionLine(r.lastDecision)}</span> : null}
              </div>
              <div className={styles.actions}>
                <ButtonLink variant="quiet" size="sm" to={`/read/${encodeURIComponent(projectId)}/drift/${r.prNumber}`}>
                  Review
                </ButtonLink>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
