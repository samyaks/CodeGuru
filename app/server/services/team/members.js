'use strict';

// Project members and invites (Takeoff Milestone 2).
//
// The owner is deployments.user_id; everyone else joins through an invite,
// by email or GitHub username. All members view everything in the project
// and can invite. Labels (creator, builder) describe what someone does; they
// never gate access. Writing to the repo is separate (committing.js).
//
// An invite link carries a random token; only its sha256 is stored. A link
// works once and expires after 14 days. An email invite can only be used by
// someone signed in with that (confirmed) email; a GitHub invite only by
// someone whose GitHub account has that login.

const crypto = require('crypto');
const { AppError } = require('../../lib/app-error');
const { githubIdentity, displayName } = require('./identity');

const INVITE_TTL_DAYS = 14;
const LINK_RESEND_SECONDS = 60;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const GITHUB_LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;

function defaultDeps() {
  const db = require('../../lib/db');
  return {
    projectMembers: db.projectMembers,
    projectInvites: db.projectInvites,
    userGithubLinks: db.userGithubLinks,
    deployments: db.deployments,
    memberLabels: db.MEMBER_LABELS,
    newId: () => crypto.randomUUID(),
    now: () => new Date(),
    appUrl: appUrlFromEnv(),
    sendSignInLink: null, // set by the routes when Supabase is configured
  };
}

/** The app's public origin, for links in emails. */
function appUrlFromEnv(env = process.env) {
  const direct = (env.TAKEOFF_APP_URL || env.FRONTEND_URL || '').trim().replace(/\/+$/, '');
  if (direct) return direct;
  try {
    return env.SUPABASE_REDIRECT_URL ? new URL(env.SUPABASE_REDIRECT_URL).origin : null;
  } catch {
    return null;
  }
}

const newToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const invitePath = (token) => `/invite/${token}`;

/** Where the magic link lands: the auth callback, then on to the invite. */
function signInRedirect(appUrl, token) {
  return `${appUrl}/auth/callback?next=${encodeURIComponent(invitePath(token))}`;
}

/**
 * Parse who to invite: `{ email }`, `{ githubLogin }`, or `{ target }`
 * where target is an email or a GitHub username (with or without @).
 */
function parseInviteTarget(body = {}) {
  let { email, githubLogin, target } = body || {};
  if (typeof target === 'string' && !email && !githubLogin) {
    const t = target.trim();
    if (t.includes('@') && !t.startsWith('@')) email = t;
    else githubLogin = t.replace(/^@/, '');
  }
  if (typeof email === 'string' && email.trim()) {
    const e = email.trim().toLowerCase();
    if (e.length > 254 || !EMAIL_RE.test(e)) throw AppError.badRequest('That email address doesn\'t look right.');
    return { email: e, githubLogin: null };
  }
  if (typeof githubLogin === 'string' && githubLogin.trim()) {
    const g = githubLogin.trim().replace(/^@/, '');
    if (!GITHUB_LOGIN_RE.test(g)) throw AppError.badRequest('That GitHub username doesn\'t look right.');
    return { email: null, githubLogin: g };
  }
  throw AppError.badRequest('Give an email address or a GitHub username to invite.');
}

function normalizeLabels(labels, allowed) {
  if (!Array.isArray(labels)) throw AppError.badRequest('labels must be a list');
  const set = [...new Set(labels.map((l) => String(l).toLowerCase().trim()))];
  if (set.length === 0) throw AppError.badRequest('Pick at least one: creator, builder, or both.');
  for (const l of set) {
    if (!allowed.includes(l)) throw AppError.badRequest(`Unknown label: ${l.slice(0, 40)}`);
  }
  return allowed.filter((l) => set.includes(l));
}

function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(local.length - 1, 6)))}@${domain}`;
}

const isOwner = (project, user) => !!(user?.id && project.user_id && project.user_id === user.id);
const emailConfirmed = (user) => !!(user?.email && (user.email_confirmed_at || user.confirmed_at));

function publicMember(row, { ownerId } = {}) {
  return {
    userId: row.user_id,
    name: row.display_name || null,
    email: row.email || null,
    labels: Array.isArray(row.labels) ? row.labels : [],
    isOwner: !!ownerId && row.user_id === ownerId,
    joinedAt: row.joined_at || null,
  };
}

function publicInvite(row) {
  return {
    id: row.id,
    email: row.email || null,
    githubLogin: row.github_login || null,
    invitedBy: row.invited_by,
    invitedByName: row.invited_by_name || null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/** The owner's member row, made on first use so the owner has labels too. */
async function ensureOwnerMember(project, user, deps) {
  if (!isOwner(project, user)) return null;
  const existing = await deps.projectMembers.get(project.id, user.id);
  if (existing && (existing.email || !user.email) && (existing.display_name || !displayName(user))) return existing;
  return deps.projectMembers.ensure(project.id, user.id, { email: user.email || null, displayName: displayName(user) });
}

async function assertMember(project, user, deps) {
  if (!user?.id) throw AppError.unauthorized('Sign in to see this project.');
  if (isOwner(project, user)) return;
  const row = await deps.projectMembers.get(project.id, user.id);
  if (!row) throw AppError.forbidden('Forbidden');
}

/** Everyone on the project, open invites, and who you are. */
async function getTeam({ project, user }, deps = defaultDeps()) {
  await assertMember(project, user, deps);
  await ensureOwnerMember(project, user, deps);
  const [rows, invites, identity] = await Promise.all([
    deps.projectMembers.list(project.id),
    deps.projectInvites.listOpen(project.id),
    githubIdentity(user, deps),
  ]);
  const ownerId = project.user_id || null;
  const members = rows.map((r) => publicMember(r, { ownerId }));
  if (ownerId && !members.some((m) => m.userId === ownerId)) {
    members.unshift({ userId: ownerId, name: null, email: null, labels: [], isOwner: true, joinedAt: project.created_at || null });
  }
  members.sort((a, b) => (b.isOwner - a.isOwner) || String(a.joinedAt).localeCompare(String(b.joinedAt)));
  const me = members.find((m) => m.userId === user.id);
  return {
    you: {
      userId: user.id,
      isOwner: isOwner(project, user),
      labels: me?.labels || [],
      githubConnected: !!identity,
      githubLogin: identity?.githubLogin || null,
    },
    members,
    invites: invites.map(publicInvite),
    labels: [...deps.memberLabels],
  };
}

/**
 * Invite someone. Inviting the same address again makes a new link (the old
 * one stops working) and, for email, sends the email again.
 * @returns {{ invite, path, link, emailSent, emailError }}
 */
async function createInvite({ project, user, body }, deps = defaultDeps()) {
  await assertMember(project, user, deps);
  const target = parseInviteTarget(body);
  if (target.email && user.email && target.email === String(user.email).toLowerCase()) {
    throw AppError.badRequest('That\'s you. You\'re already on this project.');
  }
  if (target.githubLogin) {
    const me = await githubIdentity(user, deps);
    if (me && me.githubLogin.toLowerCase() === target.githubLogin.toLowerCase()) {
      throw AppError.badRequest('That\'s you. You\'re already on this project.');
    }
  }
  if (target.email) {
    const rows = await deps.projectMembers.list(project.id);
    if (rows.some((r) => r.email && String(r.email).toLowerCase() === target.email)) {
      throw AppError.conflict('They\'re already on this project.');
    }
  }

  const token = newToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(deps.now().getTime() + INVITE_TTL_DAYS * 86400000).toISOString();
  const inviter = { invitedBy: user.id, invitedByName: displayName(user) };

  let row = null;
  const open = await deps.projectInvites.findOpen(project.id, target);
  if (open) row = await deps.projectInvites.rotateToken(open.id, tokenHash, expiresAt, inviter);
  if (!row) {
    row = await deps.projectInvites.create({
      id: deps.newId(), projectId: project.id, ...target, tokenHash, expiresAt, ...inviter,
    });
  }
  if (!row) {
    // Lost a race with another invite to the same address: take that one.
    const raced = await deps.projectInvites.findOpen(project.id, target);
    if (raced) row = await deps.projectInvites.rotateToken(raced.id, tokenHash, expiresAt, inviter);
  }
  if (!row) throw AppError.conflict('Couldn\'t make that invite just now. Try again.');

  const out = {
    invite: publicInvite(row),
    path: invitePath(token),
    link: deps.appUrl ? `${deps.appUrl}${invitePath(token)}` : null,
    emailSent: false,
    emailError: null,
  };
  if (target.email) {
    const sent = await sendInviteEmail(row, token, deps);
    out.emailSent = sent.ok;
    out.emailError = sent.error;
  }
  return out;
}

async function sendInviteEmail(invite, token, deps) {
  if (!deps.sendSignInLink) return { ok: false, error: 'email_not_configured' };
  if (!deps.appUrl) return { ok: false, error: 'app_url_not_set' };
  const allowed = await deps.projectInvites.markLinkSent(invite.id, LINK_RESEND_SECONDS);
  if (!allowed) return { ok: false, error: 'rate_limited' };
  try {
    await deps.sendSignInLink(invite.email, signInRedirect(deps.appUrl, token));
    return { ok: true, error: null };
  } catch (err) {
    console.warn('[team] invite email failed:', err.message);
    return { ok: false, error: 'send_failed' };
  }
}

async function revokeInvite({ project, user, inviteId }, deps = defaultDeps()) {
  await assertMember(project, user, deps);
  const open = (await deps.projectInvites.listOpen(project.id)).find((i) => i.id === inviteId);
  if (!open) throw AppError.notFound('Invite not found');
  if (!isOwner(project, user) && open.invited_by !== user.id) {
    throw AppError.forbidden('Only the project owner or the person who sent an invite can cancel it.');
  }
  await deps.projectInvites.revoke(project.id, inviteId);
  return { revoked: true };
}

async function loadInvite(token, deps) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw AppError.notFound('This invite link isn\'t valid.');
  const invite = await deps.projectInvites.findByTokenHash(hashToken(token));
  if (!invite) throw AppError.notFound('This invite link isn\'t valid.');
  const project = await deps.deployments.findById(invite.project_id);
  if (!project) throw AppError.notFound('This invite link isn\'t valid.');
  return { invite, project };
}

function inviteState(invite, now) {
  if (invite.revoked_at) return 'revoked';
  if (invite.accepted_at) return 'used';
  if (new Date(invite.expires_at).getTime() <= now.getTime()) return 'expired';
  return 'open';
}

/** Does `user` match who the invite is for? */
async function matchInvitee(invite, user, deps) {
  if (!user?.id) return { matches: false, reason: 'signed_out' };
  if (invite.email) {
    const ok = emailConfirmed(user) && String(user.email).toLowerCase() === String(invite.email).toLowerCase();
    return { matches: ok, reason: ok ? null : 'email_mismatch' };
  }
  const identity = await githubIdentity(user, deps);
  if (!identity) return { matches: false, reason: 'github_not_connected' };
  const ok = identity.githubLogin.toLowerCase() === String(invite.github_login).toLowerCase();
  return { matches: ok, reason: ok ? null : 'github_mismatch' };
}

/** What the invite page shows, signed in or not. */
async function previewInvite({ token, user }, deps = defaultDeps()) {
  const { invite, project } = await loadInvite(token, deps);
  const state = inviteState(invite, deps.now());
  const base = {
    state,
    kind: invite.email ? 'email' : 'github',
    invitedFor: invite.email ? maskEmail(invite.email) : invite.github_login,
    invitedByName: invite.invited_by_name || null,
    projectName: project.repo ? `${project.owner}/${project.repo}` : (project.name || 'a project'),
    labels: [...deps.memberLabels],
    signedIn: !!user?.id,
  };
  if (state !== 'open') {
    const alreadyMember = !!user?.id && (isOwner(project, user) || !!(await deps.projectMembers.get(project.id, user.id)));
    return { ...base, alreadyMember, projectId: alreadyMember ? project.id : null, matches: false, reason: state };
  }
  const { matches, reason } = await matchInvitee(invite, user, deps);
  return { ...base, alreadyMember: false, projectId: null, matches, reason };
}

/** Email the invitee a sign-in link that lands back on the invite. */
async function requestSignInLink({ token }, deps = defaultDeps()) {
  const { invite } = await loadInvite(token, deps);
  if (inviteState(invite, deps.now()) !== 'open') throw AppError.badRequest('This invite can\'t be used any more.');
  if (!invite.email) throw AppError.badRequest('This invite is for a GitHub account. Sign in with GitHub.');
  if (!deps.sendSignInLink || !deps.appUrl) throw AppError.internal('Email sign-in isn\'t set up on this server.');
  const allowed = await deps.projectInvites.markLinkSent(invite.id, LINK_RESEND_SECONDS);
  if (!allowed) throw AppError.tooManyRequests('A sign-in link was just sent. Check the inbox, or try again in a minute.');
  try {
    await deps.sendSignInLink(invite.email, signInRedirect(deps.appUrl, token));
  } catch (err) {
    console.warn('[team] sign-in link failed:', err.message);
    throw AppError.internal('Couldn\'t send the sign-in email. Try again in a minute.');
  }
  return { sent: true, to: maskEmail(invite.email) };
}

/** Join the project. `labels` is what the new member picked. */
async function acceptInvite({ token, user, labels }, deps = defaultDeps()) {
  if (!user?.id) throw AppError.unauthorized('Sign in to accept this invite.');
  const picked = normalizeLabels(labels, deps.memberLabels);
  const { invite, project } = await loadInvite(token, deps);

  if (isOwner(project, user)) {
    await ensureOwnerMember(project, user, deps);
    await deps.projectMembers.setLabels(project.id, user.id, picked);
    return { projectId: project.id, alreadyMember: true };
  }
  const state = inviteState(invite, deps.now());
  if (state !== 'open') {
    if (await deps.projectMembers.get(project.id, user.id)) return { projectId: project.id, alreadyMember: true };
    throw AppError.badRequest(state === 'expired'
      ? 'This invite has expired. Ask for a new one.'
      : 'This invite has already been used or was cancelled. Ask for a new one.');
  }
  const { matches, reason } = await matchInvitee(invite, user, deps);
  if (!matches) {
    const err = AppError.forbidden(invite.email
      ? `This invite is for ${maskEmail(invite.email)}. Sign in with that email to accept it.`
      : `This invite is for the GitHub account ${invite.github_login}. Sign in with that GitHub account to accept it.`);
    err.code = reason === 'github_not_connected' ? 'GITHUB_NOT_CONNECTED' : 'INVITE_MISMATCH';
    throw err;
  }
  const result = await deps.projectInvites.accept({
    id: invite.id, userId: user.id, email: user.email || null, displayName: displayName(user), labels: picked,
  });
  if (!result) throw AppError.conflict('This invite was just used. Ask for a new one.');
  return { projectId: project.id, alreadyMember: result.alreadyMember };
}

async function setMyLabels({ project, user, labels }, deps = defaultDeps()) {
  await assertMember(project, user, deps);
  const picked = normalizeLabels(labels, deps.memberLabels);
  await ensureOwnerMember(project, user, deps);
  const row = await deps.projectMembers.setLabels(project.id, user.id, picked);
  if (!row) throw AppError.notFound('You\'re not a member of this project.');
  return publicMember(row, { ownerId: project.user_id });
}

/** The owner removes a member, or a member leaves. The owner can't be removed. */
async function removeMember({ project, user, memberId }, deps = defaultDeps()) {
  await assertMember(project, user, deps);
  if (project.user_id && memberId === project.user_id) {
    throw AppError.badRequest('The project owner can\'t be removed.');
  }
  if (!isOwner(project, user) && memberId !== user.id) {
    throw AppError.forbidden('Only the project owner can remove other members.');
  }
  const removed = await deps.projectMembers.remove(project.id, memberId);
  if (!removed) throw AppError.notFound('Member not found');
  return { removed: true };
}

module.exports = {
  getTeam,
  createInvite,
  revokeInvite,
  previewInvite,
  requestSignInLink,
  acceptInvite,
  setMyLabels,
  removeMember,
  ensureOwnerMember,
  parseInviteTarget,
  normalizeLabels,
  maskEmail,
  hashToken,
  newToken,
  appUrlFromEnv,
  signInRedirect,
  defaultDeps,
  INVITE_TTL_DAYS,
};
