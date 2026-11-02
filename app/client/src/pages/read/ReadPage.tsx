import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fetchProjectDetail, reanalyzeProject, type ProjectWithEntries } from '../../services/api';
import {
  fetchRead, correctClaim, unlockRead,
  type ReadPayload, type ReadClaim, type ReadClaimSlot, type ClaimCorrection,
} from '../../services/readApi';
import { ApiError } from '../../lib/api-error';
import { useAuth } from '../../hooks/useAuth';
import GapsSection from '../v2/GapsSection';
import ShippedSection from '../v2/ShippedSection';
import MapSection from '../v2/MapSection';
import IntentSection from '../v2/IntentSection';
import SettingsSection from '../v2/SettingsSection';
import ClaimPhrase from './ClaimPhrase';
import EditorPop from './EditorPop';
import Marginalia from './Marginalia';
import PromptFrame from './PromptFrame';
import { track } from '../../services/telemetry';
import './read.css';

// "The Read" — the manuscript page, now also the project shell. Four tabs:
//   Spec     — the prose read + jobs by persona + the guarantees under them
//   Build    — the next thing to build (with its prompt) + the gap queue
//   Shipped  — what landed and whether it held
//   Settings — repo, context files, danger zone
// Visual source of truth for the prose: prototypes/living-spec-draft.html.
// GET is public; writes surface a gentle sign-in note on 401 instead of a
// wall, and signed-out visitors see no owner controls at all.

const SLOT_ORDER: ReadClaimSlot[] = ['objective', 'audience', 'core_job'];
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 36; // ~3 minutes of "still drafting" polling

const TABS = ['spec', 'build', 'shipped', 'settings'] as const;
type TabId = (typeof TABS)[number];

const TAB_DEFS: Array<{ id: TabId; label: string }> = [
  { id: 'spec', label: 'Spec' },
  { id: 'build', label: 'Build' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'settings', label: 'Settings' },
];

// Old six-tab deep links keep resolving to the section that absorbed them.
const LEGACY_HASH: Record<string, TabId> = {
  read: 'spec',
  map: 'spec',
  intent: 'spec',
  gaps: 'build',
  context: 'settings', // repo & context files now live under Settings
};

type Phase = 'loading' | 'drafting' | 'error' | 'ready';

function readHashTab(): TabId {
  if (typeof window === 'undefined') return 'spec';
  const raw = window.location.hash.replace(/^#/, '').toLowerCase();
  if ((TABS as readonly string[]).includes(raw)) return raw as TabId;
  return LEGACY_HASH[raw] ?? 'spec';
}

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
  const navigate = useNavigate();
  const { user, loading: authLoading, login } = useAuth();
  // Owner controls (confirm / accept / delete / re-analyze) only render for
  // signed-in visitors. The server still enforces this; hiding the controls
  // is what keeps a shared Read from looking editable to a stranger.
  const canEdit = !!user;

  const [read, setRead] = useState<ReadPayload | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [pollExpired, setPollExpired] = useState(false);
  const [pollTick, setPollTick] = useState(0);
  // Best-effort: names the masthead dateline and the sentence subject.
  const [project, setProject] = useState<ProjectWithEntries | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>(readHashTab);

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

  const setTab = useCallback((next: TabId) => {
    if (next === 'spec') {
      // Default tab — keep the URL clean.
      if (window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    } else {
      window.location.hash = next;
    }
    setActiveTab(next);
  }, []);

  useEffect(() => {
    function onHashChange() { setActiveTab(readHashTab()); }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
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
      .then((p) => {
        if (cancelled) return;
        setProject(p);
        if (p.status === 'analyzing' || p.status === 'pending') {
          navigate(`/takeoff/${id}`, { replace: true });
        }
      })
      .catch(() => { /* best-effort — the page still reads fine unnamed */ });
    return () => { cancelled = true; };
  }, [id, load, navigate]);

  // Drafting poll: every ~5s, up to a few minutes, then go quiet and
  // leave a manual "check again" link.
  const scanFailed = project?.status === 'failed';
  useEffect(() => {
    if (phase !== 'drafting' || pollExpired || scanFailed) return;
    if (pollAttemptsRef.current >= POLL_MAX_ATTEMPTS) {
      setPollExpired(true);
      return;
    }
    const t = setTimeout(() => {
      pollAttemptsRef.current += 1;
      void load({ silent: true });
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(t);
  }, [phase, pollExpired, pollTick, load, scanFailed]);

  // Failed scans have nothing to lose, so retry skips the re-analyze
  // confirmation modal. Uploaded folders can't be re-run (no source to
  // fetch), so they only get the "scan another repo" path.
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const canRetry = !!project && !String(project.repo_url ?? '').startsWith('local://');
  const retryScan = useCallback(async () => {
    if (!id || retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      await reanalyzeProject(id);
      navigate(`/takeoff/${id}`, { replace: true });
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "The scan couldn't be restarted.");
      setRetrying(false);
    }
  }, [id, retrying, navigate]);

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
      track('prompt_loaded', { projectId: id });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setPromptNotice('Sign in to see the prompt.');
      } else {
        setPromptNotice(err instanceof Error ? err.message : "The prompt didn't load. Try again.");
      }
    } finally {
      setUnlocking(false);
    }
  }, [id]);

  // The prompt is gated on sign-in, nothing more. Once a signed-in reader
  // lands on a gated read, fetch the prompt for them without a click.
  const autoUnlockedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!id || !user || authLoading || !read?.next.gated) return;
    if (autoUnlockedRef.current === id) return;
    autoUnlockedRef.current = id;
    void handleUnlock();
  }, [id, user, authLoading, read?.next.gated, handleUnlock]);

  const handleSignIn = useCallback(() => {
    track('sign_in_clicked', { projectId: id ?? null, metadata: { source: 'read' } });
    login('github');
  }, [login, id]);

  // Funnel: record the first view of Spec and Build per project. Fires once
  // the read is actually on screen, not on the loading state.
  const viewedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!id || phase !== 'ready') return;
    const ev = activeTab === 'spec' ? 'read_viewed' : activeTab === 'build' ? 'build_viewed' : null;
    if (!ev) return;
    const key = `${id}:${ev}`;
    if (viewedRef.current.has(key)) return;
    viewedRef.current.add(key);
    track(ev, { projectId: id, metadata: { signedIn: canEdit } });
  }, [id, phase, activeTab, canEdit]);

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
      readOnly={!canEdit}
      saving={savingClaimId === claim.id}
      onOpenPop={() => setOpenPopClaimId(claim.id)}
      onCommitText={(text) => handleCorrection(claim.id, { text })}
    />
  );

  const objective = claimBySlot('objective');
  const audience = claimBySlot('audience');
  const coreJob = claimBySlot('core_job');
  const hasNext = !!read && (read.next.title !== null || read.next.why !== null);

  // Loading / drafting / error states are shared by the Spec and Build tabs,
  // since both are drawn from the same read payload.
  const readState = scanFailed && phase !== 'ready' ? (
    <div className="read-state">
      <p className="st-lead">The scan didn't finish.</p>
      <p className="st-sub">
        {project?.error
          ? project.error
          : 'Something went wrong while reading the repo, so there is no read to show yet.'}
      </p>
      {canEdit && canRetry ? (
        <button type="button" className="link" disabled={retrying} onClick={() => void retryScan()}>
          {retrying ? 'Restarting…' : 'Try the scan again'}
        </button>
      ) : null}
      {canEdit && canRetry ? ' · ' : null}
      <Link to="/" className="link">Scan another repo →</Link>
      {retryError ? <p className="gentle-note">{retryError}</p> : null}
    </div>
  ) : phase === 'loading' ? (
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
  ) : null;

  // Spec: the prose read, then the jobs and guarantees it rests on.
  const specBody = read ? (
    <>
      <div className="read">
        <div className="col-text">
          <p className="kicker">
            {canEdit
              ? "Drafted from your code — click any line to correct it. Yellow is where we're unsure."
              : "Drafted from the code. Yellow is where we're unsure."}
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

      <div className="midrule"><span>What it rests on</span></div>

      {id ? (
        <div className="read-panel v2-font-sans">
          <div className="space-y-8">
            <IntentSection projectId={id} readOnly={!canEdit} />
            <MapSection projectId={id} readOnly={!canEdit} />
          </div>
        </div>
      ) : null}

      <div className="midrule"><span>Then</span></div>
      <div className="next">
        <p className="lead">
          The spec is only useful for what it lets you build next.
        </p>
        <button type="button" className="link" onClick={() => setTab('build')}>
          Pick what to build →
        </button>
      </div>
    </>
  ) : null;

  // Build: the derived next thing with its prompt, then the gap queue.
  const buildBody = read ? (
    <>
      <div className="next">
        <p className="lead">
          Given the spec, one thing stands between {appName} and its first real reader
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
              projectId={id ?? ''}
              next={read.next}
              faded={nextFaded}
              unlocking={unlocking}
              signedIn={canEdit}
              onSignIn={handleSignIn}
              onUnlock={() => void handleUnlock()}
            />
          </>
        ) : (
          <p className="st-sub">
            {canEdit
              ? "The next thing hasn't been derived yet — correct a claim on the Spec tab, or check back shortly."
              : "The next thing hasn't been derived for this project yet. Check back shortly."}
          </p>
        )}
        {promptNotice ? <p className="gentle-note">{promptNotice}</p> : null}
      </div>

      <div className="midrule"><span>And after that</span></div>

      {id ? (
        <div className="read-panel v2-font-sans">
          <GapsSection projectId={id} readOnly={!canEdit} />
        </div>
      ) : null}
    </>
  ) : null;

  return (
    <div className="read-page">
      <div className="masthead">
        <div className="mh-left">
          <Link to="/dashboard" className="wordmark">Takeoff</Link>
          <span className="dateline">
            a read of <span className="mono">{repoLabel ?? 'this project'}</span>
          </span>
        </div>
        {phase === 'ready' && read && activeTab === 'spec' ? (
          <div className="mh-right">
            {read.fileCount !== null ? `${read.fileCount} files · ` : ''}
            drafted {timeAgo(read.draftedAt)}
          </div>
        ) : null}
      </div>
      <div className="sheet"><hr className="toprule" /><hr className="topthin" /></div>

      {!authLoading && !canEdit ? (
        <div className="sheet">
          <p className="visitor-note">
            You're reading someone else's project.{' '}
            <Link to="/" className="link">Scan your own repo →</Link>
            {' '}or{' '}
            <button type="button" className="link" onClick={handleSignIn}>sign in</button>
            {' '}to edit this one.
          </p>
        </div>
      ) : null}

      <div className="sheet">
        <nav className="read-tabs" role="tablist" aria-label="Project sections">
          {TAB_DEFS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                id={`tab-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
                className={isActive ? 'rtab active' : 'rtab'}
                onClick={() => setTab(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="sheet" role="tabpanel" aria-labelledby={`tab-${activeTab}`}>
        {activeTab === 'spec' ? (readState ?? specBody) : null}
        {activeTab === 'build' ? (readState ?? buildBody) : null}
        {id && activeTab === 'shipped' ? (
          <div className="read-panel v2-font-sans">
            <ShippedSection projectId={id} readOnly={!canEdit} />
          </div>
        ) : null}
        {id && activeTab === 'settings' ? (
          <div className="read-panel v2-font-sans">
            <SettingsSection projectId={id} readOnly={!canEdit} />
          </div>
        ) : null}
      </div>

      {phase === 'ready' && activeTab === 'spec' ? (
        <div className="footer">
          <hr className="fr" />
          <p>
            {canEdit
              ? 'Nothing here was typed by you from scratch — it was read from the repo and '
                + 'set in type. Your job is only to correct it. Each correction is kept, and '
                + 'the next read starts from what you\'ve already settled.'
              : 'Nothing here was typed by hand — it was read from the repo and set in type. '
                + 'The owner corrects it; each correction is kept, and the next read starts '
                + 'from what they\'ve already settled.'}
          </p>
        </div>
      ) : null}
    </div>
  );
}
