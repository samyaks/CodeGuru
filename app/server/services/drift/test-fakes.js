'use strict';

// Test-only in-memory stores and a fake GitHub repo with one open pull
// request, for the drift tests (services/drift/drift.test.js,
// routes/drift.test.js).

const svc = require('./index');

const T0 = new Date('2026-11-26T12:00:00Z');

const BASE_YAML = `# Keep this comment.
version: 2
product:
  name: Acme
  summary: "A web app."
areas:
  - id: billing
    name: Billing
    paths: ["src/billing/**"]
    creators: ["sam@acme.test"]
    rules:
      - "Stripe holds all billing data."
    never:
      - "Charge before the trial ends."
agreements: []
`;

const DRIFT_RESULT = {
  verdict: 'drifts',
  summary: 'The PR charges at signup, before the trial ends.',
  conflicts: [{
    area: 'billing', rule_or_agreement: 'Charge before the trial ends.',
    explanation: 'signup() now calls charge() right away.', files: ['src/billing/signup.js'],
  }],
  suggested_agreement: null,
  render: { areaNames: { billing: 'Billing' }, notes: [] },
};

function fakeGithub({ headFiles = {}, fork = false } = {}) {
  const gh = {
    commits: {
      b0b0b0b0: { files: { 'takeoff.yaml': BASE_YAML }, parents: [] },
      a1a1a1a1: { files: { 'takeoff.yaml': BASE_YAML, 'src/billing/signup.js': 'charge();\n', ...headFiles }, parents: ['b0b0b0b0'] },
    },
    branches: { main: 'b0b0b0b0', 'feat/charge': 'a1a1a1a1' },
    pr: { number: 7, title: 'Charge at signup', state: 'open', merged_at: null, user: { login: 'olivegh' } },
    fork,
    comments: [],
    trees: {},
    collaborators: new Map([['samgh', 'write'], ['olivegh', 'read']]),
    pushesBeforeUpdate: 0, // others pushing to the PR branch just before Takeoff
    failComment: null,
    calls: [],
  };
  let n = 0;
  const filesOf = (sha) => {
    if (!gh.commits[sha]) { const e = new Error('Not Found'); e.status = 404; throw e; }
    return gh.commits[sha].files;
  };
  const client = {
    async fetchPullRequest(_o, _r, number) {
      gh.calls.push(['fetchPullRequest', number]);
      if (Number(number) !== gh.pr.number) { const e = new Error('Not Found'); e.status = 404; throw e; }
      return {
        ...gh.pr,
        html_url: `https://github.com/acme/web/pull/${gh.pr.number}`,
        head: { ref: 'feat/charge', sha: gh.branches['feat/charge'], repo: { full_name: gh.fork ? 'someone/web' : 'acme/web' } },
        base: { ref: 'main', sha: gh.branches.main },
      };
    },
    async fetchFileTextOrNull(_o, _r, path, ref) {
      const files = filesOf(ref);
      return Object.prototype.hasOwnProperty.call(files, path) ? files[path] : null;
    },
    async fetchGitCommit(_o, _r, sha) { filesOf(sha); return { sha, tree: { sha: `tree:${sha}:` } }; },
    async fetchTreeEntries(_o, _r, treeSha) {
      const [, sha, prefix] = treeSha.split(':');
      const seen = new Map();
      for (const [p, text] of Object.entries(filesOf(sha))) {
        if (!p.startsWith(prefix)) continue;
        const [head, ...rest] = p.slice(prefix.length).split('/');
        if (rest.length) seen.set(head, { path: head, type: 'tree', mode: '040000', sha: `tree:${sha}:${prefix}${head}/` });
        else seen.set(head, { path: head, type: 'blob', mode: '100644', sha: 'x', size: text.length });
      }
      return [...seen.values()];
    },
    async createTextTree(_o, _r, baseTree, files) {
      const sha = `T${++n}`;
      gh.trees[sha] = { from: baseTree.split(':')[1], files };
      return { sha };
    },
    async createGitCommit(_o, _r, { message, tree, parents }) {
      const sha = `c0ffee${(++n).toString(16).padStart(2, '0')}`;
      const t = gh.trees[tree];
      const files = { ...gh.commits[t.from].files };
      for (const f of t.files) files[f.path] = f.content;
      gh.commits[sha] = { files, message, parents };
      return { sha };
    },
    async updateBranchRef(_o, _r, branch, sha, { force } = {}) {
      gh.calls.push(['updateBranchRef', branch, sha, !!force]);
      if (gh.onUpdateRef) await gh.onUpdateRef(sha);
      if (gh.pushesBeforeUpdate > 0) {
        gh.pushesBeforeUpdate -= 1;
        const pushed = `dead00${(++n).toString(16).padStart(2, '0')}`;
        gh.commits[pushed] = { files: { ...gh.commits[gh.branches[branch]].files, 'README.md': `push ${n}\n` }, parents: [gh.branches[branch]] };
        gh.branches[branch] = pushed;
      }
      if (!force && gh.commits[sha].parents[0] !== gh.branches[branch]) {
        const e = new Error('Update is not a fast forward'); e.status = 422; throw e;
      }
      gh.branches[branch] = sha;
      return {};
    },
    async createIssueComment(_o, _r, number, body) {
      if (gh.failComment) { const e = new Error(gh.failComment); e.status = 403; throw e; }
      const c = { id: 900 + gh.comments.length, number, body, html_url: `https://github.com/acme/web/pull/${number}#issuecomment-${900 + gh.comments.length}` };
      gh.comments.push(c);
      return c;
    },
    async fetchCollaboratorPermission(_o, _r, login) {
      const permission = gh.collaborators.get(String(login).toLowerCase()) || 'none';
      return { permission, canPush: ['write', 'admin', 'maintain'].includes(permission), githubUserId: null };
    },
  };
  return { gh, client };
}

function setup({ ghOpts, emailEnabled = true, members = ['owner', 'olive'], result = DRIFT_RESULT } = {}) {
  const project = { id: 'p1', user_id: 'owner', owner: 'acme', repo: 'web', github_installation_id: 77 };
  const { gh, client } = fakeGithub(ghOpts);
  const state = { checks: [], decisions: [], recs: [], outbox: [], rechecks: [], now: T0 };
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
  state.checks.push({
    project_id: 'p1', repo_full_name: 'acme/web', pr_number: 7, head_sha: 'a1a1a1a1', status: 'done', verdict: result.verdict,
    result_json: result, completed_at: iso(), updated_at: iso(), pr_closed_at: null,
  });
  const latest = (repo, pr) => state.checks.filter((c) => c.repo_full_name === repo && Number(c.pr_number) === Number(pr)).at(-1) || null;
  const prChecks = {
    async latestForPr({ repo, prNumber, projectId = null }) {
      const row = latest(repo, prNumber);
      return row && (!projectId || row.project_id === projectId) ? row : null;
    },
    async latestPerPr(pid, repo) {
      const prs = [...new Set(state.checks.filter((c) => c.project_id === pid && c.repo_full_name === repo).map((c) => Number(c.pr_number)))];
      return prs.map((p) => latest(repo, p));
    },
  };
  const isWorking = (repo, pr) => state.decisions.some((d) => d.repo_full_name === repo && Number(d.pr_number) === Number(pr) && d.state === 'working');
  const driftDecisions = {
    async create({ id, projectId, repo, prNumber, headSha, branch, type, note = null, edits = null, actorUserId, actorName = null }) {
      if (isWorking(repo, prNumber)) return null;
      const row = {
        id, project_id: projectId, repo_full_name: repo, pr_number: prNumber, head_sha: headSha, branch, type, state: 'working',
        note, edits: edits ? JSON.parse(JSON.stringify(edits)) : null, actor_user_id: actorUserId, actor_name: actorName, created_at: iso(), updated_at: iso(),
      };
      state.decisions.unshift(row);
      return { ...row };
    },
    async get(pid, id) { const d = state.decisions.find((x) => x.project_id === pid && x.id === id); return d ? { ...d } : null; },
    async listForPr(pid, repo, pr) { return state.decisions.filter((d) => d.project_id === pid && d.repo_full_name === repo && Number(d.pr_number) === Number(pr)).map((d) => ({ ...d })); },
    async listRecent(pid) { return state.decisions.filter((d) => d.project_id === pid).map((d) => ({ ...d })); },
    async claim(pid, id, { from, confirmedBy = null }) {
      const d = state.decisions.find((x) => x.project_id === pid && x.id === id && from.includes(x.state));
      if (!d || isWorking(d.repo_full_name, d.pr_number)) return null;
      Object.assign(d, { state: 'working', error: null, confirmed_by: confirmedBy ?? d.confirmed_by ?? null, updated_at: iso() });
      return { ...d };
    },
    async finish(id, f) {
      const d = state.decisions.find((x) => x.id === id && x.state === 'working');
      if (!d) return null;
      const keep = (k, v) => (v === null || v === undefined ? d[k] : v);
      Object.assign(d, {
        state: f.state, commit_sha: keep('commit_sha', f.commitSha), commit_url: keep('commit_url', f.commitUrl),
        yaml_sha256: keep('yaml_sha256', f.yamlSha256), base_yaml_sha256: keep('base_yaml_sha256', f.baseYamlSha256),
        comment_id: keep('comment_id', f.commentId), comment_url: keep('comment_url', f.commentUrl),
        agreement_id: keep('agreement_id', f.agreementId), recommendation_id: keep('recommendation_id', f.recommendationId),
        error: f.error ?? null, updated_at: iso(), done_at: f.state === 'done' ? iso() : d.done_at,
      });
      return { ...d };
    },
    async recordPlan(id, { yamlSha256, baseYamlSha256 }) {
      const d = state.decisions.find((x) => x.id === id && x.state === 'working' && x.type === 'accepted');
      if (d) Object.assign(d, { yaml_sha256: yamlSha256, base_yaml_sha256: baseYamlSha256 });
      state.planned = state.planned || [];
      state.planned.push({ id, yamlSha256, baseYamlSha256 });
    },
    async acceptedFor({ projectId, repo, prNumber, yamlSha256, baseYamlSha256 }) {
      return state.decisions.find((d) => d.project_id === projectId && d.repo_full_name === repo && Number(d.pr_number) === Number(prNumber) && d.type === 'accepted'
        && ['done', 'working'].includes(d.state) && d.yaml_sha256 === yamlSha256 && d.base_yaml_sha256 === baseYamlSha256) || null;
    },
  };
  const recommendations = {
    async create({ id, projectId, actionType, payload, summary, createdBy }) { const r = { id, project_id: projectId, action_type: actionType, payload, summary, created_by: createdBy, status: 'pending' }; state.recs.push(r); return r; },
    async get(pid, id) { return state.recs.find((r) => r.project_id === pid && r.id === id) || null; },
    async listPending(pid) { return state.recs.filter((r) => r.project_id === pid && ['pending', 'confirming'].includes(r.status)); },
    async dismiss(pid, id, uid) { const r = state.recs.find((x) => x.id === id && x.status === 'pending'); if (!r) return null; r.status = 'dismissed'; r.decided_by = uid; return r; },
    async claimForConfirm(pid, id, uid) { const r = state.recs.find((x) => x.id === id && x.status === 'pending'); if (!r) return null; r.status = 'confirming'; r.decided_by = uid; return r; },
    async finish(id, { status }) { const r = state.recs.find((x) => x.id === id); r.status = status; return r; },
    async release(id, error) { const r = state.recs.find((x) => x.id === id); r.status = 'pending'; r.error = error; return r; },
  };
  const notificationOutbox = {
    async enqueue({ id, projectId, userId, email, kind, subject, body, link, dedupeKey = null }) {
      if (dedupeKey && state.outbox.some((o) => o.dedupe_key === dedupeKey)) return false;
      state.outbox.push({ id, project_id: projectId, recipient_user_id: userId, recipient_email: email, kind, subject, body, link, dedupe_key: dedupeKey });
      return true;
    },
  };
  let n = 0;
  const userGithubLinks = { async get(uid) { return links.get(uid) || null; } };
  const committingDeps = {
    recommendations,
    userGithubLinks,
    clientForInstallation: () => client,
    newId: () => `rec${++n}`,
  };
  const deps = {
    prChecks,
    driftDecisions,
    recommendations,
    notificationOutbox,
    userGithubLinks,
    projectMembers: {
      async list() { return memberRows; },
      async get(_p, uid) { return memberRows.find((m) => m.user_id === uid) || null; },
      async ensure(_p, uid) { return memberRows.find((m) => m.user_id === uid); },
    },
    emailEnabled,
    readClientFor: () => client,
    writeClientFor: () => client,
    committing: committingDeps,
    runPrCheck: async (job) => { state.rechecks.push(job); },
    appUrl: 'https://takeoff.test',
    now: () => state.now,
    newId: () => `dec_${++n}`,
    random: () => `r${++n}`,
  };
  svc._resetRegistration();
  svc.registerDecisionAction(() => deps);
  return { project, gh, client, state, deps, people, memberRows, links };
}

module.exports = { setup, fakeGithub, T0, BASE_YAML, DRIFT_RESULT };
