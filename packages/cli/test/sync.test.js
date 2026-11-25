'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sync, TakeoffError, MARKER_START, MARKER_END } = require('../lib');
const { run } = require('../lib/cli');

const fixture = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
function repo(files = { 'takeoff.yaml': fixture('v2.yaml') }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'takeoff-cli-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
const snapshot = (dir) => ['CLAUDE.md', 'AGENTS.md', '.cursor/rules/takeoff.mdc'].map((f) => read(dir, f)).join('\0');

test('sync creates all three files; the .mdc gets Cursor front matter', () => {
  const dir = repo();
  const r = sync({ dir });
  assert.deepStrictEqual(r.results.map((x) => x.action), ['created', 'created', 'created']);
  assert.ok(read(dir, '.cursor/rules/takeoff.mdc').startsWith('---\ndescription:'));
  assert.ok(read(dir, 'CLAUDE.md').includes('Stripe holds all billing data'));
});

test('sync is idempotent: a second run changes nothing', () => {
  const dir = repo();
  sync({ dir });
  const first = snapshot(dir);
  const r = sync({ dir });
  assert.deepStrictEqual(r.results.map((x) => x.action), ['unchanged', 'unchanged', 'unchanged']);
  assert.strictEqual(snapshot(dir), first);
  assert.strictEqual(r.inSync, true);
});

test('sync keeps hand-written content and updates only inside the markers', () => {
  const dir = repo({
    'takeoff.yaml': fixture('v2.yaml'),
    'CLAUDE.md': `# Project notes\n\nUse pnpm.\n\n${MARKER_START}\nstale\n${MARKER_END}\n\n## Tail\nKeep me.\n`,
    'AGENTS.md': '# Agents\nUse pnpm.\n',
  });
  sync({ dir });
  const claude = read(dir, 'CLAUDE.md');
  assert.ok(claude.startsWith('# Project notes\n\nUse pnpm.\n\n'));
  assert.ok(claude.endsWith('\n\n## Tail\nKeep me.\n'));
  assert.ok(!claude.includes('stale'));
  assert.ok(read(dir, 'AGENTS.md').startsWith('# Agents\nUse pnpm.\n\n'));
});

test('--check reports out-of-date files without writing; --dry-run writes nothing', () => {
  const dir = repo();
  const c = sync({ dir, check: true });
  assert.strictEqual(c.inSync, false);
  assert.strictEqual(fs.existsSync(path.join(dir, 'CLAUDE.md')), false);
  sync({ dir, dryRun: true });
  assert.strictEqual(fs.existsSync(path.join(dir, 'CLAUDE.md')), false);
  sync({ dir });
  assert.strictEqual(sync({ dir, check: true }).inSync, true);
});

test('sync refuses an invalid or missing takeoff.yaml, and broken markers, without writing', () => {
  const bad = repo({ 'takeoff.yaml': 'version: 2\nproduct: {}\n' });
  assert.throws(() => sync({ dir: bad }), TakeoffError);
  assert.strictEqual(fs.existsSync(path.join(bad, 'CLAUDE.md')), false);
  assert.throws(() => sync({ dir: repo({}) }), /not found/);

  const broken = repo({ 'takeoff.yaml': fixture('v2.yaml'), 'AGENTS.md': `${MARKER_START}\nno end\n` });
  assert.throws(() => sync({ dir: broken }), /AGENTS\.md/);
  assert.strictEqual(fs.existsSync(path.join(broken, 'CLAUDE.md')), false, 'nothing written when any target fails');
});

test('a v1 file still syncs, with a note to migrate', () => {
  const dir = repo({ 'takeoff.yaml': fixture('v1.yaml') });
  const r = sync({ dir });
  assert.ok(r.notes[0].includes('takeoff migrate'));
  assert.ok(read(dir, 'CLAUDE.md').includes('Never log tokens.'));
});

function cli(dir, args) {
  const out = [];
  const err = [];
  const code = run(args, { cwd: dir, out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('cli: validate, sync --check, migrate round trip with exit codes', () => {
  const dir = repo({ 'takeoff.yaml': fixture('v1.yaml') });
  assert.strictEqual(cli(dir, ['validate']).code, 0);
  assert.strictEqual(cli(dir, ['validate', '--strict']).code, 1, 'v1 warning fails --strict');

  const m = cli(dir, ['migrate']);
  assert.strictEqual(m.code, 0, m.err);
  assert.strictEqual(cli(dir, ['validate', '--strict']).code, 0);
  assert.match(cli(dir, ['migrate']).out, /already v2/);

  assert.strictEqual(cli(dir, ['sync', '--check']).code, 1);
  assert.strictEqual(cli(dir, ['sync']).code, 0);
  assert.strictEqual(cli(dir, ['sync', '--check']).code, 0);
});

test('cli: errors print file:line:col and exit 1; usage mistakes exit 2', () => {
  const dir = repo({ 'takeoff.yaml': 'version: 2\nproduct: { summary: x }\nareas: []\n' });
  const v = cli(dir, ['validate']);
  assert.strictEqual(v.code, 1);
  assert.match(v.err, /takeoff\.yaml:2:\d+ {2}error {2}product\.name: /);
  assert.strictEqual(cli(dir, ['wat']).code, 2);
  assert.strictEqual(cli(dir, []).code, 2);
  assert.strictEqual(cli(dir, ['--help']).code, 0);
  assert.strictEqual(cli(dir, ['sync', '--dir']).code, 2);
});
