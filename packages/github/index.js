const GITHUB_API = 'https://api.github.com';

// `token === undefined` means "use the server's GITHUB_TOKEN"; pass an
// explicit token (e.g. a GitHub App installation token) to act as that
// identity instead. `null` sends no Authorization header at all.
function headers(token) {
  const h = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'CodeGuru-Reviewer',
  };
  const t = token === undefined ? process.env.GITHUB_TOKEN : token;
  if (t) {
    h['Authorization'] = `Bearer ${t}`;
  }
  return h;
}

/**
 * Refuses a path with a `.` or `..` segment (raw or percent-encoded). Callers
 * splice route params such as a sha or branch into `/repos/:owner/:repo/...`;
 * without this, `../../other-repo/...` would reach a different repo with the
 * same credentials (fetch collapses dot segments).
 */
function assertSafePath(urlPath) {
  const pathPart = String(urlPath).replace(/^https?:\/\/[^/]+/, '').split(/[?#]/)[0];
  for (const raw of pathPart.split('/')) {
    let seg = raw;
    try { seg = decodeURIComponent(raw); } catch { /* keep raw */ }
    if (seg === '.' || seg === '..' || seg.includes('/') || seg.includes('\\')) {
      const err = new Error(`Refusing GitHub API path with a traversal segment: ${pathPart}`);
      err.status = 400;
      throw err;
    }
  }
}

async function githubFetch(urlPath, opts = {}) {
  assertSafePath(urlPath);
  const { token, ...fetchOpts } = opts;
  const url = urlPath.startsWith('http') ? urlPath : `${GITHUB_API}${urlPath}`;
  const res = await fetch(url, { ...fetchOpts, headers: { ...headers(token), ...fetchOpts.headers } });

  const remaining = res.headers.get('x-ratelimit-remaining');
  if (remaining !== null && parseInt(remaining, 10) < 10) {
    console.warn(`GitHub API rate limit low: ${remaining} requests remaining`);
  }

  if (!res.ok) {
    const body = await res.text();
    let message = `GitHub API ${res.status}: ${body}`;
    if (res.status === 404 && token === undefined && !process.env.GITHUB_TOKEN) {
      message = `Repository not found. If this is a private repo, set GITHUB_TOKEN in .env. If public, you may have hit the unauthenticated rate limit (60 req/hr). Original: ${body}`;
    }
    if (res.status === 403 && /rate limit/i.test(body)) {
      message = `GitHub API rate limit exceeded. Set GITHUB_TOKEN in .env to increase limits. Original: ${body}`;
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return res;
}

function parseRepoUrl(repoUrl) {
  const match = repoUrl.replace(/\.git$/, '').match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) throw new Error(`Invalid GitHub URL: ${repoUrl}`);
  return { owner: match[1], repo: match[2] };
}

function parsePRUrl(prUrl) {
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (match) {
    return { owner: match[1], repo: match[2], prNumber: parseInt(match[3], 10) };
  }
  return null;
}

/**
 * Repo-reading API bound to one identity. `createClient()` uses the server's
 * GITHUB_TOKEN; `createClient({ token })` reads as that token instead (a
 * GitHub App installation token for private repos). `token` may also be an
 * async getter, so short-lived tokens are re-resolved on every request.
 */
function createClient({ token, onUnauthorized } = {}) {
  const resolveToken = async () => (typeof token === 'function' ? token() : token);
  const request = async (urlPath, opts = {}) => {
    try {
      return await githubFetch(urlPath, { ...opts, token: await resolveToken() });
    } catch (err) {
      // A cached token that GitHub no longer accepts (e.g. the installation
      // was just removed): drop it and try once more with a fresh one.
      if (err && err.status === 401 && onUnauthorized) {
        await onUnauthorized();
        return githubFetch(urlPath, { ...opts, token: await resolveToken() });
      }
      throw err;
    }
  };
  const q = (v) => encodeURIComponent(String(v));

  async function fetchPullRequest(owner, repo, prNumber) {
    const res = await request(`/repos/${owner}/${repo}/pulls/${prNumber}`);
    return res.json();
  }

  async function fetchPRDiff(owner, repo, prNumber) {
    const res = await request(`/repos/${owner}/${repo}/pulls/${prNumber}`, {
      headers: { 'Accept': 'application/vnd.github.v3.diff' },
    });
    return res.text();
  }

  async function fetchPRFiles(owner, repo, prNumber) {
    const res = await request(`/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`);
    return res.json();
  }

  async function fetchPullCommits(owner, repo, prNumber) {
    const res = await request(`/repos/${owner}/${repo}/pulls/${prNumber}/commits?per_page=10`);
    const commits = await res.json();
    if (!Array.isArray(commits)) return [];
    return commits.map((c) => ({
      sha: c.sha,
      message: c.commit?.message || '',
      title: (c.commit?.message || '').split('\n')[0].trim(),
    }));
  }

  async function fetchRepoTree(owner, repo, branch = 'main') {
    const res = await request(`/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
    const data = await res.json();
    const tree = data.tree || [];
    if (data.truncated) {
      tree._truncated = true;
      console.warn(`GitHub tree for ${owner}/${repo}@${branch} is truncated — results may be incomplete.`);
    } else {
      tree._truncated = false;
    }
    return tree;
  }

  async function fetchFileContent(owner, repo, filePath, ref) {
    const query = ref ? `?ref=${q(ref)}` : '';
    const res = await request(`/repos/${owner}/${repo}/contents/${filePath}${query}`);
    const data = await res.json();

    if (data.encoding === 'base64' && data.content) {
      return {
        path: filePath,
        content: Buffer.from(data.content, 'base64').toString('utf-8'),
        size: data.size,
        sha: data.sha,
      };
    }

    return { path: filePath, content: null, size: data.size, sha: data.sha };
  }

  async function fetchRepoMeta(owner, repo) {
    const res = await request(`/repos/${owner}/${repo}`);
    return res.json();
  }

  async function fetchUserRepos(username, { page = 1, perPage = 20 } = {}) {
    const res = await request(
      `/users/${username}/repos?sort=updated&direction=desc&per_page=${perPage}&page=${page}&type=all`
    );
    return res.json();
  }

  async function searchRepos(query, { page = 1, perPage = 20 } = {}) {
    const res = await request(
      `/search/repositories?q=${encodeURIComponent(query)}&sort=updated&per_page=${perPage}&page=${page}`
    );
    return res.json();
  }

  async function fetchRepoPulls(owner, repo, { state = 'open', page = 1, perPage = 20 } = {}) {
    const res = await request(
      `/repos/${owner}/${repo}/pulls?state=${q(state)}&sort=updated&direction=desc&per_page=${perPage}&page=${page}`
    );
    return res.json();
  }

  async function fetchCommits(owner, repo, { branch = 'main', perPage = 50, since = null } = {}) {
    let url = `/repos/${owner}/${repo}/commits?sha=${q(branch)}&per_page=${perPage}`;
    if (since) url += `&since=${q(since)}`;

    const res = await request(url);
    const commits = await res.json();

    return commits.map((c) => ({
      sha: c.sha,
      shortSha: c.sha.slice(0, 7),
      message: c.commit.message,
      title: c.commit.message.split('\n')[0].trim(),
      author: c.commit.author?.name || c.author?.login || 'Unknown',
      authorLogin: c.author?.login || null,
      authorAvatar: c.author?.avatar_url || null,
      date: c.commit.author?.date || c.commit.committer?.date,
      url: c.html_url,
    }));
  }

  async function fetchCommitDetail(owner, repo, sha) {
    const res = await request(`/repos/${owner}/${repo}/commits/${sha}`);
    const data = await res.json();
    return {
      sha: data.sha,
      files: (data.files || []).map((f) => ({
        path: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      })),
      stats: data.stats,
    };
  }

  /**
   * Full commit payload including per-file patches (for single-commit review).
   */
  async function fetchCommitWithPatches(owner, repo, sha) {
    const res = await request(`/repos/${owner}/${repo}/commits/${sha}`);
    const data = await res.json();
    return {
      sha: data.sha,
      message: data.commit?.message || '',
      title: (data.commit?.message || '').split('\n')[0].trim(),
      files: (data.files || []).map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions || 0,
        deletions: f.deletions || 0,
        patch: f.patch || null,
      })),
      stats: data.stats,
      parents: (data.parents || []).map((p) => p.sha),
    };
  }

  /**
   * Compare two commits (e.g. before...after from a push). Returns GitHub compare JSON.
   */
  async function fetchCompare(owner, repo, base, head) {
    const basehead = `${base}...${head}`;
    const res = await request(`/repos/${owner}/${repo}/compare/${basehead}`);
    return res.json();
  }

  // ── PR verdict (Takeoff GitHub App): needs Pull requests r/w, Checks r/w ──

  const enc = encodeURIComponent;
  const jsonBody = (method, body) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  /** Every changed file of a PR (GitHub lists at most 3000), with patches. */
  async function fetchAllPRFiles(owner, repo, prNumber, { maxPages = 30 } = {}) {
    const files = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const res = await request(`/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`);
      const batch = await res.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      files.push(...batch);
      if (batch.length < 100) break;
    }
    return files;
  }

  /** File text at a ref, or null when the file does not exist there. */
  async function fetchFileTextOrNull(owner, repo, filePath, ref) {
    try {
      const path = filePath.split('/').map(enc).join('/');
      const res = await request(`/repos/${owner}/${repo}/contents/${path}${ref ? `?ref=${enc(ref)}` : ''}`);
      const data = await res.json();
      if (Array.isArray(data) || data.type !== 'file') return null;
      if (data.encoding === 'base64' && typeof data.content === 'string') {
        return Buffer.from(data.content, 'base64').toString('utf-8');
      }
      return null;
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  /**
   * The newest issue comment (PRs are issues) whose body starts with `marker`
   * and that `accept(comment)` allows (e.g. only the App's own comments).
   */
  async function findIssueCommentWithMarker(owner, repo, issueNumber, marker, { maxPages = 50, accept = () => true } = {}) {
    let found = null;
    for (let page = 1; page <= maxPages; page += 1) {
      const res = await request(`/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`);
      const batch = await res.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      for (const c of batch) {
        if (typeof c.body === 'string' && c.body.startsWith(marker) && accept(c)) found = c;
      }
      if (batch.length < 100) break;
    }
    return found;
  }

  /**
   * A user's permission on the repo ("admin", "maintain", "write", "triage",
   * "read" or "none"), or "none" when GitHub doesn't know them there.
   */
  async function fetchCollaboratorPermission(owner, repo, username) {
    try {
      const res = await request(`/repos/${owner}/${repo}/collaborators/${enc(username)}/permission`);
      const data = await res.json();
      const p = data.user?.permissions || {};
      return {
        permission: data.role_name || data.permission || 'none',
        // Custom roles have their own names; these flags say what they allow.
        canPush: !!(p.push || p.maintain || p.admin),
        githubUserId: data.user?.id ?? null,
      };
    } catch (err) {
      if (err.status === 404) return { permission: 'none', canPush: false, githubUserId: null };
      throw err;
    }
  }

  /** A GitHub account by login: { id, login }, or null when there's none. */
  async function fetchUserByLogin(username) {
    try {
      const res = await request(`/users/${enc(username)}`);
      const data = await res.json();
      return data && data.id ? { id: Number(data.id), login: String(data.login) } : null;
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }

  async function createIssueComment(owner, repo, issueNumber, body) {
    const res = await request(`/repos/${owner}/${repo}/issues/${issueNumber}/comments`, jsonBody('POST', { body }));
    return res.json();
  }

  async function updateIssueComment(owner, repo, commentId, body) {
    const res = await request(`/repos/${owner}/${repo}/issues/comments/${commentId}`, jsonBody('PATCH', { body }));
    return res.json();
  }

  async function createCheckRun(owner, repo, params) {
    const res = await request(`/repos/${owner}/${repo}/check-runs`, jsonBody('POST', params));
    return res.json();
  }

  async function updateCheckRun(owner, repo, checkRunId, params) {
    const res = await request(`/repos/${owner}/${repo}/check-runs/${checkRunId}`, jsonBody('PATCH', params));
    return res.json();
  }

  /**
   * The newest preview URL a deploy reported for `sha` (a deployment status
   * with an environment_url), or null.
   */
  async function fetchPreviewUrl(owner, repo, sha) {
    const res = await request(`/repos/${owner}/${repo}/deployments?sha=${enc(sha)}&per_page=5`);
    const deployments = await res.json();
    if (!Array.isArray(deployments)) return null;
    for (const d of deployments) {
      const sres = await request(`/repos/${owner}/${repo}/deployments/${d.id}/statuses?per_page=5`);
      const statuses = await sres.json();
      const hit = Array.isArray(statuses) && statuses.find((st) => st.state === 'success' && st.environment_url);
      if (hit) return hit.environment_url;
    }
    return null;
  }

  // ── Writing commits (Git Data API). Needs Contents: write. ──────────────

  /** A branch: { name, protected, commit: { sha } }. */
  async function fetchBranch(owner, repo, branch) {
    const res = await request(`/repos/${owner}/${repo}/branches/${branch.split("/").map(enc).join("/")}`);
    return res.json();
  }

  /**
   * The repo at `ref` as a gzipped tarball: the fetch Response, whose body is
   * the stream. GitHub redirects to a short-lived codeload URL that carries
   * its own token, so the redirect is followed without our Authorization.
   */
  async function fetchTarball(owner, repo, ref) {
    return request(`/repos/${owner}/${repo}/tarball/${enc(ref)}`, { redirect: 'follow' });
  }

  /**
   * One blob's raw bytes, as the fetch Response (read the body with a limit:
   * a blob can be up to 100 MB).
   */
  async function fetchBlobRaw(owner, repo, sha) {
    return request(`/repos/${owner}/${repo}/git/blobs/${enc(sha)}`, {
      headers: { 'Accept': 'application/vnd.github.raw+json' },
    });
  }

  /** The commit a git commit sha points at: { sha, tree: { sha } }. */
  async function fetchGitCommit(owner, repo, sha) {
    const res = await request(`/repos/${owner}/${repo}/git/commits/${enc(sha)}`);
    return res.json();
  }

  /** The entries directly in tree `sha` (not recursive): [{ path, mode, type, sha, size }]. */
  async function fetchTreeEntries(owner, repo, sha) {
    const res = await request(`/repos/${owner}/${repo}/git/trees/${enc(sha)}`);
    const data = await res.json();
    return Array.isArray(data.tree) ? data.tree : [];
  }

  /** A tree on top of `baseTree` with text files replaced: files = [{ path, content }]. */
  async function createTextTree(owner, repo, baseTree, files) {
    const tree = files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content }));
    const res = await request(`/repos/${owner}/${repo}/git/trees`, jsonBody('POST', { base_tree: baseTree, tree }));
    return res.json();
  }

  async function createGitCommit(owner, repo, { message, tree, parents }) {
    const res = await request(`/repos/${owner}/${repo}/git/commits`, jsonBody('POST', { message, tree, parents }));
    return res.json();
  }

  /** Move a branch to `sha`. Not forced unless asked, so a branch that moved on is refused (422). */
  async function updateBranchRef(owner, repo, branch, sha, { force = false } = {}) {
    const res = await request(`/repos/${owner}/${repo}/git/refs/heads/${branch.split('/').map(enc).join('/')}`, jsonBody('PATCH', { sha, force: !!force }));
    return res.json();
  }

  async function createBranchRef(owner, repo, branch, sha) {
    const res = await request(`/repos/${owner}/${repo}/git/refs`, jsonBody('POST', { ref: `refs/heads/${branch}`, sha }));
    return res.json();
  }

  async function createPullRequest(owner, repo, { title, head, base, body }) {
    const res = await request(`/repos/${owner}/${repo}/pulls`, jsonBody('POST', { title, head, base, body }));
    return res.json();
  }

  /** The open PR from `head` (a branch in the same repo) into `base`, or null. */
  async function findOpenPullByHead(owner, repo, head, base) {
    const res = await request(`/repos/${owner}/${repo}/pulls?state=open&head=${enc(`${owner}:${head}`)}&base=${enc(base)}&per_page=1`);
    const list = await res.json();
    return Array.isArray(list) && list.length ? list[0] : null;
  }

  return {
    fetchBranch,
    fetchTarball,
    fetchBlobRaw,
    fetchGitCommit,
    fetchTreeEntries,
    createTextTree,
    createGitCommit,
    updateBranchRef,
    createBranchRef,
    createPullRequest,
    findOpenPullByHead,
    fetchAllPRFiles,
    fetchCollaboratorPermission,
    fetchUserByLogin,
    fetchFileTextOrNull,
    findIssueCommentWithMarker,
    createIssueComment,
    updateIssueComment,
    createCheckRun,
    updateCheckRun,
    fetchPreviewUrl,
    fetchPullRequest,
    fetchPRDiff,
    fetchPRFiles,
    fetchPullCommits,
    fetchRepoTree,
    fetchFileContent,
    fetchRepoMeta,
    fetchUserRepos,
    searchRepos,
    fetchRepoPulls,
    fetchCommits,
    fetchCommitDetail,
    fetchCommitWithPatches,
    fetchCompare,
  };
}

/**
 * List webhooks on a repo (requires admin:repo_hook scope).
 */
async function listRepoWebhooks(owner, repo, userToken) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/hooks?per_page=100`, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'CodeGuru-Reviewer',
      'Authorization': `Bearer ${userToken}`,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`GitHub list webhooks ${res.status}: ${body}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Create a push webhook on a repo using a user-supplied token.
 * Requires admin:repo_hook scope.
 * Returns the created hook object (id, ping_url, etc.).
 */
async function createRepoWebhook(owner, repo, userToken, hookUrl, secret) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/hooks`, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'CodeGuru-Reviewer',
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userToken}`,
    },
    body: JSON.stringify({
      name: 'web',
      active: true,
      events: ['push'],
      config: {
        url: hookUrl,
        content_type: 'json',
        secret,
        insecure_ssl: '0',
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`GitHub create webhook ${res.status}: ${body}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Delete a webhook by ID from a repo using a user-supplied token.
 */
async function deleteRepoWebhook(owner, repo, userToken, hookId) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/hooks/${hookId}`, {
    method: 'DELETE',
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'CodeGuru-Reviewer',
      'Authorization': `Bearer ${userToken}`,
    },
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    const err = new Error(`GitHub delete webhook ${res.status}: ${body}`);
    err.status = res.status;
    throw err;
  }
}

module.exports = {
  parseRepoUrl,
  parsePRUrl,
  createClient,
  // Default client: reads with the server's GITHUB_TOKEN.
  ...createClient(),
  createRepoWebhook,
  deleteRepoWebhook,
  listRepoWebhooks,
};
