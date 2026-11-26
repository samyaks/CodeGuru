'use strict';

// Send-back notes. When a reviewer sends a drifting PR back in Takeoff, the
// Takeoff GitHub App posts the note as a PR comment with a hidden marker that
// holds the exact note. `takeoff notes` reads those comments for the current
// branch's open PR, so a builder (or their AI agent's hook) gets the note
// without a Takeoff account: their own GitHub access is enough.
//
// Only comments posted by a GitHub App (a Bot account) count, so a note typed
// by anyone else on the PR can't pose as a reviewer's.

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

async function getJson(fetchImpl, token, path) {
  const res = await fetchImpl(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'takeoff-cli',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (res.status === 401) throw new NotesError('GitHub rejected the token. Set GITHUB_TOKEN to a token that can read this repo, or sign in again with `gh auth login`.');
  if (res.status === 404) throw new NotesError("GitHub can't find that repo with this token.");
  if (!res.ok) throw new NotesError(`GitHub answered ${res.status}.`);
  return res.json();
}

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
        if (c?.user?.type !== 'Bot') continue;
        if (appSlug && String(c.user.login).toLowerCase() !== `${appSlug}[bot]`.toLowerCase()) continue;
        const parsed = parseSendBack(c.body);
        if (!parsed) continue;
        out.push({
          pr: Number(pr.number),
          prUrl: pr.html_url,
          ...parsed,
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
      out(`Sent back on PR #${n.pr} (${n.at ? n.at.slice(0, 10) : 'date unknown'}${n.current ? '' : ', about an earlier push'}):`);
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

module.exports = { sendBackMarker, parseSendBack, repoFromRemote, fetchSendBackNotes, notesCommand, NotesError, MAX_SEND_BACK_NOTE: MAX_NOTE };
