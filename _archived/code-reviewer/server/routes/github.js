const express = require('express');
const github = require('../services/github');

const router = express.Router();

router.get('/repos', async (req, res) => {
  try {
    const { search, username, page = '1' } = req.query;

    if (search) {
      const data = await github.searchRepos(search, { page: parseInt(page, 10) });
      return res.json({
        repos: (data.items || []).map(mapRepo),
        total: data.total_count || 0,
      });
    }

    if (username) {
      const repos = await github.fetchUserRepos(username, { page: parseInt(page, 10) });
      return res.json({ repos: repos.map(mapRepo), total: repos.length });
    }

    return res.status(400).json({ error: 'Provide ?search= or ?username= parameter' });
  } catch (err) {
    console.error('GitHub repos error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/repos/:owner/:repo/pulls', async (req, res) => {
  try {
    const { owner, repo } = req.params;
    const { state = 'open', page = '1' } = req.query;
    const pulls = await github.fetchRepoPulls(owner, repo, {
      state,
      page: parseInt(page, 10),
    });
    res.json({
      pulls: pulls.map((pr) => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        user: pr.user?.login,
        user_avatar: pr.user?.avatar_url,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        head_branch: pr.head?.ref,
        base_branch: pr.base?.ref,
        additions: pr.additions,
        deletions: pr.deletions,
        changed_files: pr.changed_files,
        html_url: pr.html_url,
        draft: pr.draft,
      })),
    });
  } catch (err) {
    console.error('GitHub pulls error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

function mapRepo(r) {
  return {
    full_name: r.full_name,
    owner: r.owner?.login,
    name: r.name,
    description: r.description,
    language: r.language,
    stargazers_count: r.stargazers_count,
    forks_count: r.forks_count,
    open_issues_count: r.open_issues_count,
    updated_at: r.updated_at,
    html_url: r.html_url,
    private: r.private,
    default_branch: r.default_branch,
  };
}

module.exports = router;
