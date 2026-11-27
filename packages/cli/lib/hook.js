'use strict';

// The Claude Code hook. `takeoff hook install` adds two hooks to
// .claude/settings.json:
//
//   UserPromptSubmit → `takeoff hook prompt-submit`: adds, as context for the
//     agent, the intent for the areas this branch changes and any send-back
//     notes reviewers left on the branch's open PR.
//   PostToolUse (Edit, Write, MultiEdit, NotebookEdit) → `takeoff hook
//     post-edit`: after an edit in an area the builder isn't a Creator of,
//     shows a one-line note, once per area per session.
//
// A hook never blocks the agent and never shows an error: whatever goes wrong
// (no git, no takeoff.yaml, GitHub unreachable) ends in no output, and the
// reason goes to .git/takeoff/hook.log. Send-back notes come from a cache
// that a background run refreshes, so a prompt never waits on GitHub once the
// cache is warm.

const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { validateText } = require('./validate');
const { migrateData } = require('./migrate');
const { touchedAreas } = require('./globs');
const { fetchSendBackNotes, repoFromRemote, tokenFrom } = require('./notes');
const { assertNoSymlink, TakeoffError, readIfExists } = require('./sync');
const { FILENAME } = require('./schema');

const NOTES_TTL_MS = 2 * 60 * 1000; // how old cached notes may get before a background refresh
const REFRESH_LOCK_MS = 30 * 1000; // one background refresh at a time
const COLD_FETCH_MS = 2000; // the only time a prompt waits on GitHub: no cache yet
const GIT_TIMEOUT_MS = 2000;
const MAX_CONTEXT = 9000; // Claude Code caps hook context at 10,000 characters
const MAX_PATHS = 5000;
const MAX_NOTES = 5;
const MAX_LOG = 100 * 1024;
const MAX_STDIN = 1024 * 1024;
const MAX_SESSIONS = 50;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const EDIT_MATCHER = 'Edit|Write|MultiEdit|NotebookEdit';
const BIN = path.join(__dirname, '..', 'bin', 'takeoff.js');

// Text from takeoff.yaml or a PR comment becomes agent context: no control
// characters, and each item stays on its own line.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F؜‎‏‪-‮⁦-⁩]/g;
const oneLine = (s) => String(s ?? '').replace(CONTROL, '').replace(/\s+/g, ' ').trim();
const ruleText = (r) => oneLine(typeof r === 'string' ? r : r?.text);

function defaultExec(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: GIT_TIMEOUT_MS }).trim();
}

/** The repo around `cwd`: { root, gitDir, branch }, or null outside git. */
function repoInfo(cwd, exec) {
  let lines;
  try {
    lines = exec('git', ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--abbrev-ref', 'HEAD'], cwd).split('\n');
  } catch {
    // A repo with no commits yet has no HEAD to name.
    try { lines = exec('git', ['rev-parse', '--show-toplevel', '--absolute-git-dir'], cwd).split('\n'); } catch { return null; }
  }
  const [root, gitDir, branch] = lines.map((l) => l.trim());
  if (!root || !gitDir) return null;
  return { root, gitDir, branch: branch && branch !== 'HEAD' ? branch : null };
}

function makeLog(info, now) {
  return (msg) => {
    if (!info) return;
    try {
      const dir = path.join(info.gitDir, 'takeoff');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'hook.log');
      try { if (fs.statSync(file).size > MAX_LOG) fs.renameSync(file, `${file}.old`); } catch { /* no log yet */ }
      fs.appendFileSync(file, `${new Date(now()).toISOString()} ${msg}\n`);
    } catch { /* a log that can't be written stays silent too */ }
  };
}

/** The intent in takeoff.yaml as v2 data, or null when there is none or it doesn't load. */
function loadIntent(root, log) {
  const text = readIfExists(path.join(root, FILENAME));
  if (text === null) return null;
  const r = validateText(text);
  if (!r.ok) {
    log(`${FILENAME} has errors; run \`takeoff validate\`.`);
    return null;
  }
  return r.version === 2 ? r.data : migrateData(r.data).data;
}

/** Paths this branch changes: committed since it left the default branch, plus uncommitted and new files. */
function changedPaths(root, exec) {
  const split = (s) => s.split('\0').map((p) => p.trim()).filter(Boolean);
  let base = null;
  try {
    const refs = new Set(exec('git', ['for-each-ref', '--format=%(refname)', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main', 'refs/remotes/origin/master'], root).split('\n'));
    const ref = ['refs/remotes/origin/HEAD', 'refs/remotes/origin/main', 'refs/remotes/origin/master'].find((r) => refs.has(r));
    if (ref) base = exec('git', ['merge-base', 'HEAD', ref], root) || null;
  } catch { base = null; }
  const out = new Set();
  try {
    for (const p of split(exec('git', ['diff', '--name-only', '-z', base || 'HEAD'], root))) out.add(p);
  } catch { /* no commits yet */ }
  try {
    for (const p of split(exec('git', ['ls-files', '--others', '--exclude-standard', '-z'], root))) out.add(p);
  } catch { /* ignore */ }
  return [...out].slice(0, MAX_PATHS);
}

// ---------------------------------------------------------------------------
// Send-back notes, cached under .git/takeoff/

const branchKey = (branch) => Buffer.from(branch, 'utf8').toString('base64url').slice(0, 120);
const cacheFile = (info) => path.join(info.gitDir, 'takeoff', `notes-${branchKey(info.branch)}.json`);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

/** Fetch the branch's notes from GitHub and cache them. Never throws. */
async function refreshNotes(info, { env, exec, fetchImpl, now, log, timeoutMs = null }) {
  const file = cacheFile(info);
  let notes = [];
  let error = null;
  let repo = null;
  try {
    try { repo = repoFromRemote(exec('git', ['remote', 'get-url', 'origin'], info.root)); } catch { repo = null; }
    if (!repo) throw new Error('origin is not a GitHub repo');
    const token = tokenFrom(env, exec, info.root);
    if (!token) throw new Error('no GitHub sign-in (set GITHUB_TOKEN or run `gh auth login`)');
    if (typeof fetchImpl !== 'function') throw new Error('this Node.js has no fetch');
    const timed = timeoutMs
      ? (url, opts) => fetchImpl(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) })
      : fetchImpl;
    const appSlug = (env.TAKEOFF_APP_SLUG || '').trim() || null;
    notes = await fetchSendBackNotes({ repo, branch: info.branch, token, fetchImpl: timed, appSlug });
  } catch (e) {
    error = String(e?.message || e).slice(0, 300);
    log(`notes for ${info.branch}: ${error}`);
  }
  // A failed read keeps the notes it had: being offline doesn't make a
  // reviewer's note go away.
  const old = readJson(file);
  const kept = error && old?.branch === info.branch ? old.notes : notes;
  const entry = { branch: info.branch, repo, fetchedAt: now(), notes: Array.isArray(kept) ? kept : [], error };
  try { writeJson(file, entry); } catch (e) { log(`couldn't write the notes cache: ${e.message}`); }
  return entry;
}

function defaultSpawnRefresh(info, env) {
  const child = spawn(process.execPath, [BIN, 'hook', 'refresh-notes', '--dir', info.root], {
    cwd: info.root, detached: true, stdio: 'ignore', env, windowsHide: true,
  });
  child.on('error', () => {});
  child.unref();
}

/** Start a background refresh unless one started in the last 30 seconds. */
function startRefresh(info, { env, now, log, spawnRefresh }) {
  const lock = path.join(info.gitDir, 'takeoff', 'refresh.lock');
  try {
    const at = Number(fs.readFileSync(lock, 'utf8'));
    if (Number.isFinite(at) && now() - at < REFRESH_LOCK_MS) return;
  } catch { /* no lock */ }
  try {
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, String(now()));
    spawnRefresh(info, env);
  } catch (e) {
    log(`couldn't start a notes refresh: ${e.message}`);
  }
}

/** The branch's send-back notes: from the cache when there is one, else one short fetch. */
async function notesFor(info, deps) {
  if (!info.branch) return [];
  const cached = readJson(cacheFile(info));
  if (cached && cached.branch === info.branch && Number.isFinite(cached.fetchedAt)) {
    if (deps.now() - cached.fetchedAt > NOTES_TTL_MS) startRefresh(info, deps);
    return Array.isArray(cached.notes) ? cached.notes : [];
  }
  const entry = await refreshNotes(info, { ...deps, timeoutMs: COLD_FETCH_MS });
  return entry.notes;
}

// ---------------------------------------------------------------------------
// prompt-submit

/** The context the agent gets with each prompt, or '' when there is nothing to say. */
function renderContext(intent, touched, notes) {
  const sections = [];
  const shown = notes
    .filter((n) => n && typeof n.note === 'string')
    .sort((a, b) => Number(!!b.current) - Number(!!a.current) || String(b.at || '').localeCompare(String(a.at || '')))
    .slice(0, MAX_NOTES);
  if (shown.length) {
    const lines = ['Reviewers sent this branch\'s pull request back with these notes. Address them before you go on, or say why not:'];
    for (const n of shown) {
      const about = n.current ? '' : ' (about an earlier push)';
      lines.push(`- PR #${Number(n.pr)}${about}${n.at ? `, ${String(n.at).slice(0, 10)}` : ''}:`);
      for (const l of String(n.note).replace(CONTROL, (c) => (c === '\n' ? c : '')).split(/\r?\n/)) {
        if (l.trim()) lines.push(`    ${l.replace(/\s+/g, ' ').trim()}`);
      }
    }
    sections.push(lines.join('\n'));
  }

  if (intent && touched.length) {
    const lines = [
      `What the team agreed for the parts of ${oneLine(intent.product?.name) || 'the product'} this branch changes (from ${FILENAME}).`
        + ' If a change would break one of these, or does something they don\'t cover, say so plainly instead of going ahead quietly: Takeoff checks the pull request against them.',
    ];
    for (const { area, files } of touched) {
      const more = files.length > 3 ? `, and ${files.length - 3} more` : '';
      lines.push('', `${oneLine(area.name)} (${oneLine(area.id)}), changed here: ${files.slice(0, 3).map(oneLine).join(', ')}${more}`);
      if (area.creators?.length) lines.push(`Creators: ${area.creators.map(oneLine).join(', ')}`);
      for (const r of area.rules || []) lines.push(`- Rule: ${ruleText(r)}`);
      for (const r of area.never || []) lines.push(`- Never: ${ruleText(r)}`);
      for (const a of intent.agreements || []) if (a.area === area.id) lines.push(`- Agreed: ${oneLine(a.text)}`);
    }
    const general = (intent.agreements || []).filter((a) => !a.area || !intent.areas.some((x) => x.id === a.area));
    if (general.length) {
      lines.push('', 'Agreed for the whole product:');
      for (const a of general) lines.push(`- ${oneLine(a.text)}`);
    }
    sections.push(lines.join('\n'));
  }

  if (!sections.length) return '';
  let text = `Takeoff:\n\n${sections.join('\n\n')}`;
  if (text.length > MAX_CONTEXT) text = `${text.slice(0, MAX_CONTEXT - 60).replace(/\s+\S*$/, '')}\n… (cut short; the rest is in ${FILENAME})`;
  return text;
}

async function promptSubmit(input, deps) {
  const info = repoInfo(deps.cwdFor(input), deps.exec);
  deps.log = makeLog(info, deps.now);
  if (!info) return null;
  // Only a repo that uses Takeoff gets anything, and only then is GitHub asked.
  if (readIfExists(path.join(info.root, FILENAME)) === null) return null;
  const intent = loadIntent(info.root, deps.log);
  const touched = intent ? touchedAreas(intent, changedPaths(info.root, deps.exec)).touched : [];
  const notes = await notesFor(info, deps);
  const text = renderContext(intent, touched, notes);
  return text ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } } : null;
}

// ---------------------------------------------------------------------------
// post-edit

/** Remember which areas this session was told about; returns the ones that are new. */
function newForSession(info, sessionId, areaIds, now) {
  const file = path.join(info.gitDir, 'takeoff', 'sessions.json');
  const state = readJson(file);
  const sessions = state && typeof state.sessions === 'object' && state.sessions ? state.sessions : {};
  const key = String(sessionId || 'unknown').slice(0, 200);
  const seen = new Set(Array.isArray(sessions[key]?.areas) ? sessions[key].areas : []);
  const fresh = areaIds.filter((id) => !seen.has(id));
  if (!fresh.length) return [];
  for (const id of fresh) seen.add(id);
  sessions[key] = { at: now(), areas: [...seen] };
  const keep = Object.entries(sessions)
    .filter(([, v]) => Number.isFinite(v?.at) && now() - v.at < SESSION_TTL_MS)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_SESSIONS);
  writeJson(file, { sessions: Object.fromEntries(keep) });
  return fresh;
}

const plural = (list, one, many) => `${list.length === 1 ? one : many}: ${list.join(', ')}`;

async function postEdit(input, deps) {
  if (!EDIT_TOOLS.has(input.tool_name)) return null;
  const target = input.tool_input?.file_path || input.tool_input?.notebook_path;
  if (typeof target !== 'string' || !target) return null;
  const cwd = deps.cwdFor(input);
  const info = repoInfo(cwd, deps.exec);
  deps.log = makeLog(info, deps.now);
  if (!info) return null;
  const rel = path.relative(info.root, path.resolve(cwd, target)).split(path.sep).join('/');
  if (!rel || rel.startsWith('../') || rel === '..' || path.isAbsolute(rel)) return null;
  const intent = loadIntent(info.root, deps.log);
  if (!intent) return null;
  let email = null;
  try { email = deps.exec('git', ['config', 'user.email'], info.root).toLowerCase() || null; } catch { email = null; }
  const areas = touchedAreas(intent, [rel]).touched.map((t) => t.area)
    .filter((a) => (a.creators?.length || a.rules?.length || a.never?.length))
    .filter((a) => !email || !(a.creators || []).some((c) => String(c).toLowerCase() === email));
  if (!areas.length) return null;
  const fresh = new Set(newForSession(info, input.session_id, areas.map((a) => a.id), deps.now));
  const show = areas.filter((a) => fresh.has(a.id));
  if (!show.length) return null;

  const parts = show.map((a) => {
    const who = (a.creators || []).map(oneLine);
    return who.length ? `${oneLine(a.name)} (${plural(who, 'Creator', 'Creators')})` : oneLine(a.name);
  });
  const line = `Takeoff: this touches ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]}. It'll be flagged on the PR if it drifts.`;
  const rules = show.flatMap((a) => [
    ...(a.rules || []).map((r) => `- ${oneLine(a.name)} rule: ${ruleText(r)}`),
    ...(a.never || []).map((r) => `- ${oneLine(a.name)} never: ${ruleText(r)}`),
  ]);
  let context = `${line} ${email ? 'You are not a Creator of this area, so' : 'So'} check the change against its rules${rules.length ? ':\n' : '.'}${rules.join('\n')}`;
  if (context.length > MAX_CONTEXT) context = `${context.slice(0, MAX_CONTEXT - 40)}\n… (see ${FILENAME})`;
  return { systemMessage: line, hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: context } };
}

// ---------------------------------------------------------------------------
// install

const COMMAND_RE = /^[A-Za-z0-9_@./:+=-]+(?: [A-Za-z0-9_@./:+=-]+)*$/;

function installCommand({ dir, args, out, err, exec }) {
  const program = args.command || 'takeoff';
  if (program.length > 200 || !COMMAND_RE.test(program)) {
    err('--command must be a plain command, like "takeoff" or "npx takeoff".');
    return 2;
  }
  let root = dir;
  try { root = exec('git', ['rev-parse', '--show-toplevel'], dir) || dir; } catch { root = dir; }
  const rel = `.claude/${args.flags.has('--local') ? 'settings.local.json' : 'settings.json'}`;
  const file = path.join(root, rel);
  try {
    assertNoSymlink(root, rel);
  } catch (e) {
    if (e instanceof TakeoffError) { err(e.message); return 1; }
    throw e;
  }
  const text = readIfExists(file);
  let settings = {};
  if (text !== null && text.trim()) {
    try { settings = JSON.parse(text); } catch {
      err(`${rel} isn't valid JSON, so nothing was changed. Fix it, then run this again.`);
      return 1;
    }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      err(`${rel} isn't a JSON object, so nothing was changed.`);
      return 1;
    }
  }
  if (settings.hooks !== undefined && (typeof settings.hooks !== 'object' || settings.hooks === null || Array.isArray(settings.hooks))) {
    err(`"hooks" in ${rel} isn't an object, so nothing was changed.`);
    return 1;
  }
  settings.hooks = settings.hooks || {};
  const wanted = [
    { event: 'UserPromptSubmit', matcher: null, command: `${program} hook prompt-submit` },
    { event: 'PostToolUse', matcher: EDIT_MATCHER, command: `${program} hook post-edit` },
  ];
  let changed = false;
  for (const w of wanted) {
    const groups = settings.hooks[w.event];
    if (groups !== undefined && !Array.isArray(groups)) {
      err(`"hooks.${w.event}" in ${rel} isn't a list, so nothing was changed.`);
      return 1;
    }
    const list = groups || [];
    const has = list.some((g) => Array.isArray(g?.hooks) && g.hooks.some((h) => h?.type === 'command' && h.command === w.command));
    if (has) {
      out(`unchanged  ${w.event} hook (${w.command})`);
      continue;
    }
    list.push({ ...(w.matcher ? { matcher: w.matcher } : {}), hooks: [{ type: 'command', command: w.command, timeout: 10 }] });
    settings.hooks[w.event] = list;
    changed = true;
    out(`added      ${w.event} hook (${w.command})`);
  }
  if (changed) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
    out(`Wrote ${rel}. Claude Code picks the hooks up in its next session.`);
  }
  return 0;
}

// ---------------------------------------------------------------------------

function readStdin(stdin) {
  if (typeof stdin === 'string') return stdin.slice(0, MAX_STDIN);
  try {
    const buf = Buffer.alloc(MAX_STDIN);
    let n = 0;
    for (;;) {
      let r;
      try { r = fs.readSync(0, buf, n, MAX_STDIN - n, null); } catch (e) {
        if (e.code === 'EAGAIN') continue;
        if (e.code === 'EOF') break;
        throw e;
      }
      if (!r) break;
      n += r;
      if (n >= MAX_STDIN) break;
    }
    return buf.subarray(0, n).toString('utf8');
  } catch {
    return '';
  }
}

const USAGE = 'Usage: takeoff hook install [--local] [--command <cmd>]\n       takeoff hook prompt-submit | post-edit   (run by Claude Code)';

/**
 * `takeoff hook <install|prompt-submit|post-edit|refresh-notes>`
 * @returns {number|Promise<number>} exit code. The hooks themselves always exit 0.
 */
function hookCommand({ dir, args, out, err, env = process.env, exec = defaultExec, fetchImpl = globalThis.fetch, stdin, now = Date.now, spawnRefresh = defaultSpawnRefresh }) {
  const sub = args._[1];
  if (sub === 'install') return installCommand({ dir, args, out, err, exec });
  const handlers = { 'prompt-submit': promptSubmit, 'post-edit': postEdit };
  const deps = {
    env, exec, fetchImpl, now, spawnRefresh, log: () => {},
    cwdFor: (input) => (typeof input?.cwd === 'string' && input.cwd ? input.cwd : env.CLAUDE_PROJECT_DIR || dir),
  };
  if (sub === 'refresh-notes') {
    return (async () => {
      try {
        const info = repoInfo(dir, exec);
        if (info?.branch) await refreshNotes(info, { ...deps, log: makeLog(info, now) });
      } catch { /* silent */ }
      return 0;
    })();
  }
  const handler = handlers[sub];
  if (!handler) {
    err(USAGE);
    return 2;
  }
  return (async () => {
    try {
      let input = {};
      try { input = JSON.parse(readStdin(stdin) || '{}'); } catch { input = {}; }
      if (!input || typeof input !== 'object') input = {};
      const result = await handler(input, deps);
      if (result) out(JSON.stringify(result));
    } catch (e) {
      try { deps.log(`${sub} failed: ${e?.stack || e}`); } catch { /* silent */ }
    }
    return 0;
  })();
}

module.exports = { hookCommand, renderContext, changedPaths, repoInfo, NOTES_TTL_MS };
