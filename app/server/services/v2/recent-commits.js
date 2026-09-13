const github = require('../github');
const { commitReviews, buildEntries, shippedItems } = require('../../lib/db');

const RECENT_COMMIT_LIMIT = 3;
const MAX_SUMMARY_CHARS = 280;

function clamp(str, max) {
  if (typeof str !== 'string') return '';
  const trimmed = str.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
}

/** Body of a commit message (everything after the first line), if any. */
function commitBodySummary(message) {
  if (typeof message !== 'string' || !message.trim()) return null;
  const lines = message.split('\n');
  const body = lines.slice(1).join('\n').trim();
  return body ? clamp(body, MAX_SUMMARY_CHARS) : null;
}

/**
 * Pick the best plain-English update summary for a commit.
 * Prefer Build Story / AI review text, then gap verification, then
 * the commit message body, then the title itself.
 */
function pickSummary({ entry, reviewSummary, shippedDetail, message, title }) {
  const usableEntry =
    entry
    && entry.approval_status !== 'dismissed'
    && typeof entry.content === 'string'
    && entry.content.trim()
      ? entry
      : null;
  if (usableEntry) {
    return {
      summary: clamp(usableEntry.content, MAX_SUMMARY_CHARS),
      summarySource: usableEntry.approval_status === 'approved' ? 'build_story' : 'build_draft',
      summaryTitle:
        usableEntry.title && typeof usableEntry.title === 'string'
          ? clamp(usableEntry.title, 120)
          : null,
    };
  }
  if (reviewSummary && typeof reviewSummary === 'string' && reviewSummary.trim()) {
    return {
      summary: clamp(reviewSummary, MAX_SUMMARY_CHARS),
      summarySource: 'ai_review',
      summaryTitle: null,
    };
  }
  if (shippedDetail && typeof shippedDetail === 'string' && shippedDetail.trim()) {
    return {
      summary: clamp(shippedDetail, MAX_SUMMARY_CHARS),
      summarySource: 'gap_verification',
      summaryTitle: null,
    };
  }
  const body = commitBodySummary(message);
  if (body) {
    return { summary: body, summarySource: 'commit_body', summaryTitle: null };
  }
  return {
    summary: clamp(title || message || '', MAX_SUMMARY_CHARS) || 'No summary available.',
    summarySource: 'commit_title',
    summaryTitle: null,
  };
}

/**
 * Load the 1–3 most recent commits for a project and attach a short
 * update summary from whatever we already have on file (no extra AI).
 */
async function loadRecentCommits(project, { limit = RECENT_COMMIT_LIMIT } = {}) {
  if (!project?.owner || !project?.repo) return [];
  if (typeof project.repo_url === 'string' && project.repo_url.startsWith('local://')) {
    return [];
  }

  const perPage = Math.max(1, Math.min(RECENT_COMMIT_LIMIT, limit));
  const branch = project.branch || 'main';

  let commits;
  try {
    commits = await github.fetchCommits(project.owner, project.repo, { branch, perPage });
  } catch (err) {
    console.warn(
      `[v2/recent-commits] fetch failed for ${project.owner}/${project.repo}: ${err.message}`,
    );
    return [];
  }

  if (!Array.isArray(commits) || commits.length === 0) return [];

  const shaped = await Promise.all(
    commits.slice(0, perPage).map(async (c) => {
      const [review, entry, shipped] = await Promise.all([
        commitReviews.findByProjectAndSha(project.id, c.sha).catch(() => null),
        buildEntries.findBySourceCommitSha(project.id, c.sha).catch(() => null),
        shippedItems.findByCommit(project.id, c.sha).catch(() => null),
      ]);

      const reviewSummary =
        review?.status === 'completed'
          ? review.ai_report?.summary || review.report_summary || null
          : null;

      const { summary, summarySource, summaryTitle } = pickSummary({
        entry,
        reviewSummary,
        shippedDetail: shipped?.verification_detail || null,
        message: c.message,
        title: c.title,
      });

      return {
        sha: c.sha,
        shortSha: c.shortSha || (typeof c.sha === 'string' ? c.sha.slice(0, 7) : ''),
        title: c.title || (c.message || '').split('\n')[0].trim() || '(no message)',
        summary,
        summaryTitle,
        summarySource,
        author: c.author || null,
        authorLogin: c.authorLogin || null,
        authorAvatar: c.authorAvatar || null,
        date: c.date || null,
        url: c.url || null,
        matchedGap: !!shipped,
        verification: shipped?.verification || null,
      };
    }),
  );

  return shaped;
}

module.exports = {
  RECENT_COMMIT_LIMIT,
  loadRecentCommits,
  pickSummary,
  commitBodySummary,
};
