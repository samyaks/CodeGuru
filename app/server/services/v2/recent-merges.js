const github = require('../github');

const MERGED_PULL_LIMIT = 5;
const CLOSED_PULL_PAGE = 30;
const MAX_SUMMARY_CHARS = 180;

function clamp(str, max) {
  const trimmed = str.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
}

/** First readable line of a PR body, skipping blanks and HTML comments. */
function pullSummary(body) {
  if (typeof body !== 'string' || !body.trim()) return null;
  const line = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('<!--') && l !== '-->');
  return line ? clamp(line, MAX_SUMMARY_CHARS) : null;
}

/**
 * Keep only merged pull requests, newest merge first.
 * `pulls` is the raw GitHub pulls list (closed includes unmerged).
 */
function selectMergedPulls(pulls, limit = MERGED_PULL_LIMIT) {
  if (!Array.isArray(pulls)) return [];
  const cap = Math.max(1, Math.min(MERGED_PULL_LIMIT, limit));
  return pulls
    .filter((p) => p && p.merged_at && p.number != null)
    .sort((a, b) => new Date(b.merged_at).getTime() - new Date(a.merged_at).getTime())
    .slice(0, cap)
    .map((p) => ({
      number: p.number,
      title: (typeof p.title === 'string' && p.title.trim()) ? p.title.trim() : `Pull request #${p.number}`,
      summary: pullSummary(p.body),
      author: p.user?.login || null,
      authorAvatar: p.user?.avatar_url || null,
      mergedAt: p.merged_at,
      url: p.html_url || null,
    }));
}

/**
 * Last merged pull requests on the project's repo. Empty for uploads and
 * when GitHub is unreachable — the rest of the Shipped tab still renders.
 */
async function loadRecentMerges(project, { limit = MERGED_PULL_LIMIT } = {}) {
  if (!project?.owner || !project?.repo) return [];
  if (typeof project.repo_url === 'string' && project.repo_url.startsWith('local://')) {
    return [];
  }

  let pulls;
  try {
    pulls = await github.fetchRepoPulls(project.owner, project.repo, {
      state: 'closed',
      perPage: CLOSED_PULL_PAGE,
    });
  } catch (err) {
    console.warn(
      `[v2/recent-merges] fetch failed for ${project.owner}/${project.repo}: ${err.message}`,
    );
    return [];
  }

  return selectMergedPulls(pulls, limit);
}

module.exports = {
  MERGED_PULL_LIMIT,
  selectMergedPulls,
  pullSummary,
  loadRecentMerges,
};
