const GITHUB_API = 'https://api.github.com';

function headers() {
  const h = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'CodeGuru-Reviewer',
  };
  if (process.env.GITHUB_TOKEN) {
    h['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return h;
}

async function githubFetch(urlPath, opts = {}) {
  const url = urlPath.startsWith('http') ? urlPath : `${GITHUB_API}${urlPath}`;
  const res = await fetch(url, { headers: { ...headers(), ...opts.headers }, ...opts });

  const remaining = res.headers.get('x-ratelimit-remaining');
  if (remaining !== null && parseInt(remaining, 10) < 10) {
    console.warn(`GitHub API rate limit low: ${remaining} requests remaining`);
  }

  if (!res.ok) {
    const body = await res.text();
    let message = `GitHub API ${res.status}: ${body}`;
    if (res.status === 404 && !process.env.GITHUB_TOKEN) {
      message = `Repository not found. If this is a private repo, set GITHUB_TOKEN in .env. If public, you may have hit the unauthenticated rate limit (60 req/hr). Original: ${body}`;
    }
    if (res.status === 403) {
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

async function fetchPullRequest(owner, repo, prNumber) {
  const res = await githubFetch(`/repos/${owner}/${repo}/pulls/${prNumber}`);
  return res.json();
}

async function fetchPRDiff(owner, repo, prNumber) {
  const res = await githubFetch(`/repos/${owner}/${repo}/pulls/${prNumber}`, {
    headers: { 'Accept': 'application/vnd.github.v3.diff' },
  });
  return res.text();
}

async function fetchPRFiles(owner, repo, prNumber) {
  const res = await githubFetch(`/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`);
  return res.json();
}

async function fetchRepoTree(owner, repo, branch = 'main') {
  const res = await githubFetch(`/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
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
  const query = ref ? `?ref=${ref}` : '';
  const res = await githubFetch(`/repos/${owner}/${repo}/contents/${filePath}${query}`);
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
  const res = await githubFetch(`/repos/${owner}/${repo}`);
  return res.json();
}

async function fetchUserRepos(username, { page = 1, perPage = 20 } = {}) {
  const res = await githubFetch(
    `/users/${username}/repos?sort=updated&direction=desc&per_page=${perPage}&page=${page}&type=all`
  );
  return res.json();
}

async function searchRepos(query, { page = 1, perPage = 20 } = {}) {
  const res = await githubFetch(
    `/search/repositories?q=${encodeURIComponent(query)}&sort=updated&per_page=${perPage}&page=${page}`
  );
  return res.json();
}

async function fetchRepoPulls(owner, repo, { state = 'open', page = 1, perPage = 20 } = {}) {
  const res = await githubFetch(
    `/repos/${owner}/${repo}/pulls?state=${state}&sort=updated&direction=desc&per_page=${perPage}&page=${page}`
  );
  return res.json();
}

async function fetchCommits(owner, repo, { branch = 'main', perPage = 50, since = null } = {}) {
  let url = `/repos/${owner}/${repo}/commits?sha=${branch}&per_page=${perPage}`;
  if (since) url += `&since=${since}`;

  const res = await githubFetch(url);
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
  const res = await githubFetch(`/repos/${owner}/${repo}/commits/${sha}`);
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
  const res = await githubFetch(`/repos/${owner}/${repo}/commits/${sha}`);
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
  const res = await githubFetch(`/repos/${owner}/${repo}/compare/${basehead}`);
  return res.json();
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
  fetchPullRequest,
  fetchPRDiff,
  fetchPRFiles,
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
  createRepoWebhook,
  deleteRepoWebhook,
  listRepoWebhooks,
};
