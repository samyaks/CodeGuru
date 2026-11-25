import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Button } from '../../components/takeoff';
import { cx } from '../../components/takeoff/status';
import { ApiError } from '../../lib/api-error';
import {
  decideAgreement,
  fetchAgreements,
  proposeAgreement,
  retryAgreementCommit,
  voteOnAgreement,
  withdrawAgreement,
  type Agreement,
  type AgreementList,
  type Person,
} from '../../services/agreementsApi';
import styles from './Team.module.css';
import { TEAM_CHANGED_EVENT } from './TeamSection';

const names = (people: Person[]) => people.map((p) => p.name || 'a teammate').join(', ');

const INTENT_NOTE: Record<string, string> = {
  app_not_installed: 'Install the Takeoff GitHub App on the repo so agreements can be recorded in takeoff.yaml.',
  no_takeoff_yaml: 'There’s no takeoff.yaml in the repo yet. You can still agree on things here; Takeoff records them once the file exists.',
  invalid_takeoff_yaml: 'takeoff.yaml in the repo has errors, so areas can’t be read. Run `takeoff validate` to see them.',
  github_unavailable: 'Takeoff can’t reach GitHub right now, so areas aren’t shown. Try again in a minute.',
};

const DECIDE_REASON: Record<string, string> = {
  not_area_creator: 'A Creator of this area (in takeoff.yaml) can decide it now.',
  no_write_access: 'Someone with write access to the repo can decide it now.',
  github_not_connected: 'Someone with write access to the repo can decide it now. If that’s you, connect GitHub.',
  area_gone: 'This area isn’t in takeoff.yaml any more, so no one can decide it alone.',
  github_check_failed: 'Takeoff couldn’t check GitHub access just now. Reload in a minute.',
  github_account_changed: 'The GitHub account linked to you has changed. Connect GitHub again to decide this.',
  app_not_installed: 'Install the Takeoff GitHub App on the repo so someone with write access can decide this.',
  github_unavailable: 'Takeoff can’t reach GitHub right now. Reload in a minute.',
  invalid_takeoff_yaml: 'takeoff.yaml has errors, so Takeoff can’t tell who the area’s Creators are.',
  no_takeoff_yaml: 'There’s no takeoff.yaml in the repo, so Takeoff can’t tell who the area’s Creators are.',
  intent_unavailable: 'Takeoff can’t read takeoff.yaml right now. Reload in a minute.',
};


function CommitStatus({ a, busy, onRetry }: { a: Agreement; busy: boolean; onRetry: () => void }) {
  const c = a.commit;
  const link = (href: string, text: string) => <a href={href} target="_blank" rel="noreferrer noopener">{text}</a>;
  const retry = a.you.canRetryCommit ? <Button variant="quiet" size="sm" disabled={busy} onClick={onRetry}>Try again</Button> : null;
  switch (c.state) {
    case 'committed':
      return <span className={cx('type-small', styles.muted)}>In takeoff.yaml{c.url ? <> · {link(c.url, 'See the commit')}</> : null}</span>;
    case 'pr_opened':
      return <span className={cx('type-small', styles.muted)}>The default branch is protected, so Takeoff opened a pull request{c.prUrl ? <> · {link(c.prUrl, 'Review it')}</> : null}</span>;
    case 'waiting_for_write':
      return retry ? (
        <span className={styles.actions}>
          <span className={cx('type-small', styles.muted)}>The request for someone with write access was dismissed.</span>
          {retry}
        </span>
      ) : <span className={cx('type-small', styles.muted)}>Waiting for someone with write access to confirm it under “Who’s on this project”.</span>;
    case 'committing':
      return retry ? (
        <span className={styles.actions}>
          <span className={cx('type-small', styles.muted)}>Adding it to takeoff.yaml is taking too long.</span>
          {retry}
        </span>
      ) : <span className={cx('type-small', styles.muted)} role="status">Adding it to takeoff.yaml…</span>;
    default:
      return (
        <span className={styles.actions}>
          <span className={cx('type-small', c.state === 'failed' ? styles.error : styles.muted)}>
            {c.state === 'failed' ? c.error || 'Couldn’t add it to takeoff.yaml.' : 'Not in takeoff.yaml yet.'}
          </span>
          {retry}
        </span>
      );
  }
}

/**
 * What the team has agreed, and proposals waiting on votes. Everyone agrees,
 * or after 48 hours with no "Not yet" an area Creator (or someone with write
 * access) can decide alone. Renders nothing for people who aren't members.
 */
export function AgreementsSection({ projectId }: { projectId: string }) {
  const textId = useId();
  const areaId = useId();
  const sourceId = useId();
  const [data, setData] = useState<AgreementList | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [area, setArea] = useState('');
  const [source, setSource] = useState('');
  const [notYet, setNotYet] = useState<{ id: string; comment: string } | null>(null);
  const [deciding, setDeciding] = useState<{ id: string; note: string } | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await fetchAgreements(projectId));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && [401, 403, 404, 503].includes(err.status)) setHidden(true);
      else setError((err as Error).message || 'Couldn’t load agreements.');
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  // Confirming a recommendation under the team list commits an agreement.
  useEffect(() => {
    const onChange = () => { void load(); };
    window.addEventListener(TEAM_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(TEAM_CHANGED_EVENT, onChange);
  }, [load]);

  // While a commit is running, look again every few seconds.
  const committing = !!data?.agreements.some((a) => a.commit.state === 'committing' && !a.you.canRetryCommit);
  useEffect(() => {
    if (!committing) return undefined;
    const t = window.setInterval(() => { void load(); }, 5000);
    return () => window.clearInterval(t);
  }, [committing, load]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message || 'That didn’t work. Try again.');
    } finally {
      setBusy(null);
      await load();
    }
  };

  if (hidden) return null;

  const onPropose = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    void run('propose', async () => {
      await proposeAgreement(projectId, { text: value, areaId: area || undefined, source: source.trim() || undefined });
      setText('');
      setSource('');
    });
  };

  const open = data?.agreements.filter((a) => a.status === 'proposed') || [];
  const agreed = data?.agreements.filter((a) => a.status === 'accepted') || [];
  const closed = data?.agreements.filter((a) => a.status === 'declined' || a.status === 'withdrawn') || [];

  return (
    <section aria-labelledby="agreements-title" className={styles.section}>
      <div className={styles.head}>
        <h2 id="agreements-title" className="type-title">What the team has agreed</h2>
      </div>
      <p className={cx('type-small', styles.muted)}>
        Propose something the team should agree on. Once everyone agrees, Takeoff adds it to takeoff.yaml, where your
        AI agents read it.
      </p>

      {error ? <p role="alert" className={cx('type-small', styles.error)}>{error}</p> : null}

      {!data ? (
        <p className={cx('type-small', styles.muted)} role="status">Loading agreements…</p>
      ) : (
        <>
          {!data.intent.ok && data.intent.reason && INTENT_NOTE[data.intent.reason] ? (
            <p className={cx('type-small', styles.muted)}>{INTENT_NOTE[data.intent.reason]}</p>
          ) : null}
          {!data.emailsOn ? (
            <p className={cx('type-small', styles.muted)}>Takeoff doesn’t email about agreements yet, so check back here for votes.</p>
          ) : null}

          <form className={styles.invite} onSubmit={onPropose}>
            <label htmlFor={textId} className="type-heading">Propose an agreement</label>
            <textarea
              id={textId}
              className={cx('type-body', styles.input)}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="For example: every new screen ships behind a feature flag."
              rows={2}
              maxLength={1000}
            />
            <div className={styles.inviteRow}>
              {data.areas.length > 0 ? (
                <label className="type-small" htmlFor={areaId}>
                  Area{' '}
                  <select id={areaId} className={cx('type-small', styles.input)} value={area} onChange={(e) => setArea(e.target.value)}>
                    <option value="">The whole product</option>
                    {data.areas.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </label>
              ) : null}
              <label className="type-small" htmlFor={sourceId}>
                Link (optional){' '}
                <input
                  id={sourceId}
                  className={cx('type-small', styles.input)}
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="https://…"
                  type="url"
                  maxLength={500}
                />
              </label>
              <Button variant="quiet" type="submit" disabled={!text.trim() || busy === 'propose'}>
                {busy === 'propose' ? 'Proposing…' : 'Propose'}
              </Button>
            </div>
            <p className={cx('type-small', styles.muted)}>Proposing it counts as your agreement.</p>
          </form>

          {open.length > 0 ? (
            <div className={styles.block}>
              <p className={cx('type-eyebrow', styles.muted)}>Waiting on votes</p>
              <ul className={styles.list}>
                {open.map((a) => {
                  const agreedBy = a.votes.filter((v) => v.vote === 'agree');
                  const notYets = a.votes.filter((v) => v.vote === 'not_yet');
                  return (
                    <li key={a.id} className={styles.row}>
                      <div className={styles.who}>
                        <span className="type-body">{a.text}</span>
                        <span className={cx('type-small', styles.muted)}>
                          {a.areaName ? `${a.areaName} · ` : ''}Proposed by {a.proposedBy.name || 'a teammate'}
                          {a.source ? <> · <a href={a.source} target="_blank" rel="noreferrer noopener">Link</a></> : null}
                        </span>
                        <span className={cx('type-small', styles.muted)}>
                          {agreedBy.length ? `Agreed: ${names(agreedBy)}. ` : ''}
                          {a.waitingOn.length ? `Waiting on ${names(a.waitingOn)}.` : ''}
                        </span>
                        {notYets.map((v) => (
                          <span key={v.userId} className="type-small">Not yet from {v.name || 'a teammate'}: {v.comment}</span>
                        ))}
                        {a.stalled ? (
                          <span className={cx('type-small', styles.muted)}>
                            No one has said “Not yet” in 48 hours.{' '}
                            {a.you.canDecide ? 'You can decide it now.' : DECIDE_REASON[a.you.decideReason || ''] || ''}
                          </span>
                        ) : null}
                      </div>
                      <div className={styles.actions}>
                        {a.you.vote !== 'agree' ? (
                          <Button variant="quiet" size="sm" disabled={busy === `vote:${a.id}`}
                            onClick={() => void run(`vote:${a.id}`, async () => { await voteOnAgreement(projectId, a.id, 'agree'); })}>
                            Agree
                          </Button>
                        ) : null}
                        {a.you.vote !== 'not_yet' ? (
                          <Button variant="quiet" size="sm" onClick={() => setNotYet(notYet?.id === a.id ? null : { id: a.id, comment: '' })}>
                            Not yet
                          </Button>
                        ) : null}
                        {a.you.canWithdraw ? (
                          <Button variant="quiet" size="sm" disabled={busy === `withdraw:${a.id}`}
                            onClick={() => {
                              if (!window.confirm('Withdraw this proposal?')) return;
                              void run(`withdraw:${a.id}`, async () => { await withdrawAgreement(projectId, a.id); });
                            }}>
                            Withdraw
                          </Button>
                        ) : null}
                        {a.you.canDecide ? (
                          <Button variant="quiet" size="sm" onClick={() => setDeciding(deciding?.id === a.id ? null : { id: a.id, note: '' })}>
                            Decide
                          </Button>
                        ) : null}
                      </div>
                      {notYet?.id === a.id ? (
                        <div className={styles.editor}>
                          <label className="type-small" htmlFor={`${a.id}-notyet`}>What’s missing?</label>
                          <textarea id={`${a.id}-notyet`} className={cx('type-body', styles.input)} rows={2} maxLength={500}
                            value={notYet.comment} onChange={(e) => setNotYet({ id: a.id, comment: e.target.value })} />
                          <div>
                            <Button variant="quiet" size="sm" disabled={!notYet.comment.trim() || busy === `notyet:${a.id}`}
                              onClick={() => void run(`notyet:${a.id}`, async () => {
                                await voteOnAgreement(projectId, a.id, 'not_yet', notYet.comment.trim());
                                setNotYet(null);
                              })}>
                              Send “Not yet”
                            </Button>
                          </div>
                        </div>
                      ) : null}
                      {deciding?.id === a.id ? (
                        <div className={styles.editor}>
                          <label className="type-small" htmlFor={`${a.id}-decide`}>
                            Why are you deciding this on your own? Everyone sees the reason.
                          </label>
                          <textarea id={`${a.id}-decide`} className={cx('type-body', styles.input)} rows={2} maxLength={500}
                            value={deciding.note} onChange={(e) => setDeciding({ id: a.id, note: e.target.value })} />
                          <div className={styles.actions}>
                            {(['accept', 'decline'] as const).map((outcome) => (
                              <Button key={outcome} variant="quiet" size="sm" disabled={!deciding.note.trim() || busy === `decide:${a.id}`}
                                onClick={() => void run(`decide:${a.id}`, async () => {
                                  await decideAgreement(projectId, a.id, outcome, deciding.note.trim());
                                  setDeciding(null);
                                })}>
                                {outcome === 'accept' ? 'Accept it' : 'Decline it'}
                              </Button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {agreed.length > 0 ? (
            <div className={styles.block}>
              <p className={cx('type-eyebrow', styles.muted)}>Agreed</p>
              <ul className={styles.list}>
                {agreed.map((a) => (
                  <li key={a.id} className={styles.row}>
                    <div className={styles.who}>
                      <span className="type-body">{a.text}</span>
                      <span className={cx('type-small', styles.muted)}>
                        {a.areaName ? `${a.areaName} · ` : ''}
                        {a.decidedVia === 'stall_fallback'
                          ? `Decided by ${a.decidedBy?.name || 'a teammate'} after 48 hours: ${a.decisionNote || ''}`
                          : 'Everyone agreed'}
                        {a.decidedAt ? ` · ${new Date(a.decidedAt).toLocaleDateString()}` : ''}
                      </span>
                      <CommitStatus a={a} busy={busy === `retry:${a.id}`}
                        onRetry={() => void run(`retry:${a.id}`, async () => { await retryAgreementCommit(projectId, a.id); })} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {closed.length > 0 ? (
            <div className={styles.block}>
              <Button variant="quiet" size="sm" onClick={() => setShowClosed(!showClosed)}>
                {showClosed ? 'Hide' : 'Show'} {closed.length} not agreed
              </Button>
              {showClosed ? (
                <ul className={styles.list}>
                  {closed.map((a) => (
                    <li key={a.id} className={styles.row}>
                      <div className={styles.who}>
                        <span className="type-body">{a.text}</span>
                        <span className={cx('type-small', styles.muted)}>
                          {a.status === 'withdrawn'
                            ? `Withdrawn by ${a.proposedBy.name || 'the proposer'}`
                            : `Declined by ${a.decidedBy?.name || 'a teammate'}: ${a.decisionNote || ''}`}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
