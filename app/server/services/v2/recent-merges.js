const github = require('../github');
const { HAIKU_MODEL } = require('../../lib/constants');
const { createMessageTracked, extractText } = require('../../lib/anthropic-tracked');

const MERGED_PULL_LIMIT = 5;
const CLOSED_PULL_PAGE = 30;
const MAX_SUMMARY_CHARS = 180;

/** In-process cache so a reload does not regenerate the same pull. */
const generatedCache = new Map();

function clamp(str, max) {
  const trimmed = str.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
}

/** First readable line of a PR body, skipping blanks and HTML comments. */
function firstBodyLine(body) {
  if (typeof body !== 'string' || !body.trim()) return null;
  const line = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('<!--') && l !== '-->' && !l.startsWith('```'));
  return line || null;
}

/**
 * A GitHub description counts as a summary when it says what changed.
 * A lone "Fixes #55", a checkbox, or a few words does not.
 */
function isUsefulSummary(line) {
  if (typeof line !== 'string') return false;
  const text = line.trim();
  if (text.length < 12) return false;
  if (/^[-*]\s*\[[ xX]\]/.test(text)) return false;
  if (/^(fixes|fix|closes|close|resolves|resolve|refs|see)\s+#\d+\.?\s*$/i.test(text)) return false;
  return true;
}

/** GitHub description, when it is actually a summary. */
function pullSummary(body) {
  const line = firstBodyLine(body);
  if (!isUsefulSummary(line)) return null;
  return clamp(line, MAX_SUMMARY_CHARS);
}

function fallbackSummary(pull) {
  const title = (pull.title || 'this change').replace(/\.+$/, '');
  return clamp(`Landed ${title}.`, MAX_SUMMARY_CHARS);
}

function issueHint(body) {
  const line = firstBodyLine(body);
  if (!line) return null;
  const match = line.match(/^(?:fix(?:es)?|clos(?:e|es)|resolv(?:e|es))\s+#(\d+)\b/i);
  return match ? `Closes issue #${match[1]}.` : null;
}

function summaryFromCommits(commits, title) {
  const seen = [];
  for (const commit of commits || []) {
    const line = String(commit?.title || commit || '').trim();
    if (!line || line.toLowerCase() === String(title || '').toLowerCase()) continue;
    if (line.length < 12 || seen.includes(line)) continue;
    seen.push(line);
  }
  if (!seen.length) return null;
  return clamp(seen.slice(0, 3).join(' · '), MAX_SUMMARY_CHARS);
}

function cacheKey(owner, repo, pull) {
  return `${owner}/${repo}#${pull.number}:${pull.title}`;
}

function parseGenerated(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return {};
  const fenced = raw.replace(/```(?:json)?/gi, '').trim();
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  const cleaned = start >= 0 && end > start ? fenced.slice(start, end + 1) : fenced;
  let parsed;
  try { parsed = JSON.parse(cleaned); } catch { return {}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === 'string' && value.trim()) out[String(key)] = clamp(value.trim(), MAX_SUMMARY_CHARS);
  }
  return out;
}

/**
 * One Haiku call for every pull that has no GitHub summary.
 * `notes` is [{ number, title, commits: string[] }].
 */
async function generateSummaries(notes) {
  if (!notes.length) return {};
  const response = await createMessageTracked({
    phase: 'shipped_merge_summary',
    params: {
      model: HAIKU_MODEL,
      max_tokens: 600,
      system: [
        'You write one plain-English sentence per merged pull request for someone who does not read code.',
        'Say what changed, not the pull request number or the author.',
        'Return only JSON: an object whose keys are the pull numbers and whose values are the sentences.',
      ].join(' '),
      messages: [{ role: 'user', content: JSON.stringify(notes) }],
    },
  });
  return parseGenerated(extractText(response));
}

/**
 * Fill summary + summarySource on each pull.
 * GitHub description wins. Otherwise a generated sentence, then a title fallback
 * so a card is never blank. `generate` is injectable for tests.
 */
async function ensureSummaries(pulls, { owner, repo, generate = generateSummaries, commitsFor } = {}) {
  if (!Array.isArray(pulls) || pulls.length === 0) return [];
  const missing = pulls.filter((p) => !p.summary);
  const fresh = [];
  const known = new Map();
  for (const pull of missing) {
    const hit = generatedCache.get(cacheKey(owner, repo, pull));
    if (hit) known.set(String(pull.number), { text: hit, source: 'generated' });
    else fresh.push(pull);
  }

  if (fresh.length) {
    const stillOpen = [];
    for (const pull of fresh) {
      let commits = [];
      if (commitsFor) {
        try { commits = await commitsFor(pull); } catch { commits = []; }
      }
      const fromCommits = summaryFromCommits(commits, pull.title);
      if (fromCommits) {
        known.set(String(pull.number), { text: fromCommits, source: 'commits' });
        continue;
      }
      stillOpen.push({
        number: pull.number,
        title: pull.title,
        commits: (Array.isArray(commits) ? commits : []).map((c) => c.title || c).filter(Boolean).slice(0, 5),
      });
    }
    if (stillOpen.length) {
      try {
        const generated = await generate(stillOpen);
        for (const note of stillOpen) {
          const text = generated && generated[String(note.number)];
          if (!text) continue;
          known.set(String(note.number), { text, source: 'generated' });
          const pull = fresh.find((p) => p.number === note.number);
          if (pull) generatedCache.set(cacheKey(owner, repo, pull), text);
        }
      } catch (err) {
        console.warn(`[v2/recent-merges] summary generation failed: ${err.message}`);
      }
    }
  }

  return pulls.map((pull) => {
    const { hint, ...rest } = pull;
    if (rest.summary) return { ...rest, summarySource: rest.summarySource || 'github' };
    const hit = known.get(String(pull.number));
    if (hit) return { ...rest, summary: hit.text, summarySource: hit.source };
    if (hint) return { ...rest, summary: hint, summarySource: 'github' };
    return { ...rest, summary: fallbackSummary(rest), summarySource: 'generated' };
  });
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
    .map((p) => {
      const summary = pullSummary(p.body);
      return {
        number: p.number,
        title: (typeof p.title === 'string' && p.title.trim()) ? p.title.trim() : `Pull request #${p.number}`,
        summary,
        summarySource: summary ? 'github' : null,
        hint: summary ? null : issueHint(p.body),
        author: p.user?.login || null,
        authorAvatar: p.user?.avatar_url || null,
        mergedAt: p.merged_at,
        url: p.html_url || null,
      };
    });
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

  const selected = selectMergedPulls(pulls, limit);
  return ensureSummaries(selected, {
    owner: project.owner,
    repo: project.repo,
    commitsFor: (pull) => github.fetchPullCommits(project.owner, project.repo, pull.number),
  });
}

module.exports = {
  MERGED_PULL_LIMIT,
  selectMergedPulls,
  pullSummary,
  isUsefulSummary,
  ensureSummaries,
  fallbackSummary,
  summaryFromCommits,
  parseGenerated,
  loadRecentMerges,
};
