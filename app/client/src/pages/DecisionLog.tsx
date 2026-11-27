import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../components/Header';
import { Button } from '../components/takeoff';
import { cx } from '../components/takeoff/status';
import { useAuth } from '../hooks/useAuth';
import { ApiError } from '../lib/api-error';
import { rememberAfterSignIn } from '../lib/safe-next';
import { downloadDecisionLog, fetchDecisionLog, type DecisionLog as Log, type LogEntry } from '../services/overviewApi';
import { LogLinks, formatDay, logSentence } from './team/logLine';
import styles from './team/Team.module.css';
import drift from './DriftReview.module.css';

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className={cx('takeoff', styles.page)}>
      <Header variant="takeoff" />
      <main className={drift.main}>{children}</main>
    </div>
  );
}

/** Entries grouped by the day they were decided, newest day first. */
function byDay(entries: LogEntry[]) {
  const days: Array<{ day: string; entries: LogEntry[] }> = [];
  for (const e of entries) {
    const day = formatDay(e.at) || 'Undated';
    const last = days[days.length - 1];
    if (last && last.day === day) last.entries.push(e);
    else days.push({ day, entries: [e] });
  }
  return days;
}

export default function DecisionLog() {
  const { id = '' } = useParams();
  const { user, loading: authLoading, login } = useAuth();
  const [log, setLog] = useState<Log | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLog(await fetchDecisionLog(id));
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setLoadError('You’re not on this project. Ask someone on it to invite you.');
      else if (err instanceof ApiError && err.status === 404) setLoadError('This project is gone, or the link is wrong.');
      else setLoadError((err as Error).message || 'Couldn’t load the decision log.');
    }
  }, [id]);

  useEffect(() => { if (user) void load(); }, [user, load]);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      await downloadDecisionLog(id);
    } catch (err) {
      setError((err as Error).message || 'Couldn’t download the decision log.');
    } finally {
      setBusy(false);
    }
  };

  const back = <p className="type-small"><Link to={`/read/${encodeURIComponent(id)}`}>Back to the project</Link></p>;

  if (authLoading) return <Page><p className={cx('type-small', styles.muted)} role="status">Loading…</p></Page>;
  if (!user) {
    return (
      <Page>
        <h1 className="type-title">Sign in to see the decision log</h1>
        <p className={cx('type-body', styles.muted)}>Only people on the project can see it.</p>
        <div><Button variant="primary" onClick={() => { rememberAfterSignIn(`/read/${id}/decisions`); login('github'); }}>Sign in with GitHub</Button></div>
      </Page>
    );
  }
  if (loadError) {
    return (
      <Page>
        <h1 className="type-title">The decision log can’t be opened</h1>
        <p className={cx('type-body', styles.muted)}>{loadError}</p>
        {back}
      </Page>
    );
  }
  if (!log) return <Page><p className={cx('type-small', styles.muted)} role="status">Loading the decision log…</p></Page>;

  return (
    <Page>
      <div className={drift.title}>
        <h1 className="type-title">Decision log</h1>
        <p className={cx('type-body', styles.muted)}>Every agreement the team settled and every drift decision, newest first.</p>
      </div>
      <div className={styles.actions}>
        <Button variant="quiet" onClick={() => void download()} disabled={busy || !log.entries.length}>
          {busy ? 'Preparing…' : 'Download as Markdown'}
        </Button>
      </div>
      {error ? <p className={cx('type-small', styles.error)} role="alert">{error}</p> : null}
      {log.entries.length ? byDay(log.entries).map((d) => (
        <section key={d.day} className={styles.block} aria-label={d.day}>
          <h2 className="type-eyebrow">{d.day}</h2>
          <ul className={styles.list}>
            {d.entries.map((e) => (
              <li key={`${e.kind}-${e.id}`} className={styles.row}>
                <div className={styles.who}>
                  <span className="type-body">{logSentence(e)}</span>
                  <LogLinks entry={e} className={cx('type-small', styles.muted)} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )) : <p className={cx('type-body', styles.muted)}>Nothing decided yet. Agreements and drift decisions show up here once they’re settled.</p>}
      {log.truncated ? <p className={cx('type-small', styles.muted)}>The oldest entries are left out, here and in the download.</p> : null}
      {back}
    </Page>
  );
}
