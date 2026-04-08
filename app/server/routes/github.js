const express = require('express');
const github = require('../services/github');
const { createRateLimit } = require('../lib/rate-limit');
const { AppError } = require('../lib/app-error');
const { asyncHandler } = require('../lib/async-handler');

const router = express.Router();

const githubRateLimit = createRateLimit({ windowMs: 60000, max: 30, message: 'Too many GitHub API requests. Please try again in a minute.' });
router.use(githubRateLimit);

router.get('/repos', asyncHandler(async (req, res) => {
  const { search, username, page = '1' } = req.query;
  if (search) {
    const data = await github.searchRepos(search, { page: parseInt(page, 10) });
    return res.json({ repos: (data.items || []).map(mapRepo), total: data.total_count || 0 });
  }
  if (username) {
    const repos = await github.fetchUserRepos(username, { page: parseInt(page, 10) });
    return res.json({ repos: repos.map(mapRepo), total: repos.length });
  }
  throw AppError.badRequest('Provide ?search= or ?username= parameter');
}));

router.get('/my-repos', asyncHandler(async (req, res) => {
  const ghToken = req.cookies?.['gh-provider-token'];
  if (!ghToken) {
    return res.status(401).json({ error: 'GitHub login required', code: 'UNAUTHORIZED', repos: [] });
  }

  const { sort = 'updated', page = '1', per_page = '50' } = req.query;
  const ghRes = await fetch(
    `https://api.github.com/user/repos?sort=${sort}&direction=desc&per_page=${per_page}&page=${page}&affiliation=owner,collaborator,organization_member`,
    { headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' } }
  );

  if (!ghRes.ok) {
    const msg = ghRes.status === 401 ? 'GitHub token expired — sign out and back in' : 'GitHub API error';
    return res.status(ghRes.status).json({ error: msg, code: ghRes.status === 401 ? 'UNAUTHORIZED' : 'GITHUB_API_ERROR', repos: [] });
  }

  const repos = await ghRes.json();
  res.json({ repos: repos.map(mapRepo), total: repos.length });
}));

router.get('/repos/:owner/:repo/pulls', asyncHandler(async (req, res) => {
  const { owner, repo } = req.params;
  const { state = 'open', page = '1' } = req.query;
  const pulls = await github.fetchRepoPulls(owner, repo, { state, page: parseInt(page, 10) });
  res.json({
    pulls: pulls.map((pr) => ({
      number: pr.number, title: pr.title, state: pr.state,
      user: pr.user?.login, user_avatar: pr.user?.avatar_url,
      created_at: pr.created_at, updated_at: pr.updated_at,
      head_branch: pr.head?.ref, base_branch: pr.base?.ref,
      additions: pr.additions, deletions: pr.deletions,
      changed_files: pr.changed_files, html_url: pr.html_url, draft: pr.draft,
    })),
  });
}));

function mapRepo(r) {
  return {
    full_name: r.full_name, owner: r.owner?.login, name: r.name,
    description: r.description, language: r.language,
    stargazers_count: r.stargazers_count, forks_count: r.forks_count,
    open_issues_count: r.open_issues_count, updated_at: r.updated_at,
    html_url: r.html_url, private: r.private, default_branch: r.default_branch,
  };
}

module.exports = router;
