const { test } = require('node:test');
const assert = require('node:assert');

// --- Mock the tracked Claude call BEFORE requiring the module under test ---
// (same approach as intent/bootstrap.test.js: stub the anthropic-tracked
// module in require.cache so nothing touches the network or the DB).

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

const { synthesizeRead, parseReadClaims } = require('./synthesize-read');
const { UNCERTAIN_THRESHOLD } = require('./read-confidence');

function reset() {
  captured.calls = [];
  responder = () => '{}';
}

const INPUTS = {
  projectId: 'proj-1',
  map: {
    domain: 'Habit tracking',
    personas: [{ id: 'persona:0', name: 'Solo improver', emoji: '🌱', priority: 'high' }],
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
  stack: { framework: 'Express', runtime: 'node' },
};

const GOOD_RESPONSE = JSON.stringify({
  claims: [
    {
      slot: 'objective',
      text: 'helps people build lasting habits through fast daily check-ins',
      evidenceHints: ['src/Habit.js'],
      confidence: 0.99, // LLM self-score — must be ignored
    },
    {
      slot: 'audience',
      text: 'someone improving on their own',
      evidenceHints: ['Solo improver'],
      alternative: {
        question: "Who's this really for? This decides what has to be true before launch.",
        options: [
          { id: 'solo', label: 'Someone on their own', detail: 'Habits stay private to each person.', claimText: 'someone improving on their own' },
          { id: 'shared', label: 'People keeping each other honest', detail: 'Partners see each other\'s streaks.', claimText: 'people keeping each other honest' },
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

test('happy path: three claims, scored confidence, resolved evidence, audience alternative', async () => {
  reset();
  responder = () => GOOD_RESPONSE;

  const { claims } = await synthesizeRead(INPUTS);

  assert.strictEqual(claims.length, 3);
  assert.deepStrictEqual(claims.map((c) => c.slot), ['objective', 'audience', 'core_job']);

  for (const claim of claims) {
    assert.ok(claim.text.length > 0);
    assert.ok(Array.isArray(claim.evidence) && claim.evidence.length >= 1, `${claim.slot} needs evidence`);
    for (const ev of claim.evidence) {
      assert.strictEqual(typeof ev.note, 'string');
      assert.ok(ev.note.length > 0, 'evidence note must be a human sentence');
    }
  }

  const [objective, audience, coreJob] = claims;

  // Confidence comes from read-confidence.js, never the LLM's 0.99 self-score.
  assert.strictEqual(objective.confidence, 0.7);
  assert.strictEqual(objective.evidence[0].filePath, 'src/Habit.js');
  assert.strictEqual(objective.alternative, null);

  // core_job matched both links -> two grounded entries -> high confidence.
  assert.strictEqual(coreJob.confidence, 0.85);
  assert.strictEqual(coreJob.evidence.length, 2);
  assert.strictEqual(coreJob.alternative, null);

  // Audience: persona-only inference -> yellow zone, carries the alternative.
  assert.ok(audience.confidence < UNCERTAIN_THRESHOLD);
  assert.strictEqual(audience.confidence, 0.4);
  assert.strictEqual(audience.evidence[0].filePath, null);
  assert.match(audience.evidence[0].note, /Solo improver/);
  assert.ok(audience.alternative);
  assert.strictEqual(audience.alternative.options.length, 2);
  assert.strictEqual(audience.alternative.options[1].claimText, 'people keeping each other honest');

  // No id/status/source on claims — the persistence layer adds those.
  assert.ok(!('id' in objective) && !('status' in objective) && !('source' in objective));
});

test('makes exactly ONE tracked Claude call with the right phase and model inputs', async () => {
  reset();
  responder = () => GOOD_RESPONSE;

  await synthesizeRead(INPUTS);

  assert.strictEqual(captured.calls.length, 1);
  const call = captured.calls[0];
  assert.strictEqual(call.analysisId, 'proj-1');
  assert.strictEqual(call.phase, 'read.synthesize');
  assert.strictEqual(call.params.system[0].cache_control.type, 'ephemeral');

  const content = call.params.messages[0].content;
  assert.match(content, /Habit tracking/);
  assert.match(content, /Solo improver/);
  assert.match(content, /A check-in is logged in under ten seconds/);
  assert.match(content, /src\/Habit\.js/);
  assert.match(content, /habit tracker with fast daily check-ins/);
});

test('opts.client is passed through to the tracked call', async () => {
  reset();
  responder = () => GOOD_RESPONSE;
  const sentinel = { messages: { create: async () => ({}) } };

  await synthesizeRead(INPUTS, { client: sentinel });

  assert.strictEqual(captured.calls[0].client, sentinel);
});

test('audience evidence cites a real file when a map entity carries one', async () => {
  reset();
  responder = () => GOOD_RESPONSE;
  const inputs = {
    ...INPUTS,
    map: {
      ...INPUTS.map,
      entities: [{ id: 'e1', type: 'page', label: 'Solo improver dashboard', file_path: 'src/Dashboard.tsx' }],
    },
  };

  const { claims } = await synthesizeRead(inputs);
  const audience = claims.find((c) => c.slot === 'audience');
  assert.strictEqual(audience.evidence[0].filePath, 'src/Dashboard.tsx');
  assert.strictEqual(audience.confidence, 0.7);
});

test('malformed JSON throws a descriptive error', async () => {
  reset();
  responder = () => 'sorry, here are your claims {{{not json';

  await assert.rejects(
    () => synthesizeRead(INPUTS),
    (err) => {
      assert.match(err.message, /unparsable JSON/i);
      return true;
    }
  );
});

test('missing slot throws a descriptive error', async () => {
  reset();
  responder = () =>
    JSON.stringify({
      claims: [
        { slot: 'objective', text: 'does a thing', evidenceHints: [] },
        { slot: 'audience', text: 'someone', evidenceHints: [] },
      ],
    });

  await assert.rejects(
    () => synthesizeRead(INPUTS),
    (err) => {
      assert.match(err.message, /missing claim slot/i);
      assert.match(err.message, /core_job/);
      return true;
    }
  );
});

test('parseReadClaims strips code fences and drops a malformed alternative', () => {
  const fenced =
    '```json\n' +
    JSON.stringify({
      claims: [
        { slot: 'objective', text: 'does a thing', evidenceHints: [] },
        {
          slot: 'audience',
          text: 'someone',
          evidenceHints: [],
          alternative: { question: 'who?', options: [{ id: 'only-one', label: 'x', detail: '', claimText: 'x' }] },
        },
        { slot: 'core_job', text: 'never lose data', evidenceHints: [] },
      ],
    }) +
    '\n```';

  const bySlot = parseReadClaims(fenced);
  assert.strictEqual(bySlot.objective.text, 'does a thing');
  // one option is not a choice — normalized away
  assert.strictEqual(bySlot.audience.alternative, null);
});

test('claims fall back to grounded evidence when hints match nothing', async () => {
  reset();
  responder = () =>
    JSON.stringify({
      claims: [
        { slot: 'objective', text: 'does a thing', evidenceHints: ['nothing/that/exists.js'] },
        { slot: 'audience', text: 'someone', evidenceHints: [] },
        { slot: 'core_job', text: 'never lose data', evidenceHints: [] },
      ],
    });

  const { claims } = await synthesizeRead(INPUTS);
  const objective = claims.find((c) => c.slot === 'objective');
  // Falls back to the top invariant's links — still file-grounded.
  assert.ok(objective.evidence.length >= 1);
  assert.strictEqual(objective.evidence[0].filePath, 'src/Habit.js');
});
