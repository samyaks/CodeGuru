const {
  deployments,
  projectReads,
  readClaims,
  suggestions,
  shippedItems,
} = require('../lib/db');
const { productMap } = require('../lib/db-map');
const { toGap } = require('./v2/gap-mapper');
const github = require('./github');

const SUMMARY_MAX = 320;
const MISSING_PER_CARD = 3;
const PERSONAS_PER_CARD = 3;
const COMMIT_FETCH_TIMEOUT_MS = 1500;

const SUMMARY_FIELDS = [
  'id', 'repo_url', 'owner', 'repo', 'branch', 'status', 'readiness_score',
  'recommendation', 'framework', 'live_url', 'deployed_at', 'created_at',
  'updated_at', 'suggestions_count', 'description',
];

function extractSection(markdown, heading) {
  if (!markdown) return null;
  const re = new RegExp(`##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i');
  const match = String(markdown).match(re);
  return match ? match[1].trim() : null;
}

function firstParagraph(text) {
  if (!text) return null;
  const cleaned = String(text)
    .replace(/^#+\s+/gm, '')
    .replace(/\*\*/g, '')
    .trim();
  if (!cleaned) return null;
  const para = cleaned.split(/\n\s*\n/)[0] || cleaned;
  const line = para.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!line) return null;
  return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX - 1).trimEnd()}…` : line;
}

function extractNutshell(featuresSummary) {
  const section = extractSection(featuresSummary, 'In a nutshell');
  if (section) return firstParagraph(section);
  return firstParagraph(featuresSummary);
}

function extractWhatsNotBuilt(featuresSummary) {
  const section = extractSection(featuresSummary, "What'?s not built yet\\?");
  if (!section) return [];
  return section
    .split('\n')
    .map((line) => line.replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '').trim())
    .filter((line) => line && !/^#/.test(line))
    .slice(0, MISSING_PER_CARD);
}

function claimText(claims, slot) {
  const row = (claims || []).find((c) => c.slot === slot);
  const text = row && typeof row.text === 'string' ? row.text.trim() : '';
  return text || null;
}

function buildAppSummary(project, claims) {
  return firstParagraph(claimText(claims, 'objective'))
    || extractNutshell(project.features_summary)
    || firstParagraph(project.description)
    || null;
}

function missingFromReadiness(categories) {
  if (!categories || typeof categories !== 'object') return [];
  return Object.values(categories)
    .filter((cat) => cat && (cat.status === 'missing' || cat.status === 'partial'))
    .sort((a, b) => (a.status === 'missing' ? 0 : 1) - (b.status === 'missing' ? 0 : 1))
    .map((cat) => ({
      id: `readiness:${cat.label || 'item'}`,
      title: cat.detail || `${cat.label || 'A capability'} is ${cat.status}`,
      category: cat.status === 'missing' ? 'infra' : 'missing',
    }))
    .slice(0, MISSING_PER_CARD);
}

function missingFromFeatures(featuresSummary) {
  return extractWhatsNotBuilt(featuresSummary).map((title, i) => ({
    id: `summary:${i}`,
    title,
    category: 'missing',
  }));
}

function missingFromGaps(rows) {
  return (rows || []).slice(0, MISSING_PER_CARD).map((row) => {
    const gap = toGap(row);
    return {
      id: gap.id,
      title: gap.title,
      category: gap.category,
    };
  });
}

function pickMissing({ gapRows, featuresSummary, readinessCategories }) {
  const fromGaps = missingFromGaps(gapRows);
  if (fromGaps.length) return fromGaps;
  const fromSummary = missingFromFeatures(featuresSummary);
  if (fromSummary.length) return fromSummary;
  return missingFromReadiness(readinessCategories);
}

function clampScore(value) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function shapePersonas(mapBundle) {
  if (!mapBundle || !Array.isArray(mapBundle.personas)) return [];
  const scores = mapBundle.scores && typeof mapBundle.scores === 'object'
    ? (mapBundle.scores.persona || {})
    : {};
  return mapBundle.personas.slice(0, PERSONAS_PER_CARD).map((persona) => ({
    id: persona.id,
    name: persona.name,
    emoji: persona.emoji || null,
    description: persona.description ? firstParagraph(persona.description) : null,
    readiness: clampScore(scores[persona.id]),
  }));
}

function toCommitSnapshot(commit, source) {
  if (!commit) return null;
  const sha = commit.sha || commit.commit_sha || null;
  if (!sha) return null;
  const message = commit.title || commit.message || commit.commit_message || '';
  const title = String(message).split('\n')[0].trim();
  return {
    sha,
    shortSha: String(commit.shortSha || sha).slice(0, 7),
    title: title || null,
    date: commit.date || commit.shipped_at || null,
    author: commit.author || null,
    source,
  };
}

function commitTime(commit) {
  if (!commit || !commit.date) return 0;
  const t = new Date(commit.date).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function pickLastCommit(...candidates) {
  let best = null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!best || commitTime(candidate) > commitTime(best)) best = candidate;
  }
  return best;
}

function isGithubProject(project) {
  if (!project || !project.owner || !project.repo) return false;
  return !String(project.repo_url || '').startsWith('local://');
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function fetchLatestCommit(project) {
  if (!isGithubProject(project)) return null;
  const commits = await withTimeout(
    github.fetchCommits(project.owner, project.repo, {
      branch: project.branch || 'main',
      perPage: 1,
    }),
    COMMIT_FETCH_TIMEOUT_MS
  );
  return toCommitSnapshot(commits && commits[0], 'github');
}

async function resolveLastCommits(projects, shippedById) {
  const result = new Map();
  const needFetch = [];
  for (const project of projects) {
    const stored = toCommitSnapshot(project.analysis_data?.meta?.lastCommit, 'stored');
    const shipped = toCommitSnapshot(shippedById.get(project.id), 'shipped');
    const known = pickLastCommit(stored, shipped);
    if (known) result.set(project.id, known);
    else if (isGithubProject(project)) needFetch.push(project);
  }
  if (needFetch.length) {
    await Promise.all(needFetch.map(async (project) => {
      try {
        const live = await fetchLatestCommit(project);
        if (live) result.set(project.id, live);
      } catch {
        // Leave the card without a commit rather than failing the list.
      }
    }));
  }
  return result;
}

function buildDashboardCard(project, extras = {}) {
  const claims = extras.claims || [];
  const personas = extras.personas || [];
  const missingItems = extras.missingItems || [];
  const card = {};
  for (const key of SUMMARY_FIELDS) {
    if (project[key] !== undefined) card[key] = project[key];
  }
  if (project.status === 'failed' || project.status === 'error') {
    card.error = project.error || null;
  }
  card.app_summary = extras.appSummary !== undefined
    ? extras.appSummary
    : buildAppSummary(project, claims);
  card.audience = extras.audience !== undefined
    ? extras.audience
    : (firstParagraph(claimText(claims, 'audience')) || personas[0]?.description || null);
  card.persona = personas[0] || null;
  card.personas = personas;
  card.missing = {
    next: extras.next || null,
    items: missingItems,
    count: typeof extras.missingCount === 'number'
      ? extras.missingCount
      : missingItems.length,
  };
  card.last_commit = extras.lastCommit || null;
  return card;
}

async function enrichProjectsForDashboard(projects) {
  if (!projects.length) return [];
  const ids = projects.map((p) => p.id);

  const [claimRows, readRows, gapBundle, shippedById, personaBundle] = await Promise.all([
    readClaims.findByProjectIds(ids),
    projectReads.findByProjectIds(ids),
    suggestions.findOpenCardGapsByProjectIds(ids, { perProject: MISSING_PER_CARD }),
    shippedItems.findLatestByProjectIds(ids),
    productMap.getCardPersonasByProjectIds(ids),
  ]);

  const claimsByProject = new Map();
  for (const row of claimRows) {
    const list = claimsByProject.get(row.project_id) || [];
    list.push(row);
    claimsByProject.set(row.project_id, list);
  }
  const readsByProject = new Map(readRows.map((row) => [row.project_id, row]));

  const lastCommits = await resolveLastCommits(projects, shippedById);

  return projects.map((project) => {
    const claims = claimsByProject.get(project.id) || [];
    const read = readsByProject.get(project.id) || null;
    const personas = shapePersonas(personaBundle.get(project.id));
    const gapRows = gapBundle.itemsByProject.get(project.id) || [];
    const missingItems = pickMissing({
      gapRows,
      featuresSummary: project.features_summary,
      readinessCategories: project.readiness_categories,
    });
    const missingCount = gapBundle.counts.get(project.id) ?? missingItems.length;
    return buildDashboardCard(project, {
      claims,
      personas,
      missingItems,
      missingCount,
      next: read && read.next_title
        ? { title: read.next_title, why: read.next_why || null }
        : null,
      lastCommit: lastCommits.get(project.id) || null,
    });
  });
}

async function listDashboardCards(userId) {
  const projects = await deployments.findByUserId(userId);
  return enrichProjectsForDashboard(projects);
}

module.exports = {
  SUMMARY_FIELDS,
  extractSection,
  extractNutshell,
  extractWhatsNotBuilt,
  firstParagraph,
  buildAppSummary,
  missingFromReadiness,
  pickMissing,
  pickLastCommit,
  toCommitSnapshot,
  shapePersonas,
  buildDashboardCard,
  enrichProjectsForDashboard,
  listDashboardCards,
};
