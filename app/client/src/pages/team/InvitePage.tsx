import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Header from '../../components/Header';
import { Button, ButtonLink } from '../../components/takeoff';
import { cx } from '../../components/takeoff/status';
import { useAuth } from '../../hooks/useAuth';
import { ApiError } from '../../lib/api-error';
import { rememberAfterSignIn } from '../../lib/safe-next';
import { acceptInvite, previewInvite, requestInviteSignInLink, type InvitePreview, type MemberLabel } from '../../services/teamApi';
import { LabelPicker } from './TeamSection';
import styles from './Team.module.css';

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className={cx('takeoff', styles.page)}>
      <Header variant="takeoff" />
      <main className={styles.card}>{children}</main>
    </div>
  );
}

async function signOut() {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' } }).catch(() => {});
  window.location.reload();
}

/** /invite/:token — see who invited you, sign in, pick your role, join. */
export default function InvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [labels, setLabels] = useState<MemberLabel[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInvite(await previewInvite(token));
    } catch (err) {
      setLoadError(err instanceof ApiError && err.status === 404
        ? 'This invite link isn’t valid. It may have been replaced by a newer one. Ask for a new invite.'
        : (err as Error).message || 'We couldn’t load this invite.');
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  if (loadError) {
    return (
      <Page>
        <h1 className="type-title">This invite can’t be opened</h1>
        <p className={cx('type-body', styles.muted)}>{loadError}</p>
      </Page>
    );
  }
  if (!invite) {
    return <Page><p className={cx('type-body', styles.muted)} role="status">Opening your invite…</p></Page>;
  }

  const projectHref = invite.projectId ? `/read/${invite.projectId}` : '/dashboard';
  const from = invite.invitedByName ? `${invite.invitedByName} invited you` : 'You’re invited';

  if (invite.state !== 'open') {
    return (
      <Page>
        <h1 className="type-title">
          {invite.alreadyMember ? `You’re on ${invite.projectName}` : 'This invite can’t be used any more'}
        </h1>
        <p className={cx('type-body', styles.muted)}>
          {invite.alreadyMember
            ? 'You already joined this project.'
            : invite.state === 'expired'
              ? 'It expired. Ask the person who invited you for a new one.'
              : 'It was already used or cancelled. Ask the person who invited you for a new one.'}
        </p>
        {invite.alreadyMember ? <div><ButtonLink variant="primary" to={projectHref}>Open the project</ButtonLink></div> : null}
      </Page>
    );
  }

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await acceptInvite(token, labels);
      navigate(`/read/${out.projectId}`, { replace: true });
    } catch (err) {
      setError((err as Error).message || 'We couldn’t add you just now. Try again.');
      setBusy(false);
    }
  };

  const emailMe = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await requestInviteSignInLink(token);
      setSentTo(out.to);
    } catch (err) {
      setError((err as Error).message || 'We couldn’t send the email. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const githubSignIn = () => {
    rememberAfterSignIn(`/invite/${token}`);
    login('github');
  };

  return (
    <Page>
      <p className={cx('type-eyebrow', styles.muted)}>{from}</p>
      <h1 className="type-title">Join {invite.projectName} on Takeoff</h1>
      <p className={cx('type-body', styles.muted)}>
        You’ll see the whole project: what it’s for, what’s left before launch, and what changed lately.
        {invite.kind === 'email' ? ' You don’t need a GitHub account to join.' : ''}
      </p>

      {error ? <p role="alert" className={cx('type-small', styles.error)}>{error}</p> : null}

      {!invite.signedIn ? (
        invite.kind === 'email' ? (
          <>
            <p className="type-body">This invite is for {invite.invitedFor}. We’ll email that address a link to sign in.</p>
            {sentTo ? (
              <p role="status" className="type-body">Check {sentTo} for the sign-in link. It brings you back here.</p>
            ) : (
              <div><Button variant="primary" onClick={() => void emailMe()} disabled={busy}>Email me a sign-in link</Button></div>
            )}
          </>
        ) : (
          <>
            <p className="type-body">This invite is for the GitHub account {invite.invitedFor}. Sign in with it to join.</p>
            <div><Button variant="primary" onClick={githubSignIn}>Sign in with GitHub</Button></div>
          </>
        )
      ) : !invite.matches ? (
        <>
          <p className="type-body">
            {invite.kind === 'email'
              ? `This invite is for ${invite.invitedFor}, and you’re signed in with a different email.`
              : invite.reason === 'github_not_connected'
                ? `This invite is for the GitHub account ${invite.invitedFor}. Sign in with GitHub to join.`
                : `This invite is for the GitHub account ${invite.invitedFor}, and you’re signed in as someone else.`}
          </p>
          <div className={styles.buttons}>
            {invite.kind === 'github' && invite.reason === 'github_not_connected' ? (
              <Button variant="primary" onClick={githubSignIn}>Sign in with GitHub</Button>
            ) : (
              <Button variant="primary" onClick={() => void signOut()}>Sign out and try again</Button>
            )}
          </div>
        </>
      ) : (
        <>
          <LabelPicker value={labels} options={invite.labels} onChange={setLabels} disabled={busy} />
          <p className={cx('type-small', styles.muted)}>You can change this any time.</p>
          <div>
            <Button variant="primary" onClick={() => void join()} disabled={busy || labels.length === 0}>
              {busy ? 'Joining…' : 'Join the project'}
            </Button>
          </div>
        </>
      )}
      <p className="type-small"><Link to="/" className={styles.muted}>What is Takeoff?</Link></p>
    </Page>
  );
}
