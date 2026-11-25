import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Button } from '../../components/takeoff';
import { cx } from '../../components/takeoff/status';
import { ApiError } from '../../lib/api-error';
import {
  confirmRecommendation,
  createInvite,
  dismissRecommendation,
  fetchTeam,
  removeMember,
  revokeInvite,
  setMyLabels,
  type MemberLabel,
  type Team,
} from '../../services/teamApi';
import styles from './Team.module.css';

const LABEL_TEXT: Record<MemberLabel, string> = { creator: 'Creator', builder: 'Builder' };
const LABEL_HINT: Record<MemberLabel, string> = {
  creator: 'decides what the product should do',
  builder: 'builds it, with or without an AI agent',
};

export function labelsText(labels: MemberLabel[]): string {
  return labels.length ? labels.map((l) => LABEL_TEXT[l]).join(' and ') : 'No role picked yet';
}

/** Creator / builder checkboxes. At least one stays picked. */
export function LabelPicker({ value, options, onChange, disabled }: {
  value: MemberLabel[];
  options: MemberLabel[];
  onChange: (next: MemberLabel[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className={styles.labels} disabled={disabled}>
      <legend className="type-small">What do you do here? Pick one or both.</legend>
      {options.map((l) => (
        <label key={l} className={styles.labelOption}>
          <input
            type="checkbox"
            checked={value.includes(l)}
            onChange={(e) => onChange(e.target.checked ? [...value, l] : value.filter((x) => x !== l))}
          />
          <span className="type-body">
            <strong>{LABEL_TEXT[l]}</strong>
            <span className={styles.muted}>: {LABEL_HINT[l]}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

const fullLink = (path: string) => `${window.location.origin}${path}`;

/**
 * Who's on the project, open invites, and recommendations waiting for
 * someone with write access. Renders nothing for people who aren't members.
 */
export function TeamSection({ projectId }: { projectId: string }) {
  const inputId = useId();
  const [team, setTeam] = useState<Team | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [editingLabels, setEditingLabels] = useState<MemberLabel[] | null>(null);

  const load = useCallback(async () => {
    try {
      setTeam(await fetchTeam(projectId));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403 || err.status === 404 || err.status === 503)) {
        setHidden(true);
      } else {
        setError((err as Error).message || 'Couldn’t load the team.');
      }
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setNote(null);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message || 'That didn’t work. Try again.');
    } finally {
      setBusy(null);
    }
  };

  if (hidden) return null;

  const onInvite = (e: FormEvent) => {
    e.preventDefault();
    const value = target.trim();
    if (!value) return;
    void run('invite', async () => {
      const out = await createInvite(projectId, value);
      const link = fullLink(out.path);
      setLastLink(link);
      setTarget('');
      if (out.invite.email) {
        setNote(out.emailSent
          ? `We emailed ${out.invite.email} a sign-in link. You can also send them the invite link below.`
          : `We couldn’t email ${out.invite.email} just now. Send them the invite link below.`);
      } else {
        setNote(`Send ${out.invite.githubLogin} the invite link below. We don’t email GitHub invites. They’ll sign in with that GitHub account.`);
      }
      await load();
    });
  };

  const copyLink = (link: string) => {
    void navigator.clipboard?.writeText(link).then(() => setNote('Invite link copied.'), () => setNote(link));
  };

  return (
    <section aria-labelledby="team-title" className={styles.section}>
      <div className={styles.head}>
        <h2 id="team-title" className="type-title">Who’s on this project</h2>
      </div>
      <p className={cx('type-small', styles.muted)}>
        Everyone here can see the whole project and invite others. Changes to the repo need write access on GitHub;
        without it, Takeoff keeps your change as a recommendation for someone who has it.
      </p>

      {error ? <p role="alert" className={cx('type-small', styles.error)}>{error}</p> : null}

      {!team ? (
        <p className={cx('type-small', styles.muted)} role="status">Loading the team…</p>
      ) : (
        <>
          <ul className={styles.list}>
            {team.members.map((m) => {
              const isYou = m.userId === team.you.userId;
              return (
                <li key={m.userId} className={styles.row}>
                  <div className={styles.who}>
                    <span className="type-heading">
                      {m.name || m.email || (m.isOwner ? 'Project owner' : 'Member')}
                      {isYou ? <span className={styles.muted}> (you)</span> : null}
                    </span>
                    <span className={cx('type-small', styles.muted)}>
                      {m.isOwner ? 'Owner · ' : ''}{labelsText(m.labels)}
                      {m.email && m.name ? ` · ${m.email}` : ''}
                    </span>
                  </div>
                  <div className={styles.actions}>
                    {isYou ? (
                      <Button variant="quiet" size="sm" onClick={() => setEditingLabels(editingLabels ? null : m.labels)}>
                        {editingLabels ? 'Cancel' : 'Change your role'}
                      </Button>
                    ) : null}
                    {!m.isOwner && (team.you.isOwner || isYou) ? (
                      <Button
                        variant="quiet"
                        size="sm"
                        disabled={busy === `remove:${m.userId}`}
                        onClick={() => {
                          const msg = isYou ? 'Leave this project?' : `Remove ${m.name || m.email || 'this member'} from the project?`;
                          if (!window.confirm(msg)) return;
                          void run(`remove:${m.userId}`, async () => {
                            await removeMember(projectId, m.userId);
                            if (isYou) { window.location.href = '/dashboard'; return; }
                            await load();
                          });
                        }}
                      >
                        {isYou ? 'Leave' : 'Remove'}
                      </Button>
                    ) : null}
                  </div>
                  {isYou && editingLabels ? (
                    <div className={styles.editor}>
                      <LabelPicker value={editingLabels} options={team.labels} onChange={setEditingLabels} disabled={busy === 'labels'} />
                      <div>
                        <Button
                          variant="quiet"
                          size="sm"
                          disabled={editingLabels.length === 0 || busy === 'labels'}
                          onClick={() => void run('labels', async () => {
                            await setMyLabels(projectId, editingLabels);
                            setEditingLabels(null);
                            await load();
                          })}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <form className={styles.invite} onSubmit={onInvite}>
            <label htmlFor={inputId} className="type-heading">Invite someone</label>
            <p className={cx('type-small', styles.muted)}>
              Use their email address or GitHub username. They don’t need a GitHub account to join.
            </p>
            <div className={styles.inviteRow}>
              <input
                id={inputId}
                className={cx('type-body', styles.input)}
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="name@example.com or @username"
                autoComplete="off"
                maxLength={254}
              />
              <Button variant="quiet" type="submit" disabled={!target.trim() || busy === 'invite'}>
                {busy === 'invite' ? 'Inviting…' : 'Invite'}
              </Button>
            </div>
            {note ? <p role="status" className="type-small">{note}</p> : null}
            {lastLink ? (
              <div className={styles.linkRow}>
                <code className={cx('type-small', styles.link)}>{lastLink}</code>
                <Button variant="quiet" size="sm" onClick={() => copyLink(lastLink)}>Copy invite link</Button>
              </div>
            ) : null}
          </form>

          {team.invites.length > 0 ? (
            <div className={styles.block}>
              <p className={cx('type-eyebrow', styles.muted)}>Waiting to join</p>
              <ul className={styles.list}>
                {team.invites.map((i) => (
                  <li key={i.id} className={styles.row}>
                    <div className={styles.who}>
                      <span className="type-body">{i.email || i.githubLogin}</span>
                      <span className={cx('type-small', styles.muted)}>
                        Invited{i.invitedByName ? ` by ${i.invitedByName}` : ''} · link works until {new Date(i.expiresAt).toLocaleDateString()}
                      </span>
                    </div>
                    {team.you.isOwner || i.invitedBy === team.you.userId ? (
                      <div className={styles.actions}>
                        <Button
                          variant="quiet"
                          size="sm"
                          disabled={busy === `revoke:${i.id}`}
                          onClick={() => void run(`revoke:${i.id}`, async () => { await revokeInvite(projectId, i.id); await load(); })}
                        >
                          Cancel invite
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className={cx('type-small', styles.muted)}>
                To send someone a fresh link, invite them again. The old link stops working.
              </p>
            </div>
          ) : null}

          {team.recommendations.length > 0 ? (
            <div className={styles.block}>
              <p className={cx('type-eyebrow', styles.muted)}>Waiting for someone with write access</p>
              <ul className={styles.list}>
                {team.recommendations.map((r) => {
                  const by = team.members.find((m) => m.userId === r.createdBy);
                  return (
                    <li key={r.id} className={styles.row}>
                      <div className={styles.who}>
                        <span className="type-body">{r.summary}</span>
                        <span className={cx('type-small', styles.muted)}>
                          Recommended by {by ? by.name || by.email || 'a member' : 'a member'}
                          {r.status === 'confirming' ? ' · being applied now' : ''}
                        </span>
                      </div>
                      {r.status === 'pending' ? (
                        <div className={styles.actions}>
                          <Button
                            variant="quiet"
                            size="sm"
                            disabled={busy === `confirm:${r.id}`}
                            onClick={() => void run(`confirm:${r.id}`, async () => {
                              try {
                                await confirmRecommendation(projectId, r.id);
                                setNote('Done. The change is in the repo.');
                              } catch (err) {
                                if (err instanceof ApiError && err.code === 'GITHUB_NOT_CONNECTED') {
                                  throw new Error('Connect GitHub first. Confirming needs write access to the repo.');
                                }
                                throw err;
                              } finally {
                                await load();
                              }
                            })}
                          >
                            Confirm
                          </Button>
                          <Button
                            variant="quiet"
                            size="sm"
                            disabled={busy === `dismiss:${r.id}`}
                            onClick={() => void run(`dismiss:${r.id}`, async () => { await dismissRecommendation(projectId, r.id); await load(); })}
                          >
                            Dismiss
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {!team.you.githubConnected ? (
                <div className={styles.inviteRow}>
                  <p className={cx('type-small', styles.muted)}>
                    To confirm these, connect the GitHub account that has write access to this repo.
                  </p>
                  <Button
                    variant="quiet"
                    size="sm"
                    onClick={() => {
                      const back = `${window.location.pathname}${window.location.search}`;
                      window.location.href = `/api/github-app/authorize?returnTo=${encodeURIComponent(back)}`;
                    }}
                  >
                    Connect GitHub
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
