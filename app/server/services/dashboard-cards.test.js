const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  extractNutshell,
  extractWhatsNotBuilt,
  firstParagraph,
  buildAppSummary,
  missingFromReadiness,
  pickMissing,
  pickLastCommit,
  toCommitSnapshot,
  shapePersonas,
  buildDashboardCard,
  fetchOpenPullCount,
} = require('./dashboard-cards');

const FEATURES = `## In a nutshell
Helps vibe coders finish the last 40% of AI-built apps.

## What can you do with it?
Analyze a repo and see what's missing.

## What's not built yet?
- No login yet
- Email delivery is missing
- Can't take payments
`;

test('extractNutshell reads the In a nutshell section', () => {
  assert.equal(
    extractNutshell(FEATURES),
    'Helps vibe coders finish the last 40% of AI-built apps.'
  );
});

test('extractNutshell falls back to the first paragraph', () => {
  assert.equal(
    extractNutshell('A short note about the product.\n\nMore detail later.'),
    'A short note about the product.'
  );
});

test('extractWhatsNotBuilt returns the first missing bullets', () => {
  assert.deepEqual(extractWhatsNotBuilt(FEATURES), [
    'No login yet',
    'Email delivery is missing',
    "Can't take payments",
  ]);
});

test('firstParagraph strips markdown and truncates', () => {
  const long = 'x'.repeat(400);
  const out = firstParagraph(`## Title\n**${long}**`);
  assert.ok(out.endsWith('…'));
  assert.ok(out.length <= 320);
});

test('buildAppSummary prefers the Read objective over the nutshell', () => {
  const summary = buildAppSummary(
    { features_summary: FEATURES, description: 'repo desc' },
    [{ slot: 'objective', text: 'Show founders what their app still needs.' }]
  );
  assert.equal(summary, 'Show founders what their app still needs.');
});

test('buildAppSummary falls back to nutshell then description', () => {
  assert.equal(
    buildAppSummary({ features_summary: FEATURES, description: 'repo desc' }, []),
    'Helps vibe coders finish the last 40% of AI-built apps.'
  );
  assert.equal(
    buildAppSummary({ features_summary: null, description: 'GitHub repo desc' }, []),
    'GitHub repo desc'
  );
});

test('missingFromReadiness lists missing categories before partial ones', () => {
  const items = missingFromReadiness({
    auth: { status: 'partial', label: 'Auth', detail: 'Login is half-built' },
    deploy: { status: 'missing', label: 'Deploy', detail: 'No hosting yet' },
    db: { status: 'ready', label: 'Database', detail: 'Postgres is wired up' },
  });
  assert.equal(items[0].title, 'No hosting yet');
  assert.equal(items[0].category, 'infra');
  assert.equal(items[1].title, 'Login is half-built');
});

test('pickMissing prefers open gaps over summary bullets', () => {
  const items = pickMissing({
    gapRows: [{
      id: 'gap-1',
      title: 'Add user login',
      type: 'feature',
      category: 'auth',
      priority: 'high',
      v2_status: 'untriaged',
    }],
    featuresSummary: FEATURES,
    readinessCategories: null,
  });
  assert.equal(items[0].id, 'gap-1');
  assert.equal(items[0].title, 'Add user login');
});

test('pickLastCommit keeps the newest dated snapshot', () => {
  const older = toCommitSnapshot({
    sha: 'aaaaaaaaaaaaaaaa',
    title: 'old',
    date: '2026-01-01T00:00:00Z',
  }, 'stored');
  const newer = toCommitSnapshot({
    sha: 'bbbbbbbbbbbbbbbb',
    title: 'new',
    date: '2026-09-01T00:00:00Z',
  }, 'github');
  assert.equal(pickLastCommit(older, newer).sha, 'bbbbbbbbbbbbbbbb');
  assert.equal(pickLastCommit(older, null).source, 'stored');
});

test('shapePersonas returns name, emoji, and clamped readiness', () => {
  const personas = shapePersonas({
    personas: [
      { id: 'p1', name: 'Founder', emoji: '👤', description: 'Ships the product' },
      { id: 'p2', name: 'User', emoji: '✨', description: 'Uses the product' },
    ],
    scores: { persona: { p1: 72.4, p2: 10 } },
  });
  assert.equal(personas[0].name, 'Founder');
  assert.equal(personas[0].readiness, 72);
  assert.equal(personas.length, 2);
});

test('buildDashboardCard emits the lean card shape', () => {
  const card = buildDashboardCard({
    id: 'proj-1',
    owner: 'acme',
    repo: 'widgets',
    status: 'ready',
    readiness_score: 64,
    framework: 'React',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-08T00:00:00Z',
    suggestions_count: 5,
    description: 'Widgets for everyone',
    features_summary: FEATURES,
  }, {
    claims: [
      { slot: 'objective', text: 'Help teams ship widgets.' },
      { slot: 'audience', text: 'Founders who build with AI.' },
    ],
    personas: [{ id: 'p1', name: 'Founder', emoji: '👤', description: 'Ships the product', readiness: 72 }],
    missingItems: [{ id: 'g1', title: 'No login yet', category: 'infra' }],
    missingCount: 4,
    next: { title: 'Add login', why: 'Nobody can save work' },
    lastCommit: { sha: 'abc1234', shortSha: 'abc1234', title: 'fix env', date: '2026-09-08T12:00:00Z', source: 'github' },
  });

  assert.equal(card.owner, 'acme');
  assert.equal(card.app_summary, 'Help teams ship widgets.');
  assert.equal(card.audience, 'Founders who build with AI.');
  assert.equal(card.persona.name, 'Founder');
  assert.equal(card.missing.count, 4);
  assert.equal(card.missing.next.title, 'Add login');
  assert.equal(card.last_commit.shortSha, 'abc1234');
  assert.equal(card.features_summary, undefined);
  assert.equal(card.analysis_data, undefined);
});

const PROJECT = { owner: 'Acme', repo: 'Widgets', repo_url: 'https://github.com/Acme/Widgets' };
const pullsClient = (impl) => {
  const calls = [];
  return { calls, client: { fetchRepoPulls: async (...args) => { calls.push(args); return impl(); } } };
};

test('fetchOpenPullCount counts open pulls and flags a full page as capped', async () => {
  const two = pullsClient(() => [{}, {}]);
  assert.deepEqual(await fetchOpenPullCount(PROJECT, { client: two.client, cache: new Map() }), { count: 2, capped: false });
  assert.deepEqual(two.calls[0], ['Acme', 'Widgets', { state: 'open', perPage: 100 }]);

  const none = pullsClient(() => []);
  assert.deepEqual(await fetchOpenPullCount(PROJECT, { client: none.client, cache: new Map() }), { count: 0, capped: false });

  const full = pullsClient(() => Array(100).fill({}));
  assert.deepEqual(await fetchOpenPullCount(PROJECT, { client: full.client, cache: new Map() }), { count: 100, capped: true });
});

test('fetchOpenPullCount is unknown, not zero, when GitHub fails or the project is an upload', async () => {
  const broken = pullsClient(() => { throw new Error('rate limited'); });
  assert.equal(await fetchOpenPullCount(PROJECT, { client: broken.client, cache: new Map() }), null);

  const upload = pullsClient(() => []);
  assert.equal(await fetchOpenPullCount({ ...PROJECT, repo_url: 'local://x' }, { client: upload.client }), null);
  assert.equal(upload.calls.length, 0);
});

test('fetchOpenPullCount reuses a count until it expires, per repo regardless of case', async () => {
  let clock = 0;
  const cache = new Map();
  const gh = pullsClient(() => [{}]);
  const opts = { client: gh.client, cache, now: () => clock };
  await fetchOpenPullCount(PROJECT, opts);
  await fetchOpenPullCount({ ...PROJECT, owner: 'acme', repo: 'widgets' }, opts);
  assert.equal(gh.calls.length, 1);
  clock = 5 * 60 * 1000 + 1;
  await fetchOpenPullCount(PROJECT, opts);
  assert.equal(gh.calls.length, 2);
});

test('fetchOpenPullCount reads through the project’s own GitHub client by default', async (t) => {
  const urls = [];
  const realFetch = global.fetch;
  t.after(() => { global.fetch = realFetch; });
  global.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => [{}] };
  };
  assert.deepEqual(await fetchOpenPullCount(PROJECT, { cache: new Map() }), { count: 1, capped: false });
  // The project client may check the repo's visibility first.
  assert.ok(urls.some((u) => /\/repos\/Acme\/Widgets\/pulls\?state=open/.test(u)), urls.join(' '));
});

test('fetchOpenPullCount does not share a cached count across GitHub identities', async () => {
  const cache = new Map();
  const gh = pullsClient(() => [{}]);
  await fetchOpenPullCount({ ...PROJECT, github_installation_id: 7 }, { client: gh.client, cache });
  await fetchOpenPullCount(PROJECT, { client: gh.client, cache });
  assert.equal(gh.calls.length, 2);
});
