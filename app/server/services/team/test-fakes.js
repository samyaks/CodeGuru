'use strict';

// Test-only in-memory stand-ins for the db.js team stores, with the same
// guards as the SQL. Used by team.test.js and routes/team.test.js.

const LABELS = ['creator', 'builder'];
const NOW = new Date('2026-11-25T12:00:00Z');

// In-memory stand-ins for the db.js stores, with the same guards as the SQL.
function fakeDb() {
  const state = { members: [], invites: [], recs: [], links: new Map(), sent: [] };
  let n = 0;
  const projectMembers = {
    async projectIdsForUser(uid) { return state.members.filter((m) => m.user_id === uid).map((m) => m.project_id); },
    async list(pid) { return state.members.filter((m) => m.project_id === pid); },
    async get(pid, uid) { return state.members.find((m) => m.project_id === pid && m.user_id === uid) || null; },
    async ensure(pid, uid, { email = null, displayName = null, labels = [] } = {}) {
      let row = await projectMembers.get(pid, uid);
      if (!row) { row = { project_id: pid, user_id: uid, email, display_name: displayName, labels, joined_at: NOW.toISOString() }; state.members.push(row); }
      row.email = email ?? row.email; row.display_name = displayName ?? row.display_name;
      return row;
    },
    async setLabels(pid, uid, labels) { const row = await projectMembers.get(pid, uid); if (!row) return null; row.labels = labels; return row; },
    async remove(pid, uid) { const before = state.members.length; state.members = state.members.filter((m) => !(m.project_id === pid && m.user_id === uid)); return state.members.length < before; },
  };
  const isOpen = (i) => !i.accepted_at && !i.revoked_at;
  const projectInvites = {
    async create({ id, projectId, email, githubLogin, tokenHash, invitedBy, invitedByName, expiresAt }) {
      const clash = state.invites.find((i) => i.project_id === projectId && isOpen(i)
        && ((email && i.email === email) || (githubLogin && i.github_login?.toLowerCase() === githubLogin.toLowerCase())));
      if (clash) return null;
      const row = { id, project_id: projectId, email, github_login: githubLogin, token_hash: tokenHash, invited_by: invitedBy, invited_by_name: invitedByName, expires_at: expiresAt, created_at: NOW.toISOString(), accepted_at: null, revoked_at: null, last_link_sent_at: null };
      state.invites.push(row); return row;
    },
    async findOpen(pid, { email, githubLogin }) {
      return state.invites.find((i) => i.project_id === pid && isOpen(i)
        && ((email && i.email?.toLowerCase() === email.toLowerCase()) || (githubLogin && i.github_login?.toLowerCase() === githubLogin.toLowerCase()))) || null;
    },
    async rotateToken(id, tokenHash, expiresAt, { invitedBy, invitedByName } = {}) {
      const row = state.invites.find((i) => i.id === id && isOpen(i)); if (!row) return null;
      Object.assign(row, { token_hash: tokenHash, expires_at: expiresAt, invited_by: invitedBy ?? row.invited_by, invited_by_name: invitedByName ?? row.invited_by_name });
      return row;
    },
    async findByTokenHash(h) { return state.invites.find((i) => i.token_hash === h) || null; },
    async listOpen(pid) { return state.invites.filter((i) => i.project_id === pid && isOpen(i) && new Date(i.expires_at) > NOW); },
    async revoke(pid, id) { const row = state.invites.find((i) => i.project_id === pid && i.id === id && isOpen(i)); if (!row) return false; row.revoked_at = NOW.toISOString(); return true; },
    async markLinkSent(id, minSeconds) {
      const row = state.invites.find((i) => i.id === id);
      if (row.last_link_sent_at && NOW - new Date(row.last_link_sent_at) < minSeconds * 1000) return false;
      row.last_link_sent_at = NOW.toISOString(); return true;
    },
    async accept({ id, userId, email, displayName, labels }) {
      const inv = state.invites.find((i) => i.id === id && isOpen(i) && new Date(i.expires_at) > NOW);
      if (!inv) return null;
      inv.accepted_at = NOW.toISOString(); inv.accepted_by = userId;
      const existing = await projectMembers.get(inv.project_id, userId);
      if (existing) return { member: existing, alreadyMember: true };
      const row = { project_id: inv.project_id, user_id: userId, email, display_name: displayName, labels, invited_by: inv.invited_by, joined_at: NOW.toISOString() };
      state.members.push(row); return { member: row, alreadyMember: false };
    },
  };
  const recommendations = {
    async create({ id, projectId, actionType, payload, summary, createdBy }) {
      const row = { id, project_id: projectId, action_type: actionType, payload, summary, created_by: createdBy, status: 'pending', created_at: NOW.toISOString() };
      state.recs.push(row); return row;
    },
    async get(pid, id) { return state.recs.find((r) => r.project_id === pid && r.id === id) || null; },
    async listPending(pid) { return state.recs.filter((r) => r.project_id === pid && ['pending', 'confirming'].includes(r.status)); },
    async claimForConfirm(pid, id, uid) {
      const r = state.recs.find((x) => x.project_id === pid && x.id === id && x.status === 'pending'); if (!r) return null;
      r.status = 'confirming'; r.decided_by = uid; return r;
    },
    async finish(id, { status, result, error }) {
      const r = state.recs.find((x) => x.id === id && x.status === 'confirming'); if (!r) return null;
      Object.assign(r, { status, result, error }); return r;
    },
    async dismiss(pid, id, uid) {
      const r = state.recs.find((x) => x.project_id === pid && x.id === id && x.status === 'pending'); if (!r) return null;
      r.status = 'dismissed'; r.decided_by = uid; return r;
    },
  };
  const userGithubLinks = {
    async get(uid) { return state.links.get(uid) || null; },
    async upsert(uid, l) { state.links.set(uid, { user_id: uid, github_user_id: l.githubUserId, github_login: l.githubLogin }); },
  };
  const project = { id: 'p1', user_id: 'owner', owner: 'acme', repo: 'web', github_installation_id: 77, created_at: '2026-11-01T00:00:00Z' };
  const deployments = { async findById(id) { return id === 'p1' ? project : null; } };
  const deps = {
    projectMembers, projectInvites, recommendations, userGithubLinks, deployments,
    memberLabels: LABELS,
    newId: () => `id${++n}`,
    now: () => NOW,
    appUrl: 'https://takeoff.test',
    sendSignInLink: async (email, redirectTo) => { state.sent.push({ email, redirectTo }); },
  };
  return { state, deps, project };
}

module.exports = { fakeDb, LABELS, NOW };
