import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchProjectDetail, type ProjectWithEntries } from '../../services/api';
import {
  fetchRead, correctClaim, unlockRead,
  type ReadPayload, type ReadClaim, type ReadClaimSlot, type ClaimCorrection,
} from '../../services/readApi';
import { ApiError } from '../../lib/api-error';
import ClaimPhrase from './ClaimPhrase';
import EditorPop from './EditorPop';
import Marginalia from './Marginalia';
import PromptFrame from './PromptFrame';
import './read.css';

// "The Read" — the manuscript page. Visual source of truth:
// prototypes/living-spec-draft.html. GET is public; corrections/unlock
// surface a gentle sign-in note on 401 instead of a wall.

const SLOT_ORDER: ReadClaimSlot[] = ['objective', 'audience', 'core_job'];
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 36; // ~3 minutes of "still drafting" polling

type Phase = 'loading' | 'drafting' | 'error' | 'ready';

function timeAgo(iso: string | null): string {
  if (!iso) return 'just now';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'just now';
  const secs = Math.floor((Date.now() - then) / 1000);
  if (secs < 90) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(then).toLocaleDateString();
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function ReadPage() {
  const { id } = useParams<{ id: string }>();

  const [read, setRead] = useState<ReadPayload | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [pollExpired, setPollExpired] = useState(false);
  const [pollTick, setPollTick] = useState(0);
  // Best-effort: names the masthead dateline and the sentence subject.
  const [project, setProject] = useState<ProjectWithEntries | null>(null);

  const [openPopClaimId, setOpenPopClaimId] = useState<string | null>(null);
  const [savingClaimId, setSavingClaimId] = useState<string | null>(null);
  const [claimNotice, setClaimNotice] = useState<string | null>(null);
  const [promptNotice, setPromptNotice] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [nextFaded, setNextFaded] = useState(false);
  const [flashShown, setFlashShown] = useState(false);

  const pollAttemptsRef = useRef(0);
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  useEffect(() => () => { timersRef.current.forEach(clearTimeout); }, []);
  const later = useCallback((fn: () => void, ms: number) => {
    timersRef.current.push(setTimeout(fn, ms));
  }, []);

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!id) return;
    if (!opts.silent) {
      setPhase('loading');
      setError(null);
    }
    try {
      const payload = await fetchRead(id);
      setRead(payload);
      setPhase('ready');
      setPollExpired(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // 404 = the read is still being drafted; keep (or start) polling.
        setPhase('drafting');
        setPollTick((t) => t + 1);
      } else {
        setPhase('error');
        setError(err instanceof Error ? err.message : 'Failed to load the read');
      }
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;
    pollAttemptsRef.current = 0;
    setPollExpired(false);
    void load();
    let cancelled = false;
    fetchProjectDetail(id)
      .then((p) => { if (!cancelled) setProject(p); })
      .catch(() => { /* best-effort — the page still reads fine unnamed */ });
    return () => { cancelled = true; };
  }, [id, load]);

  // Drafting poll: every ~5s, up to a few minutes, then go quiet and
  // leave a manual "check again" link.
  useEffect(() => {
    if (phase !== 'drafting' || pollExpired) return;
    if (pollAttemptsRef.current >= POLL_MAX_ATTEMPTS) {
      setPollExpired(true);
      return;
    }
    const t = setTimeout(() => {
      pollAttemptsRef.current += 1;
      void load({ silent: true });
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(t);
  }, [phase, pollExpired, pollTick, load]);

  const manualRefresh = useCallback(() => {
    pollAttemptsRef.current = 0;
    setPollExpired(false);
    void load();
  }, [load]);

  // Swap in a corrected payload: fade the next-thing out and back in,
  // flash "— rewritten from your edit". Reduced motion = instant swap.
  const applyCorrected = useCallback((payload: ReadPayload) => {
    const finish = () => {
      setRead(payload);
      setNextFaded(false);
      setFlashShown(true);
      later(() => setFlashShown(false), 2200);
    };
    if (prefersReducedMotion()) {
      finish();
      return;
    }
    setNextFaded(true);
    later(finish, 300);
  }, [later]);

  const handleCorrection = useCallback(async (
    claimId: string,
    correction: ClaimCorrection,
  ): Promise<boolean> => {
    if (!id) return false;
    setSavingClaimId(claimId);
    setClaimNotice(null);
    try {
      const payload = await correctClaim(id, claimId, correction);
      setOpenPopClaimId(null);
      applyCorrected(payload);
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setClaimNotice('Sign in to correct the read.');
      } else {
        setClaimNotice(err instanceof Error ? err.message : "The correction didn't save. Try again.");
      }
      return false;
    } finally {
      setSavingClaimId(null);
    }
  }, [id, applyCorrected]);

  const handleUnlock = useCallback(async () => {
    if (!id) return;
    setUnlocking(true);
    setPromptNotice(null);
    try {
      setRead(await unlockRead(id));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setPromptNotice('Sign in to unlock the prompt.');
      } else {
        setPromptNotice(err instanceof Error ? err.message : "The unlock didn't take. Try again.");
      }
    } finally {
      setUnlocking(false);
    }
  }, [id]);

  const repoLabel = project ? `${project.owner}/${project.repo}` : null;
  const appName = useMemo(() => {
    const repo = project?.repo;
    if (!repo) return 'This app';
    return repo.charAt(0).toUpperCase() + repo.slice(1);
  }, [project]);

  const orderedClaims = useMemo(() => {
    if (!read) return [];
    return SLOT_ORDER
      .map((slot) => read.claims.find((c) => c.slot === slot))
      .filter((c): c is ReadClaim => !!c);
  }, [read]);
  const claimBySlot = useCallback(
    (slot: ReadClaimSlot) => orderedClaims.find((c) => c.slot === slot) ?? null,
    [orderedClaims],
  );
  const footnoteOf = useCallback(
    (claim: ReadClaim) => orderedClaims.indexOf(claim) + 1,
    [orderedClaims],
  );

  const popClaim = openPopClaimId
    ? orderedClaims.find((c) => c.id === openPopClaimId) ?? null
    : null;

  const renderClaim = (claim: ReadClaim) => (
    <ClaimPhrase
      claim={claim}
      saving={savingClaimId === claim.id}
      onOpenPop={() => setOpenPopClaimId(claim.id)}
      onCommitText={(text) => handleCorrection(claim.id, { text })}
    />
  );

  const objective = claimBySlot('objective');
  const audience = claimBySlot('audience');
  const coreJob = claimBySlot('core_job');
  const hasNext = !!read && (read.next.title !== null || read.next.why !== null);

  return (
    <div className="read-page">
      <div className="masthead">
        <div className="mh-left">
          <Link to="/dashboard" className="wordmark">Takeoff</Link>
          <span className="dateline">
            a read of <span className="mono">{repoLabel ?? 'this project'}</span>
          </span>
        </div>
        {phase === 'ready' && read ? (
          <div className="mh-right">
            {read.fileCount !== null ? `${read.fileCount} files · ` : ''}
            drafted {timeAgo(read.draftedAt)}
          </div>
        ) : null}
      </div>
      <div className="sheet"><hr className="toprule" /><hr className="topthin" /></div>

      <div className="sheet">
        {phase === 'loading' ? (
          <div className="read-state">
            <p className="st-lead">Fetching the read…</p>
          </div>
        ) : phase === 'error' ? (
          <div className="read-state">
            <p className="st-lead">The read couldn't be fetched.</p>
            <p className="st-sub">{error}</p>
            <button type="button" className="link" onClick={manualRefresh}>Try again</button>
          </div>
        ) : phase === 'drafting' ? (
          <div className="read-state">
            {pollExpired ? (
              <>
                <p className="st-lead">The read is taking longer than it should.</p>
                <p className="st-sub">
                  The draft wasn't ready after a few minutes of checking. It may still
                  be on its way — or the analysis may not have finished.
                </p>
                <button type="button" className="link" onClick={manualRefresh}>Check again</button>
              </>
            ) : (
              <>
                <p className="st-lead">The read is still being drafted…</p>
                <p className="st-sub">
                  The repo is being read and set in type. This page checks again every
                  few seconds — the draft will appear on its own.
                </p>
              </>
            )}
          </div>
        ) : read ? (
          <>
            <div className="read">
              <div className="col-text">
                <p className="kicker">
                  Drafted from your code — click any line to correct it. Yellow is where we're unsure.
                </p>

                <p className="intent">
                  <span className="name">{appName}</span>
                  {objective ? (
                    <>
                      {' '}{renderClaim(objective)}.<span className="fn">{footnoteOf(objective)}</span>
                    </>
                  ) : null}
                  {audience ? (
                    <>
                      {' '}It's for {renderClaim(audience)}<span className="fn">{footnoteOf(audience)}</span>—
                    </>
                  ) : null}
                  {coreJob ? (
                    <>
                      {' '}and the one thing it can't get wrong is {renderClaim(coreJob)}.
                      <span className="fn">{footnoteOf(coreJob)}</span>
                    </>
                  ) : null}
                </p>

                {popClaim?.alternative ? (
                  <EditorPop
                    key={popClaim.id}
                    alternative={popClaim.alternative}
                    saving={savingClaimId === popClaim.id}
                    onSave={(optionId) => void handleCorrection(popClaim.id, { optionId })}
                  />
                ) : null}

                {claimNotice ? <p className="gentle-note">{claimNotice}</p> : null}
              </div>

              <Marginalia claims={orderedClaims} />
            </div>

            <div className="midrule"><span>So the next thing to build</span></div>

            <div className="next">
              <p className="lead">
                Given that read, one thing stands between {appName} and its first real reader
                <span className={flashShown ? 'flash show' : 'flash'}>— rewritten from your edit</span>
              </p>
              {hasNext ? (
                <>
                  <h2 style={{ opacity: nextFaded ? 0 : 1 }}>{read.next.title}</h2>
                  <p className="why" style={{ opacity: nextFaded ? 0 : 1 }}>{read.next.why}</p>
                  {read.nextStale ? (
                    <p className="stale-note">
                      — the next step hasn't caught up to this correction yet.
                    </p>
                  ) : null}
                  <PromptFrame
                    next={read.next}
                    faded={nextFaded}
                    unlocking={unlocking}
                    onUnlock={() => void handleUnlock()}
                  />
                </>
              ) : (
                <p className="st-sub">The next thing hasn't been derived yet — correct a claim, or check back shortly.</p>
              )}
              {promptNotice ? <p className="gentle-note">{promptNotice}</p> : null}
            </div>
          </>
        ) : null}
      </div>

      {phase === 'ready' ? (
        <div className="footer">
          <hr className="fr" />
          <p>
            Nothing here was typed by you from scratch — it was read from the repo and
            set in type. Your job is only to correct it. Each correction is kept, and
            the next read starts from what you've already settled.
          </p>
        </div>
      ) : null}
    </div>
  );
}
