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

// --- Stub read-confidence with the frozen contract -----------------------
// The real module is being rewritten in a parallel workstream; stubbing it
// here (with the exact contracted behavior) keeps these tests hermetic no
// matter which version is on disk.
//   verifyEvidence(evidence, { knownPaths, invariantLinks }) → +verified
//   scoreClaimConfidence({ slot, evidence }): 2+ verified → 0.9, 1 → 0.72,
//     audience w/ entries → 0.4, else 0.3

const confidencePath = require.resolve('./read-confidence');

require.cache[confidencePath] = {
  id: confidencePath,
  filename: confidencePath,
  loaded: true,
  exports: {
    UNCERTAIN_THRESHOLD: 0.6,
    verifyEvidence(evidence, { knownPaths = [], invariantLinks = [] } = {}) {
      const known = new Set(knownPaths);
      const linkPaths = new Set(invariantLinks.map((l) => l.filePath));
      return (Array.isArray(evidence) ? evidence : []).map((e) => ({
        ...e,
        verified: Boolean(e && e.filePath && (known.has(e.filePath) || linkPaths.has(e.filePath))),
      }));
    },
    scoreClaimConfidence({ slot, evidence }) {
      const entries = Array.isArray(evidence) ? evidence : [];
      const verified = entries.filter((e) => e && e.verified).length;
      if (verified >= 2) return 0.9;
      if (verified === 1) return 0.72;
      if (slot === 'audience' && entries.length > 0) return 0.4;
      return 0.3;
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

const CODE_SLICE = {
  files: [
    { path: 'src/Habit.js', kind: 'full', text: 'export function logCheckin(habit) {\n  return db.insert(habit);\n}', score: 12, inboundDegree: 3 },
    { path: 'src/streaks.js', kind: 'skeleton', text: 'export function currentStreak(entries): number', score: 8, inboundDegree: 1 },
  ],
  knownPaths: ['src/Habit.js', 'src/QuickLog.tsx', 'src/streaks.js'],
  truncated: false,
  source: 'db',
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
      assert.strictEqual(typeof ev.verified, 'boolean', 'evidence carries a verified flag');
    }
  }

  const [objective, audience, coreJob] = claims;

  // Confidence comes from read-confidence, never the LLM's 0.99 self-score.
  assert.strictEqual(objective.confidence, 0.72);
  assert.strictEqual(objective.evidence[0].filePath, 'src/Habit.js');
  assert.strictEqual(objective.evidence[0].verified, true);
  assert.strictEqual(objective.alternative, null);

  // core_job matched both links -> two verified entries -> high confidence.
  assert.strictEqual(coreJob.confidence, 0.9);
  assert.strictEqual(coreJob.evidence.length, 2);
  assert.ok(coreJob.evidence.every((e) => e.verified));
  assert.match(coreJob.evidence[0].note, /Read plainly from/);
  assert.strictEqual(coreJob.alternative, null);

  // Audience: persona-only inference -> yellow zone, carries the alternative.
  assert.ok(audience.confidence < UNCERTAIN_THRESHOLD);
  assert.strictEqual(audience.confidence, 0.4);
  assert.strictEqual(audience.evidence[0].filePath, null);
  assert.strictEqual(audience.evidence[0].verified, false);
  assert.match(audience.evidence[0].note, /Solo improver/);
  assert.ok(audience.alternative);
  assert.strictEqual(audience.alternative.options.length, 2);
  assert.strictEqual(audience.alternative.options[1].claimText, 'people keeping each other honest');

  // No id/status/source on claims — the persistence layer adds those.
  assert.ok(!('id' in objective) && !('status' in objective) && !('source' in objective));
});

test('makes exactly ONE tracked Claude call with the right phase, budget and model inputs', async () => {
  reset();
  responder = () => GOOD_RESPONSE;

  await synthesizeRead(INPUTS);

  assert.strictEqual(captured.calls.length, 1);
  const call = captured.calls[0];
  assert.strictEqual(call.analysisId, 'proj-1');
  assert.strictEqual(call.phase, 'read.synthesize');
  assert.strictEqual(call.params.max_tokens, 2000);
  assert.strictEqual(call.params.system[0].cache_control.type, 'ephemeral');
  // The grounding rule lives in the (cached) system prompt.
  assert.match(call.params.system[0].text, /never invent a path/i);
  assert.match(call.params.system[0].text, /1-3 files/);

  const content = call.params.messages[0].content;
  assert.match(content, /Habit tracking/);
  assert.match(content, /Solo improver/);
  assert.match(content, /A check-in is logged in under ten seconds/);
  assert.match(content, /src\/Habit\.js/);
  assert.match(content, /habit tracker with fast daily check-ins/);
  // No code slice given -> prompt degrades gracefully to map-only sections.
  assert.doesNotMatch(content, /Source code excerpts/);
  assert.doesNotMatch(content, /Settled claims/);
  assert.doesNotMatch(content, /Core job \(already decided\)/);
});

test('opts.client is passed through to the tracked call', async () => {
  reset();
  responder = () => GOOD_RESPONSE;
  const sentinel = { messages: { create: async () => ({}) } };

  await synthesizeRead(INPUTS, { client: sentinel });

  assert.strictEqual(captured.calls[0].client, sentinel);
});

test('prompt embeds source code excerpts as given by the slice', async () => {
  reset();
  responder = () => GOOD_RESPONSE;

  await synthesizeRead({ ...INPUTS, codeSlice: CODE_SLICE });

  const content = captured.calls[0].params.messages[0].content;
  assert.match(content, /Source code excerpts/);
  assert.match(content, /--- src\/Habit\.js \(full\) ---/);
  assert.match(content, /export function logCheckin\(habit\)/);
  assert.match(content, /--- src\/streaks\.js \(skeleton\) ---/);
  assert.match(content, /currentStreak\(entries\)/);
});

test('an empty code slice degrades to the sliceless prompt', async () => {
  reset();
  responder = () => GOOD_RESPONSE;

  await synthesizeRead({
    ...INPUTS,
    codeSlice: { files: [], knownPaths: [], truncated: false, source: 'empty' },
  });

  const content = captured.calls[0].params.messages[0].content;
  assert.doesNotMatch(content, /Source code excerpts/);
});

test('settled claims appear in the prompt as ground truth', async () => {
  reset();
  responder = () => GOOD_RESPONSE;

  await synthesizeRead({
    ...INPUTS,
    settledClaims: [{ slot: 'objective', text: 'helps trainers run habit programs for clients' }],
  });

  const content = captured.calls[0].params.messages[0].content;
  assert.match(content, /Settled claims/);
  assert.match(content, /treat them as ground truth/);
  assert.match(content, /keep the other claims consistent/);
  assert.match(content, /- objective: "helps trainers run habit programs for clients"/);
});

test('core-job candidate pins the core_job claim to one specific guarantee', async () => {
  reset();
  responder = () => GOOD_RESPONSE;

  await synthesizeRead({
    ...INPUTS,
    coreJobCandidate: {
      invariant: INPUTS.invariants[0],
      job: { id: 'job:0', title: 'Log a habit fast', priority: 'high' },
      personaName: 'Solo improver',
      reason: 'highest-confidence satisfied invariant on a high-priority job',
    },
  });

  const content = captured.calls[0].params.messages[0].content;
  assert.match(content, /Core job \(already decided\)/);
  assert.match(content, /plain-language phrasing of THIS specific guarantee/);
  assert.match(content, /not a free choice/);
  assert.match(content, /"A check-in is logged in under ten seconds"/);
  assert.match(content, /Linked files: src\/Habit\.js:logCheckin, src\/QuickLog\.tsx/);
  assert.match(content, /Log a habit fast \(for Solo improver\)/);
});

test('hints matching slice knownPaths (not invariant links) yield verified evidence', async () => {
  reset();
  responder = () =>
    JSON.stringify({
      claims: [
        { slot: 'objective', text: 'tracks streaks over time', evidenceHints: ['src/streaks.js'] },
        { slot: 'audience', text: 'someone', evidenceHints: [] },
        { slot: 'core_job', text: 'never lose data', evidenceHints: [] },
      ],
    });

  const { claims } = await synthesizeRead({ ...INPUTS, codeSlice: CODE_SLICE });
  const objective = claims.find((c) => c.slot === 'objective');

  assert.strictEqual(objective.evidence.length, 1);
  assert.strictEqual(objective.evidence[0].filePath, 'src/streaks.js');
  assert.strictEqual(objective.evidence[0].verified, true);
  assert.match(objective.evidence[0].note, /Read from streaks\.js/);
  assert.strictEqual(objective.confidence, 0.72);
});

test('invented paths never become evidence — falls back to verified anchor links', async () => {
  reset();
  responder = () =>
    JSON.stringify({
      claims: [
        { slot: 'objective', text: 'does a thing', evidenceHints: ['totally/made/up.js'] },
        { slot: 'audience', text: 'someone', evidenceHints: [] },
        { slot: 'core_job', text: 'never lose data', evidenceHints: ['also/fake.py'] },
      ],
    });

  const { claims } = await synthesizeRead({ ...INPUTS, codeSlice: CODE_SLICE });

  for (const slot of ['objective', 'core_job']) {
    const claim = claims.find((c) => c.slot === slot);
    assert.ok(
      claim.evidence.every((e) => e.filePath !== 'totally/made/up.js' && e.filePath !== 'also/fake.py'),
      `${slot} must not cite an invented path`
    );
    // Anchor fallback: the top invariant's own (verified) links.
    assert.strictEqual(claim.evidence[0].filePath, 'src/Habit.js');
    assert.strictEqual(claim.evidence[0].verified, true);
  }
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
  assert.strictEqual(audience.evidence[0].verified, true);
  assert.strictEqual(audience.confidence, 0.72);
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

test('honest note when nothing verifies at all (no links, no slice)', async () => {
  reset();
  responder = () =>
    JSON.stringify({
      claims: [
        { slot: 'objective', text: 'does a thing', evidenceHints: ['whatever.js'] },
        { slot: 'audience', text: 'someone', evidenceHints: [] },
        { slot: 'core_job', text: 'never lose data', evidenceHints: [] },
      ],
    });

  const { claims } = await synthesizeRead({ ...INPUTS, invariants: [] });
  const objective = claims.find((c) => c.slot === 'objective');
  assert.strictEqual(objective.evidence.length, 1);
  assert.strictEqual(objective.evidence[0].filePath, null);
  assert.match(objective.evidence[0].note, /no single file pins this down/);
  assert.strictEqual(objective.confidence, 0.3);
});
