const { test } = require('node:test');
const assert = require('node:assert/strict');

const { toGap, isCannedCursorPrompt, synthesizeMapGaps } = require('./gap-mapper');

test('strips canned static cursor prompts so the UI can generate a grounded one', () => {
  const row = {
    id: 'abc',
    source: 'static',
    type: 'bug',
    category: 'deployment',
    priority: 'medium',
    title: 'Hardcoded localhost URLs found in source code',
    description: 'Found 3 hardcoded localhost reference(s).',
    effort: 'quick',
    cursor_prompt:
      'Replace all hardcoded localhost URLs with environment variables. 1) Add a variable like `API_URL` to your .env file (e.g. `API_URL=http://localhost:3000` for dev).',
    affected_files: ['app/server/app.js'],
    evidence: [{ file: 'app/server/app.js', line: 48, snippet: "|| 'http://localhost:3000'", reason: 'fallback' }],
    status: 'open',
  };
  assert.equal(isCannedCursorPrompt(row), true);
  const gap = toGap(row);
  assert.equal(gap.prompt, null);
  assert.equal(gap.evidence[0].file, 'app/server/app.js');
  assert.equal(gap.evidence[0].line, 48);
});

test('keeps a grounded prompt that was generated for a static gap', () => {
  const row = {
    id: 'def',
    source: 'static',
    type: 'bug',
    category: 'deployment',
    title: 'Hardcoded localhost URLs found in source code',
    description: 'Found 1 hardcoded localhost reference.',
    cursor_prompt:
      'In src/api.js:1, replace the hardcoded `http://localhost:4000/api` base URL with process.env.API_URL. Do not touch env-var fallbacks elsewhere.',
    affected_files: ['src/api.js'],
    evidence: [{ file: 'src/api.js', line: 1, snippet: "const API = 'http://localhost:4000/api'" }],
  };
  assert.equal(isCannedCursorPrompt(row), false);
  assert.match(toGap(row).prompt, /src\/api\.js:1/);
});

test('does not strip AI-generated prompts', () => {
  const row = {
    id: 'ghi',
    source: 'ai',
    type: 'fix',
    category: 'security',
    title: 'Rate-limit login',
    cursor_prompt: 'Add express-rate-limit to protect API endpoints from abuse on /auth/login.',
    affected_files: ['app/server/routes/auth.js'],
    evidence: [],
  };
  assert.equal(isCannedCursorPrompt(row), false);
  assert.ok(toGap(row).prompt);
});

function sharedBlockerMap() {
  return {
    personas: [
      { id: 'p1', name: 'Writer', emoji: '✍️' },
      { id: 'p2', name: 'Editor', emoji: '🧐' },
    ],
    jobs: [
      { id: 'j1', title: 'Delete a post', persona_id: 'p1' },
      { id: 'j2', title: 'Clean up drafts', persona_id: 'p1' },
      { id: 'j3', title: 'Remove spam', persona_id: 'p2' },
    ],
    entities: [
      { id: 'e1', label: 'DELETE /api/posts/[postId]', status: 'partial', file_path: 'app/api/posts/[postId]/route.ts' },
    ],
    edges: [
      { type: 'needs', from_id: 'j1', to_id: 'e1' },
      { type: 'needs', from_id: 'j2', to_id: 'e1' },
      { type: 'needs', from_id: 'j3', to_id: 'e1' },
    ],
  };
}

test('synthesizeMapGaps makes one card per blocking entity, listing every job', () => {
  const gaps = synthesizeMapGaps(sharedBlockerMap(), []);
  assert.equal(gaps.length, 1);
  const [gap] = gaps;
  assert.equal(gap.id, 'map-e1');
  assert.equal(gap.title, 'Finish DELETE /api/posts/[postId]');
  assert.deepEqual(gap.required_for, ['Delete a post', 'Clean up drafts', 'Remove spam']);
  assert.deepEqual(gap.affects, ['Writer', 'Editor']);
  assert.deepEqual(gap.affectedJobs.map((j) => j.jobId), ['j1', 'j2', 'j3']);
  assert.deepEqual(gap.jobLinks.map((l) => l.jobId), ['j1', 'j2', 'j3']);
  assert.match(gap.description, /3 jobs depend on it/);
});

test('synthesizeMapGaps leaves covered jobs off the card', () => {
  const existing = [{ jobLinks: [{ jobId: 'j2', entityId: 'e1' }, { jobId: 'j3', entityId: 'e1' }], affectedFiles: [] }];
  const gaps = synthesizeMapGaps(sharedBlockerMap(), existing);
  assert.equal(gaps.length, 1);
  assert.deepEqual(gaps[0].required_for, ['Delete a post']);
  assert.equal(
    gaps[0].description,
    'Writer needs to "Delete a post". DELETE /api/posts/[postId] is partially built — fill in the gaps so this job can be completed end-to-end.',
  );
});

test('synthesizeMapGaps drops the card when every job is covered', () => {
  const existing = [{ jobLinks: ['j1', 'j2', 'j3'].map((jobId) => ({ jobId, entityId: 'e1' })), affectedFiles: [] }];
  assert.deepEqual(synthesizeMapGaps(sharedBlockerMap(), existing), []);
});
