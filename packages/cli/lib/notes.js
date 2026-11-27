'use strict';

// Send-back notes. When a reviewer sends a drifting PR back in Takeoff, the
// Takeoff GitHub App posts the note as a PR comment with a hidden marker that
// holds the exact note. `takeoff notes` reads those comments for the current
// branch's open PR, so a builder (or their AI agent's hook) gets the note
// without a Takeoff account: their own GitHub access is enough.
//
// Only a comment that a GitHub App posted, and that starts with the marker,
// counts, so a note typed by a person, or quoted by another bot, can't pose as
// a reviewer's. Set TAKEOFF_APP_SLUG to the Takeoff App's slug to count only
// its comments; without it, common bots that post on behalf of anyone (like
// GitHub Actions) are left out, and each note says which App posted it.

const { execFileSync } = require('child_process');

const MARKER_RE = /<!-- takeoff:send-back id=([A-Za-z0-9_-]{1,80}) sha=([0-9a-f]{7,64}) note=([A-Za-z0-9_-]{0,20000}) -->/;
const MAX_NOTE = 4000;

function sendBackMarker({ id, sha, note }) {
  const enc = Buffer.from(String(note), 'utf8').toString('base64url');
  return `<!-- takeoff:send-back id=${id} sha=${sha} note=${enc} -->`;
}

/** The send-back note in a comment body, or null. */
function parseSendBack(body) {
  const m = MARKER_RE.exec(String(body || ''));
  if (!m) return null;
  let note;
  try {
    note = Buffer.from(m[3], 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!note.trim() || note.length > MAX_NOTE) return null;
  return { id: m[1], sha: m[2], note };
}

/** "owner/repo" from a GitHub remote URL (https or ssh), or null. */
function repoFromRemote(url) {
  const m = /github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(String(url || '').trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

function defaultExec(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
}

function tokenFrom(env, exec, cwd) {
  const t = (env.GITHUB_TOKEN || env.GH_TOKEN || '').trim();
  if (t) return t;
  try {
    return exec('gh', ['auth', 'token'], cwd) || null;
  } catch {
    return null;
  }
}

class NotesError extends Error {}

// Apps that post whatever a workflow or a config tells them to.
const UNTRUSTED_APPS = new Set(['github-actions', 'dependabot', 'renovate', 'copilot', 'copilot-swe-agent']);

/** The posting App's slug when `c` is a comment a GitHub App posted, else null. */
function postingApp(c, appSlug) {
  if (c?.user?.type !== 'Bot') return null;
  const app = String(c.performed_via_github_app?.slug || '').toLowerCase();
  if (!app || String(c.user.login || '').toLowerCase() !== `${app}[bot]`) return null;
  if (appSlug) return app === appSlug.toLowerCase() ? app : null;
  return UNTRUSTED_APPS.has(app) ? null : app;
}

async function getJson(fetchImpl, token, path) {
  let res;
  try {
    res = await fetchImpl(`https://api.github.com${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'takeoff-cli',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch (e) {
    throw new NotesError(`Couldn't reach GitHub: ${e.message}`);
  }
  if (res.status === 401) throw new NotesError('GitHub rejected the token. Set GITHUB_TOKEN to a token that can read this repo, or sign in again with `gh auth login`.');
  if (res.status === 404) throw new NotesError("GitHub can't find that repo with this token.");
  if (!res.ok) throw new NotesError(`GitHub answered ${res.status}.`);
  try {
    return await res.json();
  } catch {
    throw new NotesError('GitHub sent an answer Takeoff couldn\'t read.');
  }
}

function edited(c) {
  const made = Date.parse(c.created_at);
  const changed = Date.parse(c.updated_at);
  return Number.isFinite(made) && Number.isFinite(changed) && changed - made > 5000;
}

// Control characters (terminal escape codes among them) are never printed:
// a note is text for a person or an agent, not instructions to a terminal.
// Nor are characters nobody can see but a model reads: zero-width ones and
// Unicode tag characters, which can spell out hidden text.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u{E0000}-\u{E007F}]/gu;
const printable = (t) => String(t ?? '').replace(CONTROL, '');

/**
 * Send-back notes on the open PR(s) for `branch`.
 * @returns {Promise<Array<{ pr: number, prUrl: string, id: string, sha: string, note: string, by: string, at: string, current: boolean }>>}
 */
async function fetchSendBackNotes({ repo, branch, token, fetchImpl = globalThis.fetch, appSlug = null }) {
  const [owner, name] = repo.split('/');
  const q = (s) => encodeURIComponent(s);
  const pulls = await getJson(fetchImpl, token, `/repos/${q(owner)}/${q(name)}/pulls?state=open&per_page=10&head=${q(`${owner}:${branch}`)}`);
  const out = [];
  for (const pr of Array.isArray(pulls) ? pulls : []) {
    for (let page = 1; page <= 10; page += 1) {
      const comments = await getJson(fetchImpl, token, `/repos/${q(owner)}/${q(name)}/issues/${Number(pr.number)}/comments?per_page=100&page=${page}`);
      if (!Array.isArray(comments) || !comments.length) break;
      for (const c of comments) {
        const app = postingApp(c, appSlug);
        const firstLine = String(c.body || '').split('\n', 1)[0];
        if (!app || !firstLine.startsWith('<!-- takeoff:send-back ')) continue;
        const parsed = parseSendBack(firstLine);
        if (!parsed) continue;
        // Takeoff never edits a note it posted. Anyone with write access can
        // edit the App's comment, so an edited one no longer says what the
        // reviewer sent.
        if (edited(c)) continue;
        out.push({
          pr: Number(pr.number),
          prUrl: pr.html_url,
          ...parsed,
          note: printable(parsed.note),
          by: printable(app),
          at: c.created_at,
          current: !!pr.head?.sha && pr.head.sha.startsWith(parsed.sha),
        });
      }
      if (comments.length < 100) break;
    }
  }
  return out;
}

/**
 * `takeoff notes [--branch <name>] [--repo <owner/name>] [--json]`
 * @returns {Promise<number>} exit code
 */
async function notesCommand({ dir, args, out, err, env = process.env, exec = defaultExec, fetchImpl = globalThis.fetch }) {
  const json = args.flags.has('--json');
  try {
    let branch = args.branch;
    if (!branch) {
      try { branch = exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], dir); } catch { branch = null; }
    }
    if (!branch || branch === 'HEAD') throw new NotesError('Not on a branch. Pass --branch <name>.');
    let repo = args.repo;
    if (!repo) {
      try { repo = repoFromRemote(exec('git', ['remote', 'get-url', 'origin'], dir)); } catch { repo = null; }
    }
    if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new NotesError('Couldn\'t tell which GitHub repo this is. Pass --repo <owner/name>.');
    const token = tokenFrom(env, exec, dir);
    if (!token) throw new NotesError('Set GITHUB_TOKEN, or sign in with `gh auth login`, so Takeoff can read the PR.');
    if (typeof fetchImpl !== 'function') throw new NotesError('This Node.js has no fetch. Use Node 18 or newer.');
    const appSlug = (env.TAKEOFF_APP_SLUG || '').trim() || null;
    const notes = await fetchSendBackNotes({ repo, branch, token, fetchImpl, appSlug });
    if (json) {
      out(JSON.stringify({ repo, branch, notes }, null, 2));
      return 0;
    }
    if (!notes.length) {
      out(`No send-back notes for ${branch}.`);
      return 0;
    }
    for (const n of notes) {
      out(`Sent back on PR #${n.pr} (${n.at ? n.at.slice(0, 10) : 'date unknown'}${n.current ? '' : ', about an earlier push'}${appSlug ? '' : `, posted by ${n.by}`}):`);
      for (const line of n.note.split(/\r?\n/)) out(`  ${line}`);
      out('');
    }
    return 0;
  } catch (e) {
    if (e instanceof NotesError) {
      if (json) out(JSON.stringify({ error: e.message, notes: [] }));
      else err(e.message);
      return 1;
    }
    throw e;
  }
}

module.exports = { sendBackMarker, parseSendBack, repoFromRemote, fetchSendBackNotes, notesCommand, tokenFrom, printable, NotesError, MAX_SEND_BACK_NOTE: MAX_NOTE };
