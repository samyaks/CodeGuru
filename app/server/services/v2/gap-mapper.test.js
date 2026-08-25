const { test } = require('node:test');
const assert = require('node:assert/strict');

const { toGap, isCannedCursorPrompt } = require('./gap-mapper');

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
