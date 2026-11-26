'use strict';

// Committing an accepted agreement into takeoff.yaml, with the agent files
// regenerated in the same commit, on the repo's default branch. A protected
// default branch gets a small pull request instead. Runs as the Takeoff
// GitHub App installation (needs Contents: write; Pull requests: write for
// the protected-branch case).
//
// Safe to run twice: an agreement already in takeoff.yaml is not added again,
// and only one runner holds the commit claim at a time.

const { addAgreement, renderAgentFiles, AGENT_FILE_PATHS, AgreementError, FILENAME } = require('@takeoff/cli');
const { AppError } = require('../../lib/app-error');

const MAX_FAST_FORWARD_RETRIES = 3;
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function defaultWriteClient(project) {
  const { getGithubApp } = require('../../lib/github-app');
  return getGithubApp().clientForInstallation(Number(project.github_installation_id), {
    repo: project.repo,
    permissions: { contents: 'write', metadata: 'read' },
    optional: { pull_requests: 'write' },
  });
}

/** `takeoff: agreement <id> — <text>` plus Co-authored-by trailers. */
function commitMessage(agreement, coAuthors) {
  const text = oneLine(agreement.text);
  const subject = `takeoff: agreement ${agreement.id} — ${text.length > 72 ? `${text.slice(0, 71)}…` : text}`;
  const lines = [subject, ''];
  if (text.length > 72) lines.push(text, '');
  lines.push(`Agreed in Takeoff by ${(agreement.agreed_by_emails || []).length} member(s).`);
  const trailers = coAuthors.map((c) => `Co-authored-by: ${c.name} <${c.githubUserId}+${c.githubLogin}@users.noreply.github.com>`);
  if (trailers.length) lines.push('', ...trailers);
  return lines.join('\n');
}

/** Agreeing members with GitHub connected, for the commit trailers. */
async function coAuthorsFor(agreement, votes, deps) {
  const agreeing = votes.filter((v) => v.vote === 'agree').map((v) => v.user_id);
  if (agreement.decided_by && !agreeing.includes(agreement.decided_by)) agreeing.push(agreement.decided_by);
  const out = [];
  for (const userId of agreeing) {
    const link = await deps.userGithubLinks.get(userId).catch(() => null);
    if (link?.github_login && link?.github_user_id) {
      const login = String(link.github_login).replace(/[^A-Za-z0-9-]/g, '');
      if (login) out.push({ name: login, githubLogin: login, githubUserId: Number(link.github_user_id) });
    }
  }
  return out;
}

function friendly(err, project) {
  if (err instanceof AgreementError) return err.message;
  const msg = String(err?.message || err);
  if (/rate limit/i.test(msg)) return 'GitHub\'s rate limit for this repo is used up for now. Try again in a while.';
  if (err?.prPath && (err?.status === 403 || /access_tokens/.test(msg))) {
    return `${project.owner}/${project.repo}'s default branch is protected, so Takeoff needs to open a pull request. Approve the GitHub App's new permissions (Pull requests: read and write), then try again.`;
  }
  if (/access_tokens/.test(msg) || err?.status === 403 || err?.status === 401) {
    return `Takeoff's GitHub App can't write to ${project.owner}/${project.repo}. Approve its new permissions (Contents: read and write) in GitHub, then try again.`;
  }
  if (err?.status === 404) return `Takeoff's GitHub App can't see ${project.owner}/${project.repo} any more. Reinstall it on the repo, then try again.`;
  return `Couldn't commit to GitHub: ${msg.slice(0, 300)}`;
}

const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
const MAX_TEXT_BYTES = 900 * 1024; // the contents API stops returning content at 1 MB

/** The tree entry at `path` in the commit's tree, or null. */
async function treeEntry(gh, owner, repo, rootTree, path, cache) {
  const parts = path.split('/');
  let tree = rootTree;
  for (let i = 0; i < parts.length; i += 1) {
    if (!cache.has(tree)) cache.set(tree, await gh.fetchTreeEntries(owner, repo, tree));
    const entry = cache.get(tree).find((e) => e.path === parts[i]);
    if (!entry) return null;
    if (i === parts.length - 1) return entry;
    if (entry.type !== 'tree') return entry; // a file or link where a folder should be
    tree = entry.sha;
  }
  return null;
}

/** Whether Takeoff can safely replace the file at this entry with text. */
const writable = (entry) => !entry || (entry.type === 'blob' && entry.mode !== '120000' && (entry.size ?? 0) <= MAX_TEXT_BYTES);

/** One try at writing the commit on top of the branch head. */
async function writeOnce({ gh, project, agreement, entry, coAuthors }) {
  const { owner, repo } = project;
  const meta = await gh.fetchRepoMeta(owner, repo);
  const base = meta.default_branch || 'main';
  const branch = await gh.fetchBranch(owner, repo, base);
  const headSha = branch.commit.sha;

  const parent = await gh.fetchGitCommit(owner, repo, headSha);
  const trees = new Map();
  const yamlEntry = await treeEntry(gh, owner, repo, parent.tree.sha, FILENAME, trees);
  const yamlText = yamlEntry ? await gh.fetchFileTextOrNull(owner, repo, FILENAME, headSha) : null;
  if (!yamlEntry || yamlText === null) {
    if (yamlEntry && !writable(yamlEntry)) throw new AgreementError(`${FILENAME} on ${base} is a link or too big for Takeoff to edit. Make it a plain file, then try again.`, 'yaml_not_plain');
    throw new AgreementError(`There's no ${FILENAME} on ${base} yet, so there's nowhere to record the agreement.`, 'no_yaml');
  }
  if (!writable(yamlEntry)) throw new AgreementError(`${FILENAME} on ${base} is a link or too big for Takeoff to edit. Make it a plain file, then try again.`, 'yaml_not_plain');
  const { text: nextYaml, data, alreadyThere } = addAgreement(yamlText, entry);
  // Already recorded (an earlier run got this far): nothing to write, and the
  // head isn't the commit that added it, so record no link.
  if (alreadyThere) return { state: 'committed', sha: null, url: null, alreadyThere: true };

  // Agent files that are links (AGENTS.md -> CLAUDE.md is common), not plain
  // files, or too big to read are left as they are.
  const current = {};
  const skipped = [];
  for (const p of AGENT_FILE_PATHS) {
    const e = await treeEntry(gh, owner, repo, parent.tree.sha, p, trees);
    if (!writable(e)) { skipped.push(p); continue; }
    current[p] = e ? await gh.fetchFileTextOrNull(owner, repo, p, headSha) : null;
    if (e && current[p] === null) skipped.push(p);
  }
  const agentFiles = renderAgentFiles(data, current).filter((f) => f.changed && !skipped.includes(f.path));
  const files = [{ path: FILENAME, content: nextYaml }, ...agentFiles.map((f) => ({ path: f.path, content: f.text }))];
  const tree = await gh.createTextTree(owner, repo, parent.tree.sha, files);
  const commit = await gh.createGitCommit(owner, repo, { message: commitMessage(agreement, coAuthors), tree: tree.sha, parents: [headSha] });
  const url = `https://github.com/${owner}/${repo}/commit/${commit.sha}`;

  const openPr = async () => {
    const head = `takeoff/${agreement.id}`;
    try {
      try {
        await gh.createBranchRef(owner, repo, head, commit.sha);
      } catch (err) {
        if (err.status !== 422) throw err;
        // The branch is there from an earlier try. If its pull request is
        // still open, leave it alone (a reviewer may have pushed to it).
        const open = await gh.findOpenPullByHead(owner, repo, head, base);
        if (open) return { state: 'pr_opened', sha: null, url: null, prUrl: open.html_url };
        await gh.updateBranchRef(owner, repo, head, commit.sha, { force: true });
      }
      return await createPr(head);
    } catch (err) {
      err.prPath = true;
      throw err;
    }
  };

  const createPr = async (head) => {
    const existing = await gh.findOpenPullByHead(owner, repo, head, base);
    const pr = existing || await gh.createPullRequest(owner, repo, {
      title: `takeoff: agreement — ${oneLine(agreement.text).slice(0, 80)}`,
      head,
      base,
      body: [
        'The team agreed on this in Takeoff:',
        '',
        `> ${oneLine(agreement.text)}`,
        '',
        `${base} is protected, so Takeoff opened this pull request instead of committing directly. It adds the agreement to \`${FILENAME}\` and regenerates the agent files.`,
      ].join('\n'),
    });
    return { state: 'pr_opened', sha: commit.sha, url, prUrl: pr.html_url };
  };

  if (branch.protected) return openPr();
  try {
    await gh.updateBranchRef(owner, repo, base, commit.sha);
    return { state: 'committed', sha: commit.sha, url, skipped };
  } catch (err) {
    // Branch protection or a ruleset that requires pull requests.
    if ((err.status === 422 || err.status === 403) && /protected|rule|pull request/i.test(err.message)) return openPr();
    if (err.status === 422 && /fast.?forward/i.test(err.message)) {
      const e = new Error('branch moved');
      e.retry = true;
      throw e;
    }
    throw err;
  }
}

/**
 * Commit accepted agreement `agreementId`. Records the outcome on the row.
 * @returns {Promise<{ state: string, sha?: string, url?: string, prUrl?: string, alreadyThere?: boolean }>}
 */
async function commitAgreement({ project, agreementId }, deps) {
  const claimed = await deps.agreements.claimCommit(project.id, agreementId);
  if (!claimed) {
    const row = await deps.agreements.get(project.id, agreementId);
    if (row && ['committed', 'pr_opened'].includes(row.commit_state)) {
      return { state: row.commit_state, sha: row.commit_sha, url: row.commit_url, prUrl: row.commit_pr_url, alreadyThere: true };
    }
    throw AppError.conflict(row?.status !== 'accepted' ? 'Only an accepted agreement can be committed.' : 'Takeoff is already committing this agreement.');
  }
  const agreement = claimed;
  try {
    const votes = await deps.agreementVotes.listFor([agreement.id]);
    const entry = {
      id: agreement.id,
      text: oneLine(agreement.text),
      area: agreement.area_id || undefined,
      agreed_by: [...new Set((agreement.agreed_by_emails || []).map((e) => String(e).trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)))],
      agreed_on: new Date(agreement.decided_at || deps.now()).toISOString().slice(0, 10),
      source: agreement.source || undefined,
    };
    if (!entry.agreed_by.length) {
      throw new AgreementError(`${FILENAME} records who agreed by email address, and none of the people who agreed have one Takeoff can record. Add an email to your account, then try again.`, 'no_emails');
    }
    const coAuthors = await coAuthorsFor(agreement, votes, deps);
    const gh = deps.writeClientFor(project);
    let out;
    for (let attempt = 1; ; attempt += 1) {
      try {
        out = await writeOnce({ gh, project, agreement, entry, coAuthors });
        break;
      } catch (err) {
        if (!err.retry || attempt >= MAX_FAST_FORWARD_RETRIES) {
          throw err.retry ? new Error(`${project.owner}/${project.repo} kept changing while Takeoff committed. Try again.`) : err;
        }
      }
    }
    // Lands only while this run still holds the claim (a stale takeover wins).
    const claim = { from: ['committing'], claimedAt: agreement.commit_attempted_at || null };
    await deps.agreements.setCommit(agreement.id, { state: out.state, sha: out.sha, url: out.url, prUrl: out.prUrl || null, ...claim });
    if (out.skipped?.length) console.warn(`[agreements] ${agreement.id}: left ${out.skipped.join(', ')} as they are (a link, not a plain file, or too big)`);
    if (deps.onCommitted) await deps.onCommitted(project.id);
    return out;
  } catch (err) {
    const message = friendly(err, project);
    await deps.agreements.setCommit(agreement.id, { state: 'failed', error: message, from: ['committing'], claimedAt: agreement.commit_attempted_at || null }).catch(() => {});
    throw new AppError(message, 502, err instanceof AgreementError ? `AGREEMENT_${String(err.code).toUpperCase()}` : 'COMMIT_FAILED');
  }
}

module.exports = { commitAgreement, commitMessage, defaultWriteClient, friendly, treeEntry, writable, MAX_TEXT_BYTES };
