import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import Header from '../../components/Header';
import { Button } from '../../components/takeoff';
import { cx } from '../../components/takeoff/status';
import { useAuth } from '../../hooks/useAuth';
import { ApiError } from '../../lib/api-error';
import { rememberAfterSignIn } from '../../lib/safe-next';
import {
  AskRefused,
  askQuestion,
  deleteAskThread,
  fetchAskThread,
  fetchCodeIndex,
  type AskMessage,
  type AskThreadSummary,
  type CodeIndex,
} from '../../services/askApi';
import { AnswerView } from './AnswerView';
import { MAX_QUESTION, askPath, forgetAskCheck, prefillFrom, useAskAccess, type AskRouteState } from './handoff';
import { Suggestions } from './Suggestions';
import styles from './Ask.module.css';

// /read/:id/ask/:threadId — one conversation with Ask Takeoff. `new` starts
// one. Text handed over by an "Ask about this" link only fills the box; a
// question is asked only when the person presses Ask, here or on the
// project page.

const INDEX_NOTE: Partial<Record<CodeIndex['status'], string>> = {
  none: 'Takeoff hasn’t stored this repo’s code yet. It starts when a question needs the code, and until then answers use the plan and the project’s history. If the Takeoff GitHub App can’t read the repo, the code stays out of answers.',
  building: 'Takeoff is still storing this repo’s code. Until it’s done, answers use the plan and the project’s history, not the code.',
  failed: 'Takeoff couldn’t store this repo’s code the last time it tried, so answers can’t use the code yet. It tries again on its own.',
  too_large: 'This repo is too large for Takeoff to store, so answers use the plan and the project’s history, not the code.',
};

const LIMIT_REASONS = new Set(['daily_limit', 'monthly_budget', 'user_budget', 'global_budget', 'busy']);

// A question pressed on the project page is asked once, even if this page mounts twice.
const asked = new Set<string>();

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className={cx('takeoff', styles.page)}>
      <Header variant="takeoff" />
      <main className={styles.main}>{children}</main>
    </div>
  );
}

const questionRow = (id: string, content: string): AskMessage => ({
  id, role: 'user', status: 'done', content, paragraphs: [], sources: [], planSilent: false, notBuilt: false,
  suggestedAgreement: null, didntGetTo: null, dropped: 0, createdAt: new Date().toISOString(),
});

export default function AskThread() {
  const { id = '', threadId = 'new' } = useParams();
  const { user, loading: authLoading, login } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const boxId = useId();
  const box = useRef<HTMLTextAreaElement>(null);

  const [thread, setThread] = useState<AskThreadSummary | null>(null);
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(threadId === 'new');
  const [question, setQuestion] = useState(() => prefillFrom(location.state));
  const [pending, setPending] = useState<{ question: string; progress: string[] } | null>(null);
  const [notice, setNotice] = useState<{ text: string; limit: boolean } | null>(null);
  const [index, setIndex] = useState<CodeIndex | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  // The thread this page is asking in, so a new thread's id arriving in the URL doesn't reload it mid-answer.
  const active = useRef<string | null>(null);
  // Bumped when the page moves to another conversation, so a stream still
  // running for the old one can't write into this one. The stream itself is
  // left to finish: the server saves the answer either way.
  const run = useRef(0);
  const lastParam = useRef(threadId);
  const ready = useRef(false);
  const { view } = useAskAccess(id);

  const load = useCallback(async (tid: string) => {
    try {
      const data = await fetchAskThread(id, tid);
      setThread(data.thread);
      setMessages(data.messages);
      setLoadError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setLoadError('This conversation is gone, or Ask isn’t on for this project.');
      else setLoadError((err as Error).message || 'Couldn’t load this conversation.');
    } finally {
      setLoaded(true);
    }
  }, [id]);

  useEffect(() => {
    if (!user) return;
    const prev = lastParam.current;
    lastParam.current = threadId;
    // The same conversation as before (React may run this twice), or our
    // own move from `new` to the thread just started: keep everything.
    if (ready.current && prev === threadId) return;
    if (threadId !== 'new' && threadId === active.current) return;
    ready.current = true;
    run.current += 1;
    active.current = null;
    setThread(null);
    setMessages([]);
    setPending(null);
    setNotice(null);
    setLoadError(null);
    setConfirmDelete(false);
    if (threadId === 'new') { setLoaded(true); return; }
    setLoaded(false);
    void load(threadId);
  }, [user, threadId, load]);

  useEffect(() => {
    if (!user) return;
    let live = true;
    fetchCodeIndex(id).then((ix) => { if (live) setIndex(ix); }).catch(() => {});
    return () => { live = false; };
  }, [user, id]);

  const ask = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || pending) return;
    const tid = threadId === 'new' ? active.current : threadId;
    setPending({ question: q, progress: [] });
    setNotice(null);
    const mine = ++run.current;
    const current = () => run.current === mine;
    let started = false;
    let failed = false;
    try {
      await askQuestion(id, { question: q, threadId: tid || undefined }, (event) => {
        if (!current()) return;
        if (event.type === 'started') {
          started = true;
          active.current = event.threadId;
          setQuestion('');
          if (threadId === 'new') navigate(askPath(id, event.threadId), { replace: true });
        } else if (event.type === 'progress') {
          setPending((p) => (p ? { ...p, progress: [...p.progress, event.text].slice(-5) } : p));
        } else if (event.type === 'answer') {
          setMessages((m) => [...m, questionRow(`${event.message.id}-q`, q), event.message]);
          setPending(null);
        } else if (event.type === 'error') {
          failed = true;
          setNotice({ text: event.error, limit: false });
        }
      });
    } catch (err) {
      if (!current()) return;
      if (err instanceof AskRefused) {
        setNotice({
          text: err.status === 404 ? 'Ask isn’t on for this project, or this conversation is gone.' : err.message,
          limit: LIMIT_REASONS.has(err.code),
        });
        if (!started) setQuestion((cur) => cur || q);
      } else {
        failed = true;
        setNotice({ text: 'The connection dropped before the answer arrived. It may still finish: reload the page in a minute to see it.', limit: false });
      }
    } finally {
      forgetAskCheck(id);
      if (current()) setPending(null);
    }
    // After a stream error, the saved conversation is the truth.
    if (current() && started && active.current && failed) void load(active.current);
  }, [id, threadId, pending, navigate, load]);

  // The person pressed Ask on the project page: ask it here, once.
  useEffect(() => {
    const handed = (location.state as AskRouteState | null)?.ask;
    if (!user || threadId !== 'new' || !handed || typeof handed.question !== 'string' || asked.has(handed.nonce)) return;
    asked.add(handed.nonce);
    navigate(location.pathname, { replace: true, state: null });
    void ask(handed.question.slice(0, MAX_QUESTION));
  }, [user, threadId, location.state, location.pathname, navigate, ask]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void ask(question);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void ask(question);
    }
  };
  const pick = (text: string) => {
    setQuestion(text);
    box.current?.focus();
  };

  const remove = async () => {
    const tid = active.current || (threadId !== 'new' ? threadId : null);
    if (!tid) return;
    setBusy(true);
    try {
      await deleteAskThread(id, tid);
      forgetAskCheck(id);
      navigate(`/read/${encodeURIComponent(id)}`);
    } catch (err) {
      setNotice({ text: (err as Error).message || 'Couldn’t delete this conversation. Try again.', limit: false });
      setBusy(false);
      setConfirmDelete(false);
    }
  };

  const back = <p className="type-small"><Link to={`/read/${encodeURIComponent(id)}`}>Back to the project</Link></p>;

  if (authLoading) return <Page><p className={cx('type-small', styles.muted)} role="status">Loading…</p></Page>;
  if (!user) {
    return (
      <Page>
        <h1 className="type-title">Sign in to ask about this project</h1>
        <p className={cx('type-body', styles.muted)}>Only people on the project can ask Takeoff about it.</p>
        <div><Button variant="primary" onClick={() => { rememberAfterSignIn(`/read/${id}`); login('github'); }}>Sign in with GitHub</Button></div>
      </Page>
    );
  }
  if (loadError) {
    return (
      <Page>
        {back}
        <h1 className="type-title">This conversation can’t be opened</h1>
        <p className={cx('type-body', styles.muted)}>{loadError}</p>
      </Page>
    );
  }
  if (!loaded) return <Page>{back}<p className={cx('type-small', styles.muted)} role="status">Loading the conversation…</p></Page>;

  const hasThread = !!(active.current || thread);
  const empty = !messages.length && !pending;
  const note = index ? INDEX_NOTE[index.working && index.status !== 'ready' && index.status !== 'behind' ? 'building' : index.status] : null;

  return (
    <Page>
      {back}
      <div className={styles.titleRow}>
        <h1 className="type-title">Ask Takeoff</h1>
        {hasThread ? (
          confirmDelete ? (
            <span className={styles.actions}>
              <span className="type-small">Delete this conversation?</span>
              <Button variant="quiet" size="sm" disabled={busy} onClick={() => { void remove(); }}>Delete</Button>
              <Button variant="quiet" size="sm" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep</Button>
            </span>
          ) : (
            <Button variant="quiet" size="sm" disabled={!!pending} onClick={() => setConfirmDelete(true)}>Delete</Button>
          )
        ) : null}
      </div>
      <p className={cx('type-small', styles.muted)}>
        Answers come from the plan, the team’s agreements and decisions, and the code. Each part says where it came from. Only you see your questions.
      </p>
      {note ? <p className={cx('type-small', styles.note)}>{note}</p> : null}

      <ol className={styles.thread} aria-label="Conversation">
        {messages.map((m) => (
          <li key={m.id} className={m.role === 'user' ? styles.question : styles.reply}>
            {m.role === 'user'
              ? <p className={cx('type-intent', styles.plain)}>{m.content}</p>
              : <AnswerView projectId={id} message={m} />}
          </li>
        ))}
        {pending ? (
          <>
            <li className={styles.question}><p className={cx('type-intent', styles.plain)}>{pending.question}</p></li>
            <li className={styles.reply}>
              <div role="status" aria-live="polite" className={styles.progress}>
                <p className={cx('type-small', styles.muted)}>Working on it…</p>
                {pending.progress.map((t, i) => <p key={i} className={cx('type-small', styles.muted)}>{t}</p>)}
              </div>
            </li>
          </>
        ) : null}
      </ol>

      {notice ? (
        <p role="alert" className={cx('type-small', notice.limit ? styles.note : styles.error)}>{notice.text}</p>
      ) : null}

      <form className={styles.composer} onSubmit={onSubmit}>
        <label htmlFor={boxId} className="type-heading">{empty ? 'What do you want to know?' : 'Ask a follow-up'}</label>
        <textarea
          ref={box}
          id={boxId}
          className={cx('type-body', styles.input)}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          maxLength={MAX_QUESTION}
          placeholder="For example: what does the plan say about refunds?"
        />
        <div className={styles.composerRow}>
          <span className={cx('type-small', styles.muted)}>Takeoff only reads. It never changes the repo or the plan.</span>
          <Button variant="primary" type="submit" disabled={!question.trim() || !!pending}>
            {pending ? 'Answering…' : 'Ask'}
          </Button>
        </div>
      </form>
      {empty && !question ? <Suggestions view={view} onPick={pick} /> : null}
    </Page>
  );
}
