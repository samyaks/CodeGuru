'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sync, TakeoffError, validateText, renderBlock, applyBlock, MARKER_START, MARKER_END } = require('../lib');
const { run } = require('../lib/cli');

const fixture = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
function repo(files = { 'takeoff.yaml': fixture('v2.yaml') }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'takeoff-edge-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}
const read = (dir, f) => fs.readFileSync(path.join(dir, f), 'utf8');
function cli(dir, argv) {
  const out = [];
  const err = [];
  const code = run(argv, { cwd: dir, out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('markers quoted in prose or in a code block are not markers, and are left alone', () => {
  const prose = `Takeoff writes between \`${MARKER_START}\` and \`${MARKER_END}\`; do not edit.\n`;
  const fenced = `Example:\n\n\`\`\`md\n${MARKER_START}\n${MARKER_END}\n\`\`\`\n`;
  for (const existing of [prose, fenced, `Only one: \`${MARKER_START}\`\n`]) {
    const r = applyBlock(existing, 'BLOCK');
    assert.strictEqual(r.error, undefined);
    assert.ok(r.text.startsWith(existing), 'original text kept as is');
    assert.ok(r.text.endsWith('BLOCK\n'));
  }
});

test('a real marker pair is found even with surrounding whitespace, and only that region changes', () => {
  const existing = `top\n  ${MARKER_START}  \nold\n${MARKER_END}\nbottom\n`;
  const r = applyBlock(existing, `${MARKER_START}\nnew\n${MARKER_END}`);
  assert.strictEqual(r.text, `top\n${MARKER_START}\nnew\n${MARKER_END}\nbottom\n`);
});

test('marker text inside takeoff.yaml cannot break the next sync', () => {
  const yaml = fixture('v2.yaml').replace('Never store card numbers.', `Keep ${MARKER_END} intact. Never store card numbers.`);
  const dir = repo({ 'takeoff.yaml': yaml });
  sync({ dir });
  const second = sync({ dir });
  assert.ok(second.inSync, 'second run changes nothing');
  assert.ok(read(dir, 'CLAUDE.md').includes('&lt;!-- takeoff:end -->'));
  assert.strictEqual(renderBlock(validateText(yaml).data).split(MARKER_END).length, 2);
});

test('sync refuses to write through a symlink', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'takeoff-outside-'));
  fs.writeFileSync(path.join(outside, 'victim.txt'), 'keep me\n');
  const dir = repo();
  fs.symlinkSync(path.join(outside, 'victim.txt'), path.join(dir, 'CLAUDE.md'));
  assert.throws(() => sync({ dir }), (e) => e instanceof TakeoffError && /symlink/.test(e.message));
  assert.strictEqual(fs.readFileSync(path.join(outside, 'victim.txt'), 'utf8'), 'keep me\n');
  assert.ok(!fs.existsSync(path.join(dir, 'AGENTS.md')), 'nothing written');

  const dir2 = repo();
  fs.symlinkSync(outside, path.join(dir2, '.cursor'));
  assert.throws(() => sync({ dir: dir2 }), /symlink/);
});

test('an existing takeoff.mdc without front matter gets a note', () => {
  const dir = repo({ 'takeoff.yaml': fixture('v2.yaml'), '.cursor/rules/takeoff.mdc': 'my notes\n' });
  const r = sync({ dir });
  assert.ok(r.notes.some((n) => /front matter/.test(n)));
  assert.ok(read(dir, '.cursor/rules/takeoff.mdc').startsWith('my notes\n'));
});

test('cli: unknown options are usage errors and write nothing', () => {
  const dir = repo();
  assert.strictEqual(cli(dir, ['sync', '--chek']).code, 2);
  assert.ok(!fs.existsSync(path.join(dir, 'CLAUDE.md')));
  assert.strictEqual(cli(dir, ['validate', '--check']).code, 2);
  assert.strictEqual(cli(dir, ['migrate', '--strict']).code, 2);
});

test('cli: sync takes the file as a positional argument like the other commands', () => {
  const dir = repo({ 'other.yaml': fixture('v2.yaml') });
  const r = cli(dir, ['sync', 'other.yaml']);
  assert.strictEqual(r.code, 0, r.err);
  assert.ok(fs.existsSync(path.join(dir, 'CLAUDE.md')));
});

test('cli: a v1 file with non-email creators and no paths migrates instead of failing', () => {
  const dir = repo({ 'takeoff.yaml': 'name: P\nareas:\n  - name: Docs\n    creator: Samyak\n    rules: [keep it short]\nnever:\n' });
  assert.strictEqual(cli(dir, ['validate']).code, 0);
  const m = cli(dir, ['migrate']);
  assert.strictEqual(m.code, 0, m.err);
  assert.match(m.out, /dropped "Samyak"/);
  const v = cli(dir, ['validate']);
  assert.strictEqual(v.code, 0, v.err);
  assert.match(v.out, /valid \(v2/);
});

test('a YAML alias bomb is reported as an error, not a crash', () => {
  const bomb = ['a: &a [x,x,x,x,x,x,x,x,x,x]', 'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]', 'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]',
    'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c,*c]', 'e: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d,*d]', 'f: [*e,*e,*e,*e,*e,*e,*e,*e,*e,*e]'].join('\n');
  const r = validateText(bomb);
  assert.strictEqual(r.ok, false);
  assert.ok(r.issues.some((i) => /YAML/.test(i.message)));
  const dir = repo({ 'takeoff.yaml': bomb });
  assert.strictEqual(cli(dir, ['validate']).code, 1);
});
