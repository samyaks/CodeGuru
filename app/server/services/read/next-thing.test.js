const { test } = require('node:test');
const assert = require('node:assert');

// --- Mock the tracked Claude call BEFORE requiring the module under test ---
// (same approach as intent/bootstrap.test.js).

const trackedPath = require.resolve('../../lib/anthropic-tracked');

const captured = { calls: [] };
let responder = () => '{}';

require.cache[trackedPath] = {
  id: trackedPath,
  filename: trackedPath,
  loaded: true,
  exports: {
    async createMessageTracked({ client, analysisId, phase, params }) {
      captured.calls.push({ client, analysisId, phase, params });
      return { content: [{ type: 'text', text: responder() }] };
    },
    extractText(response) {
      const blocks = Array.isArray(response?.content) ? response.content : [];
      for (const b of blocks) {
        if (b && b.type === 'text' && typeof b.text === 'string') return b.text;
      }
      return typeof blocks[0]?.text === 'string' ? blocks[0].text : '';
    },
  },
};

const { deriveNextThing, pickNextCandidate, parseNextThing } = require('./next-thing');

function reset() {
  captured.calls = [];
  responder = () => '{}';
}

function readinessWith(overrides = {}) {
  const cat = (status, weight, label, detail = '') => ({ status, weight, label, detail, score: 0, earned: 0 });
  return {
    score: 50,
    categories: {
      frontend: cat('ready', 15, 'Frontend / UI'),
      backend: cat('ready', 15, 'Backend / API'),
      auth: cat('ready', 15, 'Authentication'),
      database: cat('ready', 15, 'Database'),
      errorHandling: cat('ready', 10, 'Error Handling'),
      envConfig: cat('ready', 10, 'Environment Config'),
      deployment: cat('ready', 10, 'Deployment'),
      testing: cat('ready', 10, 'Testing'),
      ...overrides,
    },
  };
}

const MULTI_USER_MAP = {
  domain: 'Habit tracking',
  personas: [
    { id: 'persona:0', name: 'Habit builder', emoji: '🌱', priority: 'high' },
    { id: 'persona:1', name: 'Accountability partner', emoji: '🤝', priority: 'medium' },
  ],
  jobs: [],
  entities: [],
  edges: [],
};

const SOLO_MAP = { ...MULTI_USER_MAP, personas: [MULTI_USER_MAP.personas[0]] };

// ── pickNextCandidate priority order (pure, no LLM) ────────────────

test('priority 1: missing auth on a multi-user read wins over everything', () => {
  const candidate = pickNextCandidate({
    projectId: 'p1',
    readiness: readinessWith({
      auth: { status: 'missing', weight: 15, label: 'Authentication', detail: 'No authentication system found' },
    }),
    gaps: [{ title: 'Add tests', category: 'testing' }],
    securityFindings: [{ detector: 'secrets', title: 'API key committed', file: '.env' }],
    stack: { framework: 'Express' },
    map: MULTI_USER_MAP,
  });
  assert.strictEqual(candidate.kind, 'auth_multi_user');
  assert.strictEqual(candidate.category, 'auth');
  assert.deepStrictEqual(candidate.detail.personas, ['Habit builder', 'Accountability partner']);
});

test('missing auth on a single-persona read does NOT trigger priority 1', () => {
  const candidate = pickNextCandidate({
    projectId: 'p1',
    readiness: readinessWith({
      auth: { status: 'missing', weight: 15, label: 'Authentication', detail: '' },
    }),
    gaps: [],
    securityFindings: [{ detector: 'secrets', title: 'API key committed', file: '.env' }],
    stack: null,
    map: SOLO_MAP,
  });
  assert.strictEqual(candidate.kind, 'security_finding');
  assert.strictEqual(candidate.category, 'security');
});

test('priority 2: security finding beats missing readiness categories and gaps', () => {
  const candidate = pickNextCandidate({
    projectId: 'p1',
    readiness: readinessWith({
      database: { status: 'missing', weight: 15, label: 'Database', detail: '' },
    }),
    gaps: [{ title: 'Add tests', category: 'testing' }],
    securityFindings: [{ detector: 'sql-injection', title: 'Unsanitized query', file: 'api/users.js' }],
    stack: null,
    map: SOLO_MAP,
  });
  assert.strictEqual(candidate.kind, 'security_finding');
  assert.strictEqual(candidate.detail.file, 'api/users.js');
});

test('priority 3: highest-weight missing readiness category', () => {
  const candidate = pickNextCandidate({
    projectId: 'p1',
    readiness: readinessWith({
      testing: { status: 'missing', weight: 10, label: 'Testing', detail: 'No test files found' },
      database: { status: 'missing', weight: 15, label: 'Database', detail: 'No database configuration found' },
    }),
    gaps: [{ title: 'Add tests', category: 'testing' }],
    securityFindings: [],
    stack: null,
    map: SOLO_MAP,
  });
  assert.strictEqual(candidate.kind, 'readiness_category');
  assert.strictEqual(candidate.category, 'database');
});

test('priority 4: top gap when readiness is clean', () => {
  const candidate = pickNextCandidate({
    projectId: 'p1',
    readiness: readinessWith(),
    gaps: [
      { title: 'Empty states missing on dashboard', category: 'ux', severity: 'medium' },
      { title: 'Add tests', category: 'testing' },
    ],
    securityFindings: [],
    stack: null,
    map: SOLO_MAP,
  });
  assert.strictEqual(candidate.kind, 'gap');
  assert.strictEqual(candidate.category, 'ux');
  assert.strictEqual(candidate.headline, 'Empty states missing on dashboard');
});

test('fallback: nothing missing at all still returns a candidate', () => {
  const candidate = pickNextCandidate({
    projectId: 'p1',
    readiness: readinessWith(),
    gaps: [],
    securityFindings: [],
    stack: null,
    map: SOLO_MAP,
  });
  assert.strictEqual(candidate.kind, 'polish');
  assert.strictEqual(candidate.category, 'general');
});

test('handles null readiness and missing arrays without throwing', () => {
  const candidate = pickNextCandidate({ projectId: 'p1', readiness: null, gaps: null, securityFindings: null, stack: null, map: null });
  assert.strictEqual(candidate.kind, 'polish');
});

// ── deriveNextThing (mocked LLM) ───────────────────────────────────

const GOOD_COPY = JSON.stringify({
  title: 'A way to tell its people apart.',
  why: 'You just said partners share streaks, so this is not only "add a login." Two people read the same rows.',
  prompt: 'Add Supabase Auth to Loop.\n1. Add magic-link sign-in.\n2. Add a partnerships table.\n3. Row-level security.',
});

const INPUTS = {
  projectId: 'proj-9',
  readiness: readinessWith({
    auth: { status: 'missing', weight: 15, label: 'Authentication', detail: 'No authentication system found' },
  }),
  gaps: [{ title: 'Add tests', category: 'testing' }],
  securityFindings: [],
  stack: { framework: 'Express', runtime: 'node', database: 'Supabase' },
  map: MULTI_USER_MAP,
};

const SETTLED = [
  { slot: 'objective', text: 'helps people build lasting habits', source: 'inferred' },
  { slot: 'audience', text: 'people keeping each other honest', source: 'human' },
  { slot: 'core_job', text: 'letting them log a habit in under ten seconds', source: 'inferred' },
];

test('deriveNextThing: one call, phase read.next, settled claims condition the request payload', async () => {
  reset();
  responder = () => GOOD_COPY;

  const result = await deriveNextThing(INPUTS, SETTLED);

  assert.strictEqual(captured.calls.length, 1);
  const call = captured.calls[0];
  assert.strictEqual(call.analysisId, 'proj-9');
  assert.strictEqual(call.phase, 'read.next');
  assert.strictEqual(call.params.system[0].cache_control.type, 'ephemeral');

  const content = call.params.messages[0].content;
  // The human correction is in the payload, marked as ground truth.
  assert.match(content, /people keeping each other honest/);
  assert.match(content, /CORRECTED BY THE PERSON/);
  // Drafted claims are there too, plus the actual stack.
  assert.match(content, /helps people build lasting habits/);
  assert.match(content, /Supabase/);

  assert.deepStrictEqual(result, {
    title: 'A way to tell its people apart.',
    why: 'You just said partners share streaks, so this is not only "add a login." Two people read the same rows.',
    prompt: 'Add Supabase Auth to Loop.\n1. Add magic-link sign-in.\n2. Add a partnerships table.\n3. Row-level security.',
    category: 'auth',
  });
});

test('different settled claims produce a different request payload', async () => {
  reset();
  responder = () => GOOD_COPY;

  await deriveNextThing(INPUTS, SETTLED);
  const sharedContent = captured.calls[0].params.messages[0].content;

  await deriveNextThing(INPUTS, [
    { slot: 'audience', text: 'someone improving on their own', source: 'human' },
  ]);
  const soloContent = captured.calls[1].params.messages[0].content;

  assert.notStrictEqual(sharedContent, soloContent);
  assert.match(soloContent, /someone improving on their own/);
  assert.ok(!/people keeping each other honest/.test(soloContent));
});

test('category comes from the deterministic candidate, not the LLM', async () => {
  reset();
  responder = () => GOOD_COPY;

  const result = await deriveNextThing(
    { ...INPUTS, readiness: readinessWith(), map: SOLO_MAP, gaps: [{ title: 'Empty states', category: 'ux' }] },
    SETTLED
  );
  assert.strictEqual(result.category, 'ux');
});

test('opts.client is passed through to the tracked call', async () => {
  reset();
  responder = () => GOOD_COPY;
  const sentinel = { messages: { create: async () => ({}) } };

  await deriveNextThing(INPUTS, SETTLED, { client: sentinel });
  assert.strictEqual(captured.calls[0].client, sentinel);
});

test('malformed JSON from the model throws a descriptive error', async () => {
  reset();
  responder = () => 'here is your plan: build auth!!!';

  await assert.rejects(
    () => deriveNextThing(INPUTS, SETTLED),
    (err) => {
      assert.match(err.message, /unparsable JSON/i);
      return true;
    }
  );
});

test('missing fields in the model response throw a descriptive error', async () => {
  reset();
  responder = () => JSON.stringify({ title: 'A title.', why: '' });

  await assert.rejects(
    () => deriveNextThing(INPUTS, SETTLED),
    (err) => {
      assert.match(err.message, /missing field/i);
      assert.match(err.message, /why/);
      assert.match(err.message, /prompt/);
      return true;
    }
  );
});

test('parseNextThing strips fences', () => {
  const out = parseNextThing('```json\n' + GOOD_COPY + '\n```');
  assert.strictEqual(out.title, 'A way to tell its people apart.');
});
