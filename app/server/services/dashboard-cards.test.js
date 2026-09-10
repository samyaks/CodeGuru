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
