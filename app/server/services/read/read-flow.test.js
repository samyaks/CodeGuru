const { test } = require('node:test');
const assert = require('node:assert');

// The "wave test": the whole read flow — synthesis, a human correction, and
// the re-derived next-thing — wired through the pure services with a faked
// Claude and no DB or HTTP. Mock the tracked call BEFORE requiring the
// modules under test (same approach as the other read tests).

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
      return { content: [{ type: 'text', text: responder(phase) }] };
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

const { synthesizeRead } = require('./synthesize-read');
const { deriveNextThing } = require('./next-thing');
const { UNCERTAIN_THRESHOLD } = require('./read-confidence');

// ── the project as the analysis left it ────────────────────────────

const INPUTS = {
  projectId: 'proj-flow',
  map: {
    domain: 'Habit tracking',
    personas: [
      { id: 'persona:0', name: 'Habit builder', emoji: '🌱', priority: 'high' },
      { id: 'persona:1', name: 'Accountability partner', emoji: '🤝', priority: 'medium' },
    ],
    jobs: [{ id: 'job:0', persona_id: 'persona:0', title: 'Log a habit fast', priority: 'high' }],
    entities: [],
    edges: [],
  },
  invariants: [
    {
      text: 'A check-in is logged in under ten seconds',
      kind: 'behavior',
      confidence: 0.9,
      satisfied: true,
      links: [
        { file_path: 'src/Habit.js', symbol: 'logCheckin' },
        { file_path: 'src/QuickLog.tsx', symbol: null },
      ],
    },
  ],
  featuresSummary: 'A habit tracker with fast daily check-ins and streaks.',
  repoDescription: 'Loop — tiny habit tracker',
  fileCount: 47,
  stack: { framework: 'Express', runtime: 'node', database: 'Supabase' },
  readiness: {
    score: 55,
    categories: {
      auth: { status: 'missing', weight: 15, label: 'Authentication', detail: 'No authentication system found' },
    },
  },
  gaps: [],
  securityFindings: [],
};

const SYNTHESIS_RESPONSE = JSON.stringify({
  claims: [
    {
      slot: 'objective',
      text: 'helps people build lasting habits through fast daily check-ins',
      evidenceHints: ['src/Habit.js'],
    },
    {
      slot: 'audience',
      text: 'someone improving on their own',
      evidenceHints: ['Habit builder'],
      alternative: {
        question: "Who's this really for? This decides what has to be true before launch.",
        options: [
          { id: 'solo', label: 'Someone on their own', detail: 'Habits stay private.', claimText: 'someone improving on their own' },
          { id: 'shared', label: 'People keeping each other honest', detail: "Partners see each other's streaks.", claimText: 'people keeping each other honest' },
        ],
      },
    },
    {
      slot: 'core_job',
      text: 'letting them log a habit in under ten seconds',
      evidenceHints: ['src/Habit.js', 'QuickLog.tsx'],
    },
  ],
});

const NEXT_RESPONSE = JSON.stringify({
  title: 'A way to tell its people apart — and who may see whom.',
  why: 'You just said partners share streaks, so this is not only "add a login."',
  prompt: 'Add Supabase Auth + partner sharing to Loop.\n1. Magic-link sign-in.\n2. Partnerships table.\n3. Row-level security.',
});

test('full read flow: synthesis -> correction -> conditioned next-thing', async () => {
  captured.calls = [];
  responder = (phase) => (phase === 'read.synthesize' ? SYNTHESIS_RESPONSE : NEXT_RESPONSE);

  // ── stage 1: draft the read ─────────────────────────────────────
  const { claims } = await synthesizeRead(INPUTS, {});

  assert.strictEqual(claims.length, 3);
  assert.deepStrictEqual(claims.map((c) => c.slot), ['objective', 'audience', 'core_job']);

  const [objective, audience, coreJob] = claims;

  // Grounded claims resolve real evidence and land above the threshold.
  assert.strictEqual(objective.evidence[0].filePath, 'src/Habit.js');
  assert.ok(objective.confidence >= UNCERTAIN_THRESHOLD);
  assert.strictEqual(coreJob.evidence.length, 2);
  assert.strictEqual(coreJob.confidence, 0.85);

  // The audience claim is the yellow-wash one: persona-only inference,
  // under the threshold, carrying the structured alternative.
  assert.ok(audience.confidence < UNCERTAIN_THRESHOLD);
  assert.strictEqual(audience.evidence[0].filePath, null);
  assert.match(audience.evidence[0].note, /guessing/i);
  assert.ok(audience.alternative);
  assert.strictEqual(audience.alternative.options.length, 2);
  const sharedOption = audience.alternative.options.find((o) => o.id === 'shared');
  assert.strictEqual(sharedOption.claimText, 'people keeping each other honest');

  assert.strictEqual(captured.calls.length, 1);
  assert.strictEqual(captured.calls[0].phase, 'read.synthesize');

  // ── stage 2: the person corrects the audience claim ─────────────
  // (In production the settle happens in db.js and the cascade re-derives;
  // here we hand deriveNextThing the settled view directly.)
  const settledClaims = claims.map((c) =>
    c.slot === 'audience'
      ? { slot: c.slot, text: sharedOption.claimText, source: 'human' }
      : { slot: c.slot, text: c.text, source: 'inferred' }
  );

  const next = await deriveNextThing(INPUTS, settledClaims, {});

  assert.strictEqual(captured.calls.length, 2);
  const nextCall = captured.calls[1];
  assert.strictEqual(nextCall.phase, 'read.next');
  assert.strictEqual(nextCall.analysisId, 'proj-flow');

  // The conditioning contract: the corrected audience text reaches the
  // model, flagged as ground truth; the machine draft it replaced does not.
  const payload = nextCall.params.messages[0].content;
  assert.match(payload, /people keeping each other honest/);
  assert.match(payload, /CORRECTED BY THE PERSON/);
  assert.ok(!payload.includes('someone improving on their own'));
  // Drafted claims and the actual stack ride along.
  assert.match(payload, /helps people build lasting habits/);
  assert.match(payload, /letting them log a habit in under ten seconds/);
  assert.match(payload, /Supabase/);

  // The parsed copy comes through, category from the deterministic pick
  // (auth missing + multi-persona map => auth).
  assert.deepStrictEqual(next, {
    title: 'A way to tell its people apart — and who may see whom.',
    why: 'You just said partners share streaks, so this is not only "add a login."',
    prompt: 'Add Supabase Auth + partner sharing to Loop.\n1. Magic-link sign-in.\n2. Partnerships table.\n3. Row-level security.',
    category: 'auth',
  });
});
