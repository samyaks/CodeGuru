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
  if (/access_tokens/.test(msg) || err?.status === 403 || err?.status === 401) {
    return `Takeoff's GitHub App can't write to ${project.owner}/${project.repo}. Approve its new permissions (Contents: read and write) in GitHub, then try again.`;
  }
  if (err?.status === 404) return `Takeoff's GitHub App can't see ${project.owner}/${project.repo} any more. Reinstall it on the repo, then try again.`;
  return `Couldn't commit to GitHub: ${msg.slice(0, 300)}`;
}

/** One try at writing the commit on top of the branch head. */
async function writeOnce({ gh, project, agreement, entry, coAuthors }) {
  const { owner, repo } = project;
  const meta = await gh.fetchRepoMeta(owner, repo);
  const base = meta.default_branch || 'main';
  const branch = await gh.fetchBranch(owner, repo, base);
  const headSha = branch.commit.sha;

  const yamlText = await gh.fetchFileTextOrNull(owner, repo, FILENAME, headSha);
  if (yamlText === null) throw new AgreementError(`There's no ${FILENAME} on ${base} yet, so there's nowhere to record the agreement.`, 'no_yaml');
  const { text: nextYaml, data, alreadyThere } = addAgreement(yamlText, entry);
  if (alreadyThere) return { state: 'committed', sha: headSha, url: `https://github.com/${owner}/${repo}/commit/${headSha}`, alreadyThere: true };

  const current = {};
  for (const p of AGENT_FILE_PATHS) current[p] = await gh.fetchFileTextOrNull(owner, repo, p, headSha);
  const agentFiles = renderAgentFiles(data, current).filter((f) => f.changed);
  const files = [{ path: FILENAME, content: nextYaml }, ...agentFiles.map((f) => ({ path: f.path, content: f.text }))];

  const parent = await gh.fetchGitCommit(owner, repo, headSha);
  const tree = await gh.createTextTree(owner, repo, parent.tree.sha, files);
  const commit = await gh.createGitCommit(owner, repo, { message: commitMessage(agreement, coAuthors), tree: tree.sha, parents: [headSha] });
  const url = `https://github.com/${owner}/${repo}/commit/${commit.sha}`;

  const openPr = async () => {
    const head = `takeoff/${agreement.id}`;
    try {
      await gh.createBranchRef(owner, repo, head, commit.sha);
    } catch (err) {
      if (err.status !== 422) throw err;
      await gh.updateBranchRef(owner, repo, head, commit.sha, { force: true }); // our own branch from an earlier try
    }
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
    return { state: 'committed', sha: commit.sha, url };
  } catch (err) {
    if (err.status === 422 && /protected/i.test(err.message)) return openPr();
    if (err.status === 422) {
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
  const claimed = await deps.agreements.claimCommit(agreementId);
  if (!claimed) {
    const row = await deps.agreements.getById(agreementId);
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
      agreed_by: (agreement.agreed_by_emails || []).map((e) => String(e).toLowerCase()),
      agreed_on: new Date(agreement.decided_at || deps.now()).toISOString().slice(0, 10),
      source: agreement.source || undefined,
    };
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
    await deps.agreements.setCommit(agreement.id, { state: out.state, sha: out.sha, url: out.url, prUrl: out.prUrl || null });
    if (deps.onCommitted) await deps.onCommitted(project.id);
    return out;
  } catch (err) {
    const message = friendly(err, project);
    await deps.agreements.setCommit(agreement.id, { state: 'failed', error: message }).catch(() => {});
    throw new AppError(message, 502, err instanceof AgreementError ? `AGREEMENT_${String(err.code).toUpperCase()}` : 'COMMIT_FAILED');
  }
}

module.exports = { commitAgreement, commitMessage, defaultWriteClient, friendly };
