import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../components/Header';
import { Button, StatusMark } from '../components/takeoff';
import { cx } from '../components/takeoff/status';
import { useAuth } from '../hooks/useAuth';
import { ApiError } from '../lib/api-error';
import { rememberAfterSignIn } from '../lib/safe-next';
import {
  acceptDrift,
  fetchDriftReview,
  retryDriftDecision,
  sendBackDrift,
  type Conflict,
  type DecisionResult,
  type DriftReview as Review,
  type IntentEdit,
  type WhyNot,
} from '../services/driftApi';
import { decisionLine } from './team/DriftSection';
import styles from './team/Team.module.css';
import drift from './DriftReview.module.css';

const WHY_NOT: Record<WhyNot, string> = {
  github_unavailable: 'Takeoff can’t reach this pull request on GitHub right now, so it can’t be decided here. Reload in a minute.',
  fork: 'This pull request comes from a fork. Takeoff can’t commit to a fork’s branch, so decide on it in GitHub.',
  closed: 'This pull request is closed, so there’s nothing left to decide.',
  no_drift: 'The latest check of this pull request needs no decision.',
  decision_running: 'Someone is deciding on this pull request right now. This page updates when they’re done.',
  newer_push: 'There’s a newer push that Takeoff is checking now. This page updates when the check is done.',
};

const WRITE_REASON: Record<string, string> = {
  github_not_connected: 'Connect GitHub to decide directly. Until then, your decision goes to someone with write access to confirm.',
  no_write_access: 'You don’t have write access to the repo, so your decision goes to someone who does to confirm.',
  github_account_changed: 'The GitHub account linked to you has changed, so your decision goes to someone with write access to confirm.',
  app_not_installed: 'The Takeoff GitHub App isn’t installed on the repo, so your decision waits for someone with write access.',
  github_check_failed: 'Takeoff couldn’t check your GitHub access just now, so your decision goes to someone with write access to confirm.',
};

const KIND_WORD = { rule: 'rule', never: 'never-rule', agreement: 'agreement' } as const;

type Choice = { action: 'keep' | 'remove' | 'reword'; to: string };

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className={cx('takeoff', styles.page)}>
      <Header variant="takeoff" />
      <main className={drift.main}>{children}</main>
    </div>
  );
}

function ConflictCard({ c, filesUrl }: { c: Conflict; filesUrl: string | null }) {
  return (
    <li className={drift.conflict}>
      {c.areaName ? <p className={cx('type-eyebrow', styles.muted)}>{c.areaName}</p> : null}
      <div className={drift.pair}>
        <div>
          <p className={cx('type-small', styles.muted)}>What the intent says</p>
          <blockquote className={cx('type-body', drift.quote)}>{c.ruleOrAgreement || 'No single rule. See below.'}</blockquote>
        </div>
        <div>
          <p className={cx('type-small', styles.muted)}>What the PR does, and why it conflicts</p>
          <p className="type-body">{c.explanation}</p>
        </div>
      </div>
      {c.files.length ? (
        <p className={cx('type-small', styles.muted)}>
          {c.files.map((f) => <code key={f} className={drift.file}>{f}</code>)}
          {filesUrl ? <> · <a href={filesUrl} target="_blank" rel="noreferrer noopener">See the diff</a></> : null}
        </p>
      ) : null}
    </li>
  );
}

/** /read/:id/drift/:prNumber — review one pull request the check flagged. */
export default function DriftReview() {
  const { id = '', prNumber: rawPr = '' } = useParams();
  const prNumber = Number(rawPr);
  const { user, loading: authLoading, login } = useAuth();
  const noteId = useId();
  const agreementId = useId();
  const addId = useId();
  const [review, setReview] = useState<Review | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<'accept' | 'send_back' | null>(null);
  const [choices, setChoices] = useState<Record<number, Choice>>({});
  const [add, setAdd] = useState({ area: '', kind: 'rule' as 'rule' | 'never', text: '' });
  const [agreement, setAgreement] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!Number.isInteger(prNumber) || prNumber < 1) { setLoadError('This isn’t a pull request link Takeoff knows.'); return; }
    try {
      setReview(await fetchDriftReview(id, prNumber));
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setLoadError('You’re not on this project. Ask someone on it to invite you.');
      else if (err instanceof ApiError && err.status === 404) setLoadError('Takeoff hasn’t checked this pull request, or the project is gone.');
      else setLoadError((err as Error).message || 'Couldn’t load this pull request.');
    }
  }, [id, prNumber]);

  useEffect(() => { if (user) void load(); }, [user, load]);

  // While a decision runs or a newer push is being checked, look again.
  const waiting = review?.you.whyNot === 'decision_running' || review?.you.whyNot === 'newer_push';
  useEffect(() => {
    if (!waiting) return undefined;
    const t = window.setInterval(() => { void load(); }, 8000);
    return () => window.clearInterval(t);
  }, [waiting, load]);

  if (authLoading) return <Page><p className={cx('type-small', styles.muted)} role="status">Loading…</p></Page>;
  if (!user) {
    return (
      <Page>
        <h1 className="type-title">Sign in to review this pull request</h1>
        <p className={cx('type-body', styles.muted)}>Only people on the project can see it.</p>
        <div><Button variant="primary" onClick={() => { rememberAfterSignIn(`/read/${id}/drift/${rawPr}`); login('github'); }}>Sign in with GitHub</Button></div>
      </Page>
    );
  }
  if (loadError) {
    return (
      <Page>
        <h1 className="type-title">This review can’t be opened</h1>
        <p className={cx('type-body', styles.muted)}>{loadError}</p>
        <p className="type-small"><Link to={`/read/${id}`}>Back to the project</Link></p>
      </Page>
    );
  }
  if (!review) return <Page><p className={cx('type-small', styles.muted)} role="status">Loading the pull request…</p></Page>;

  const { pr, check, intent, you } = review;
  const verdict = check.verdict === 'drifts' ? 'drifts' : check.verdict === 'needs_decision' ? 'needs_decision' : null;
  const targeted = check.conflicts.map((c, i) => ({ c, i })).filter((x) => x.c.target);
  const failed = review.decisions.find((d) => d.state === 'failed');

  const edits = (): IntentEdit[] => {
    const out: IntentEdit[] = [];
    for (const { c, i } of targeted) {
      const ch = choices[i];
      if (!ch || ch.action === 'keep' || !c.target) continue;
      if (ch.action === 'remove') out.push({ op: 'remove', target: c.target });
      else if (ch.to.trim()) out.push({ op: 'reword', target: c.target, to: ch.to.trim() });
    }
    if (add.text.trim() && add.area) out.push({ op: 'add', kind: add.kind, area: add.area, text: add.text.trim() });
    return out;
  };
  const acceptReady = edits().length > 0 || !!agreement.trim() || intent.yamlChanged;

  const finish = (res: DecisionResult) => {
    if (res.status === 'recommended') setOutcome('Saved. Someone with write access to the repo can confirm it under “Who’s on this project”.');
    else if (res.status === 'done') {
      setOutcome(res.decision.type === 'accepted'
        ? 'Done. takeoff.yaml on the PR’s branch is updated, and Takeoff is checking the PR again.'
        : 'Sent. The note is on the pull request, where the builder and their AI agent can read it.');
    } else setError(res.decision.error || 'That didn’t work. Try again.');
    setMode(null);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message || 'That didn’t work. Try again.');
    } finally {
      setBusy(false);
      await load();
    }
  };

  const onAccept = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => finish(await acceptDrift(id, prNumber, { headSha: check.headSha, edits: edits(), agreement: agreement.trim() || undefined })));
  };
  const onSendBack = (e: FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    void run(async () => finish(await sendBackDrift(id, prNumber, { headSha: check.headSha, note: note.trim() })));
  };
  const setChoice = (i: number, next: Partial<Choice>) => setChoices({ ...choices, [i]: { ...(choices[i] || { action: 'keep', to: '' }), ...next } });
  const direct = you.canWrite;

  return (
    <Page>
      <p className="type-small"><Link to={`/read/${id}`}>Back to the project</Link></p>
      <div className={drift.title}>
        <h1 className="type-title">
          {pr ? <>PR #{pr.number}: {pr.title}</> : <>PR #{prNumber}</>}
        </h1>
        {verdict ? (
          <StatusMark status={verdict === 'drifts' ? 'grounded' : 'holding'} showHint
            hint={verdict === 'drifts' ? 'Drifts from takeoff.yaml' : 'Needs a decision'} />
        ) : null}
        {pr ? (
          <p className={cx('type-small', styles.muted)}>
            {pr.author ? `By ${pr.author}` : null}{pr.branch ? <> · <code>{pr.branch}</code></> : null}
            {' · '}<a href={pr.url} target="_blank" rel="noreferrer noopener">Open on GitHub</a>
            {' · '}<a href={pr.filesUrl} target="_blank" rel="noreferrer noopener">See the diff</a>
          </p>
        ) : null}
      </div>

      {check.summary ? <p className="type-body">{check.summary}</p> : null}
      {check.notes.map((n) => <p key={n} className={cx('type-small', styles.muted)}>{n}</p>)}

      {check.conflicts.length ? (
        <section aria-labelledby="conflicts-title" className={styles.section}>
          <h2 id="conflicts-title" className="type-heading">Why they conflict</h2>
          <ul className={drift.conflicts}>
            {check.conflicts.map((c, i) => <ConflictCard key={i} c={c} filesUrl={pr?.filesUrl || null} />)}
          </ul>
        </section>
      ) : null}

      {intent.areas.length ? (
        <details className={drift.intent}>
          <summary className="type-small">What takeoff.yaml says about {intent.areas.map((a) => a.name).join(', ')}</summary>
          {intent.areas.map((a) => (
            <div key={a.id} className={styles.block}>
              <p className="type-heading">{a.name}</p>
              {a.creators.length ? <p className={cx('type-small', styles.muted)}>Creators: {a.creators.join(', ')}</p> : null}
              {a.rules.length ? <ul className="type-small">{a.rules.map((r) => <li key={r}>{r}</li>)}</ul> : null}
              {a.never.length ? <ul className="type-small">{a.never.map((r) => <li key={r}>Never: {r}</li>)}</ul> : null}
            </div>
          ))}
        </details>
      ) : null}

      {outcome ? <p role="status" className="type-body">{outcome}</p> : null}
      {error ? <p role="alert" className={cx('type-small', styles.error)}>{error}</p> : null}

      {you.canDecide ? (
        <section aria-labelledby="decide-title" className={styles.section}>
          <h2 id="decide-title" className="type-heading">Your decision</h2>
          {!direct ? <p className={cx('type-small', styles.muted)}>{WRITE_REASON[you.writeReason || ''] || WRITE_REASON.no_write_access}</p> : null}
          <div className={styles.actions}>
            <Button variant={mode === 'accept' ? 'primary' : 'quiet'} onClick={() => setMode(mode === 'accept' ? null : 'accept')}>
              Accept and update the intent
            </Button>
            <Button variant={mode === 'send_back' ? 'primary' : 'quiet'} onClick={() => setMode(mode === 'send_back' ? null : 'send_back')}>
              Send back
            </Button>
          </div>

          {mode === 'accept' ? (
            <form className={styles.invite} onSubmit={onAccept}>
              <p className={cx('type-small', styles.muted)}>
                The PR is right and takeoff.yaml should change. Takeoff commits the change to the PR’s branch, so it merges
                with the PR, then checks the PR again.
              </p>
              {intent.yamlChanged ? (
                <p className="type-small">
                  This PR changes takeoff.yaml itself. Accepting with nothing else chosen accepts its version as it is.
                </p>
              ) : null}
              {targeted.map(({ c, i }) => {
                const ch = choices[i] || { action: 'keep', to: '' };
                const t = c.target!;
                return (
                  <fieldset key={i} className={styles.labels}>
                    <legend className="type-small">The {KIND_WORD[t.kind]} “{t.text}”</legend>
                    {(['keep', 'remove', 'reword'] as const).map((action) => (
                      <label key={action} className={cx('type-small', styles.labelOption)}>
                        <input type="radio" name={`c${i}`} checked={ch.action === action} onChange={() => setChoice(i, { action })} />
                        {action === 'keep' ? 'Keep it' : action === 'remove' ? 'Remove it' : 'Reword it'}
                      </label>
                    ))}
                    {ch.action === 'reword' ? (
                      <textarea aria-label={`New wording for “${t.text}”`} className={cx('type-body', styles.input)} rows={2} maxLength={1000}
                        value={ch.to} placeholder={t.text} onChange={(e) => setChoice(i, { to: e.target.value })} />
                    ) : null}
                  </fieldset>
                );
              })}
              {intent.allAreas.length ? (
                <div className={styles.block}>
                  <label htmlFor={addId} className="type-small">Add a rule (optional)</label>
                  <div className={styles.inviteRow}>
                    <select aria-label="Area" className={cx('type-small', styles.input)} value={add.area} onChange={(e) => setAdd({ ...add, area: e.target.value })}>
                      <option value="">Choose an area</option>
                      {intent.allAreas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <select aria-label="Kind of rule" className={cx('type-small', styles.input)} value={add.kind} onChange={(e) => setAdd({ ...add, kind: e.target.value as 'rule' | 'never' })}>
                      <option value="rule">Always</option>
                      <option value="never">Never</option>
                    </select>
                  </div>
                  <input id={addId} className={cx('type-body', styles.input)} maxLength={1000} value={add.text}
                    onChange={(e) => setAdd({ ...add, text: e.target.value })} placeholder="For example: trials end after 14 days." />
                </div>
              ) : null}
              <div className={styles.block}>
                <label htmlFor={agreementId} className="type-small">Record an agreement (optional)</label>
                <textarea id={agreementId} className={cx('type-body', styles.input)} rows={2} maxLength={1000}
                  value={agreement} onChange={(e) => setAgreement(e.target.value)}
                  placeholder={check.suggestedAgreement || 'What the team agreed, in one sentence.'} />
                {check.suggestedAgreement && !agreement ? (
                  <div><Button variant="quiet" size="sm" onClick={() => setAgreement(check.suggestedAgreement || '')}>Use Takeoff’s suggestion</Button></div>
                ) : null}
                <p className={cx('type-small', styles.muted)}>It’s recorded with your email as the person who agreed.</p>
              </div>
              <div>
                <Button variant="primary" type="submit" disabled={busy || !acceptReady}>
                  {busy ? 'Saving…' : direct ? 'Accept and commit to the PR' : 'Ask someone with write access to accept'}
                </Button>
              </div>
            </form>
          ) : null}

          {mode === 'send_back' ? (
            <form className={styles.invite} onSubmit={onSendBack}>
              <label htmlFor={noteId} className="type-small">What should the builder change? Takeoff posts this on the PR.</label>
              <textarea id={noteId} className={cx('type-body', styles.input)} rows={4} maxLength={2000} value={note}
                onChange={(e) => setNote(e.target.value)} placeholder="For example: keep the trial free and charge when it ends." />
              <p className={cx('type-small', styles.muted)}>
                The builder’s AI agent can read it with <code>takeoff notes</code> on the PR’s branch.
              </p>
              <div>
                <Button variant="primary" type="submit" disabled={busy || !note.trim()}>
                  {busy ? 'Sending…' : direct ? 'Send back' : 'Ask someone with write access to send it back'}
                </Button>
              </div>
            </form>
          ) : null}
        </section>
      ) : you.whyNot ? (
        <p className={cx('type-body', styles.muted)} role={waiting ? 'status' : undefined}>{WHY_NOT[you.whyNot]}</p>
      ) : null}

      {review.decisions.length ? (
        <section aria-labelledby="decisions-title" className={styles.section}>
          <h2 id="decisions-title" className="type-heading">Decisions</h2>
          <ul className={styles.list}>
            {review.decisions.map((d) => (
              <li key={d.id} className={styles.row}>
                <div className={styles.who}>
                  <span className={cx('type-small', d.state === 'failed' ? styles.error : undefined)}>{decisionLine(d)}</span>
                  {d.changes.length ? <ul className={cx('type-small', styles.muted)}>{d.changes.map((x) => <li key={x}>{x}</li>)}</ul> : null}
                  {d.note ? <blockquote className={cx('type-small', drift.quote)}>{d.note}</blockquote> : null}
                  <span className={cx('type-small', styles.muted)}>
                    {new Date(d.createdAt).toLocaleString()} · on <code>{d.headSha.slice(0, 7)}</code>
                    {d.commitUrl ? <> · <a href={d.commitUrl} target="_blank" rel="noreferrer noopener">See the commit</a></> : null}
                    {d.commentUrl ? <> · <a href={d.commentUrl} target="_blank" rel="noreferrer noopener">See the note</a></> : null}
                  </span>
                </div>
                {failed?.id === d.id && you.canWrite ? (
                  <div className={styles.actions}>
                    <Button variant="quiet" size="sm" disabled={busy}
                      onClick={() => void run(async () => {
                        const r = await retryDriftDecision(id, d.id);
                        if (r.decision.state === 'failed') setError(r.decision.error || 'It didn’t work again.');
                        else setOutcome('Done.');
                      })}>
                      Try again
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Page>
  );
}
