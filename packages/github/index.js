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
  return data.tree || [];
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
};
