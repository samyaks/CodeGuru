'use strict';

// Test-only in-memory stores and a fake GitHub repo for the agreement tests
// (services/agreements/agreements.test.js, routes/agreements.test.js).

const svc = require('./index');

const T0 = new Date('2026-11-25T12:00:00Z');
const HOUR = 60 * 60 * 1000;

const YAML_V2 = `# Keep this comment.
version: 2
product:
  name: Acme
  summary: "A web app."
areas:
  - id: billing
    name: Billing
    paths: ["src/billing/**"]
    creators: ["sam@acme.test"]
agreements: []
`;

function fakeRepo({ protectedBranch = false, moveTimes = 0 } = {}) {
  const repo = {
    files: { 'takeoff.yaml': YAML_V2 },
    head: 'c0',
    commits: { c0: { tree: 't0', files: null } },
    trees: {},
    refs: {},
    pulls: [],
    moves: moveTimes,
    log: [],
    collaborators: new Map([['samgh', 'write'], ['olivegh', 'read']]),
    links: new Set(), // paths that are symlinks
    rulesError: null, // message of a 422 the branch update gets (rulesets)
  };
  let n = 0;
  const gh = {
    async fetchRepoMeta() { return { default_branch: 'main' }; },
    async fetchBranch() { return { commit: { sha: repo.head }, protected: protectedBranch }; },
    async fetchFileTextOrNull(_o, _r, path) { return Object.prototype.hasOwnProperty.call(repo.files, path) ? repo.files[path] : null; },
    async fetchGitCommit(_o, _r, sha) { return { sha, tree: { sha: 'tree:' } }; },
    async fetchTreeEntries(_o, _r, sha) {
      const prefix = sha.slice('tree:'.length);
      const seen = new Map();
      for (const p of [...Object.keys(repo.files), ...repo.links]) {
        if (!p.startsWith(prefix)) continue;
        const [head, ...rest] = p.slice(prefix.length).split('/');
        if (rest.length) seen.set(head, { path: head, type: 'tree', mode: '040000', sha: `tree:${prefix}${head}/` });
        else seen.set(head, repo.links.has(p) ? { path: head, type: 'blob', mode: '120000', sha: 'x' } : { path: head, type: 'blob', mode: '100644', sha: 'x', size: repo.files[p].length });
      }
      return [...seen.values()];
    },
    async createTextTree(_o, _r, baseTree, files) { const sha = `t${++n}`; repo.trees[sha] = { baseTree, files }; return { sha }; },
    async createGitCommit(_o, _r, { message, tree, parents }) { const sha = `c${++n}`; repo.commits[sha] = { message, tree, parents }; return { sha }; },
    async updateBranchRef(_o, _r, branch, sha, { force } = {}) {
      if (branch === 'main') {
        if (repo.rulesError) { const e = new Error(repo.rulesError); e.status = 422; throw e; }
        if (repo.moves > 0) { repo.moves -= 1; const e = new Error('Update is not a fast forward'); e.status = 422; throw e; }
        repo.head = sha;
        for (const f of repo.trees[repo.commits[sha].tree].files) repo.files[f.path] = f.content;
        repo.log.push(repo.commits[sha].message);
        return {};
      }
      repo.refs[branch] = { sha, force: !!force };
      return {};
    },
    async createBranchRef(_o, _r, branch, sha) {
      if (repo.refs[branch]) { const e = new Error('Reference already exists'); e.status = 422; throw e; }
      repo.refs[branch] = { sha };
    },
    async findOpenPullByHead(_o, _r, head) { return repo.pulls.find((p) => p.head === head) || null; },
    async createPullRequest(_o, _r, { title, head, base, body }) {
      const pr = { title, head, base, body, html_url: `https://github.com/acme/web/pull/${repo.pulls.length + 1}` };
      repo.pulls.push(pr);
      return pr;
    },
    async fetchCollaboratorPermission(_o, _r, login) {
      const permission = repo.collaborators.get(String(login).toLowerCase()) || 'none';
      return { permission, canPush: ['write', 'admin', 'maintain'].includes(permission), githubUserId: null };
    },
  };
  return { repo, gh };
}

function setup({ repoOpts, emailEnabled = true, members = ['owner', 'olive'] } = {}) {
  const project = { id: 'p1', user_id: 'owner', owner: 'acme', repo: 'web', github_installation_id: 77 };
  const { repo, gh } = fakeRepo(repoOpts);
  const state = { agreements: [], votes: [], outbox: [], recs: [], now: T0 };
  const people = {
    owner: { id: 'owner', email: 'sam@acme.test', email_confirmed_at: T0.toISOString(), user_metadata: { full_name: 'Sam' } },
    olive: { id: 'olive', email: 'olive@acme.test', email_confirmed_at: T0.toISOString(), user_metadata: { full_name: 'Olive' } },
    rex: { id: 'rex', email: 'rex@acme.test', email_confirmed_at: T0.toISOString(), user_metadata: { full_name: 'Rex' } },
  };
  const memberRows = members.map((id) => ({ project_id: 'p1', user_id: id, email: people[id].email, display_name: people[id].user_metadata.full_name }));
  const links = new Map([
    ['owner', { github_login: 'samgh', github_user_id: 11 }],
    ['olive', { github_login: 'olivegh', github_user_id: 12 }],
  ]);
  const iso = () => state.now.toISOString();
  const agreements = {
    async create({ id, projectId, areaId, text, source, proposedBy, proposedByName }) {
      const row = { id, project_id: projectId, area_id: areaId, text, source, status: 'proposed', proposed_by: proposedBy, proposed_by_name: proposedByName, proposed_at: iso(), commit_state: 'none' };
      state.agreements.push(row); return row;
    },
    async get(pid, id) { return state.agreements.find((a) => a.project_id === pid && a.id === id) || null; },
    async getById(id) { return state.agreements.find((a) => a.id === id) || null; },
    async list(pid) { return state.agreements.filter((a) => a.project_id === pid); },
    async decide(pid, id, { status, decidedBy, via, note = null, agreedByEmails = null }) {
      const a = state.agreements.find((x) => x.project_id === pid && x.id === id && x.status === 'proposed'); if (!a) return null;
      Object.assign(a, { status, decided_by: decidedBy, decided_at: iso(), decided_via: via, decision_note: note, agreed_by_emails: agreedByEmails }); return a;
    },
    async claimCommit(pid, id) {
      const stale = (x) => x.commit_state === 'committing' && state.now - new Date(x.commit_attempted_at) >= 10 * 60 * 1000;
      const a = state.agreements.find((x) => x.project_id === pid && x.id === id && x.status === 'accepted' && (['none', 'waiting_for_write', 'failed'].includes(x.commit_state) || stale(x))); if (!a) return null;
      a.commit_state = 'committing'; a.commit_error = null; a.commit_attempted_at = iso(); return a;
    },
    async setAgreedBy(pid, id, emails) { const a = state.agreements.find((x) => x.project_id === pid && x.id === id && x.status === 'accepted'); if (!a) return null; a.agreed_by_emails = emails; return a; },
    async setCommit(id, { state: s, sha = null, url = null, prUrl = null, error = null, recommendationId = null, from = null, claimedAt = null }) {
      const a = state.agreements.find((x) => x.id === id && (!from || from.includes(x.commit_state))
        && (!claimedAt || new Date(x.commit_attempted_at).getTime() === new Date(claimedAt).getTime())); if (!a) return null;
      Object.assign(a, { commit_state: s, commit_sha: sha ?? a.commit_sha, commit_url: url ?? a.commit_url, commit_pr_url: prUrl ?? a.commit_pr_url, commit_error: error, recommendation_id: recommendationId ?? a.recommendation_id }); return a;
    },
  };
  const agreementVotes = {
    async upsert(aid, uid, { vote, comment = null }) {
      let v = state.votes.find((x) => x.agreement_id === aid && x.user_id === uid);
      if (!v) { v = { agreement_id: aid, user_id: uid }; state.votes.push(v); }
      Object.assign(v, { vote, comment, voted_at: iso() }); return v;
    },
    async listFor(ids) { return state.votes.filter((v) => ids.includes(v.agreement_id)); },
  };
  const notificationOutbox = {
    async enqueue({ id, projectId, userId, email, kind, subject, body, link, dedupeKey = null }) {
      if (dedupeKey && state.outbox.some((o) => o.dedupe_key === dedupeKey)) return false;
      state.outbox.push({ id, project_id: projectId, recipient_user_id: userId, recipient_email: email, kind, subject, body, link, created_at: iso(), sent_at: null, digest_id: null, dedupe_key: dedupeKey, claimed: false });
      return true;
    },
    async pendingRecipients() {
      const hourAgo = new Date(state.now.getTime() - 60 * 60 * 1000).toISOString();
      const throttled = new Set(state.outbox.filter((o) => o.digest_id && o.sent_at >= hourAgo).map((o) => o.recipient_email));
      return [...new Set(state.outbox.filter((o) => !o.sent_at && !throttled.has(o.recipient_email)).map((o) => o.recipient_email))];
    },
    async claimUnsent(email) {
      const rows = state.outbox.filter((o) => o.recipient_email === email && !o.sent_at && !o.claimed);
      for (const o of rows) o.claimed = true;
      return rows;
    },
    async releaseClaims(ids) { for (const o of state.outbox) if (ids.includes(o.id)) o.claimed = false; },
    async sentSince(email, since) {
      const sent = state.outbox.filter((o) => o.recipient_email === email && o.sent_at && o.sent_at >= since);
      return { singles: sent.filter((o) => !o.digest_id).length, digests: new Set(sent.filter((o) => o.digest_id).map((o) => o.digest_id)).size };
    },
    async markSent(ids, digestId = null) { for (const o of state.outbox) if (ids.includes(o.id) && !o.sent_at) Object.assign(o, { sent_at: iso(), digest_id: digestId }); },
    async markFailed(ids) { for (const o of state.outbox) if (ids.includes(o.id)) o.claimed = false; },
  };
  const recommendations = {
    async create({ id, projectId, actionType, payload, summary, createdBy }) { const r = { id, project_id: projectId, action_type: actionType, payload, summary, created_by: createdBy, status: 'pending' }; state.recs.push(r); return r; },
    async get(pid, id) { return state.recs.find((r) => r.project_id === pid && r.id === id) || null; },
    async listPending(pid) { return state.recs.filter((r) => r.project_id === pid && ['pending', 'confirming'].includes(r.status)); },
    async dismiss(pid, id, uid) { const r = state.recs.find((x) => x.id === id && x.status === 'pending'); if (!r) return null; r.status = 'dismissed'; r.decided_by = uid; return r; },
    async claimForConfirm(pid, id, uid) { const r = state.recs.find((x) => x.id === id && x.status === 'pending'); if (!r) return null; r.status = 'confirming'; r.decided_by = uid; return r; },
    async finish(id, { status }) { const r = state.recs.find((x) => x.id === id); r.status = status; return r; },
    async release(id) { const r = state.recs.find((x) => x.id === id); r.status = 'pending'; return r; },
  };
  let n = 0;
  const intentAreas = [{ id: 'billing', name: 'Billing', creators: ['sam@acme.test'] }];
  const committingDeps = {
    recommendations,
    userGithubLinks: { async get(uid) { return links.get(uid) || null; } },
    clientForInstallation: () => gh,
    newId: () => `rec${++n}`,
  };
  const deps = {
    agreements, agreementVotes, notificationOutbox,
    projectMembers: {
      async list() { return memberRows; },
      async get(_p, uid) { return memberRows.find((m) => m.user_id === uid) || null; },
      async ensure(_p, uid) { return memberRows.find((m) => m.user_id === uid); },
    },
    userGithubLinks: committingDeps.userGithubLinks,
    emailEnabled,
    readIntent: async () => ({ ok: true, reason: null, branch: 'main', areas: intentAreas }),
    writeClientFor: () => gh,
    committing: committingDeps,
    onCommitted: async () => {},
    appUrl: 'https://takeoff.test',
    now: () => state.now,
    random: () => `r${++n}`,
  };
  svc._resetRegistration();
  svc.registerCommitAction(() => deps);
  return { project, repo, state, deps, people, memberRows, links, committingDeps };
}

module.exports = { setup, fakeRepo, T0, HOUR, YAML_V2 };
