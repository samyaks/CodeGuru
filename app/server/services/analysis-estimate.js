/**
 * Preflight analysis estimate: repo tree (or upload stats) → token/cost
 * projection per selectable model. Does not read file contents and does
 * not start an analysis.
 */

const github = require('./github');
const { shouldSkipFile } = require('./analyzer');
const { analyses } = require('../lib/db');
const { buildEstimate } = require('../lib/analysis-models');
const { AppError } = require('../lib/app-error');
const { validateRepoUrl } = require('../lib/validate');

async function fetchTreeStats(owner, repo, branch) {
  let tree;
  try {
    tree = await github.fetchRepoTree(owner, repo, branch);
  } catch (err) {
    if (branch && branch !== 'main' && branch !== 'master') throw err;
    const fallback = branch === 'main' ? 'master' : 'main';
    tree = await github.fetchRepoTree(owner, repo, fallback);
  }
  const truncated = !!tree._truncated;
  const blobs = (Array.isArray(tree) ? tree : []).filter(
    (f) => f && f.type === 'blob' && !shouldSkipFile(f.path),
  );
  const fileCount = blobs.length;
  const treeBytes = blobs.reduce((acc, f) => acc + (f.size || 0), 0);
  return { fileCount, treeBytes, truncated };
}

async function estimateForRepo(repoUrl, { preferredModel = null, signedIn = false } = {}) {
  const validation = validateRepoUrl(repoUrl);
  if (!validation.valid) throw AppError.badRequest(validation.error);
  const { owner, repo } = validation;

  let meta;
  try {
    meta = await github.fetchRepoMeta(owner, repo);
  } catch (err) {
    const status = err.status || 0;
    if (status === 404) {
      throw AppError.notFound(
        'Repository not found or not public. Paste URL only works for public GitHub repos — private repos need Connect GitHub (pick from your list) or a folder upload.',
      );
    }
    throw AppError.badRequest(err.message || 'Failed to read repository metadata');
  }

  const branch = meta.default_branch || 'main';
  let stats;
  try {
    stats = await fetchTreeStats(owner, repo, branch);
  } catch (err) {
    const status = err.status || 0;
    if (status === 404) {
      throw AppError.notFound('Could not read the repository file tree.');
    }
    throw AppError.badRequest(err.message || 'Failed to read repository file tree');
  }

  return buildEstimate({
    ...stats,
    preferredModel,
    signedIn,
    repo: {
      owner,
      name: repo,
      fullName: `${owner}/${repo}`,
      language: meta.language || null,
      description: meta.description || null,
      defaultBranch: branch,
    },
  });
}

async function estimateFromStats({
  fileCount, treeBytes, truncated = false, repo = null, signedIn = false,
} = {}) {
  const files = Number(fileCount);
  const bytes = Number(treeBytes);
  if (!Number.isFinite(files) || files < 0) {
    throw AppError.badRequest('fileCount must be a non-negative number');
  }
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw AppError.badRequest('totalBytes must be a non-negative number');
  }
  return buildEstimate({
    fileCount: files,
    treeBytes: bytes,
    truncated: !!truncated,
    repo,
    signedIn,
  });
}

async function estimateForProject(project, { signedIn = false } = {}) {
  if (!project) throw AppError.notFound('Project not found');

  // Re-analyze should default to whatever model the last run used.
  const last = project.analysis_data && project.analysis_data.llmModel;
  const preferredModel = last ? (last.id || last.model) : null;

  const rollups = await analyses.getRollups(project.id).catch(() => null);
  const fileCount = rollups && Number(rollups.file_count) > 0 ? Number(rollups.file_count) : 0;
  const treeBytes = rollups && Number(rollups.tree_total_bytes) > 0
    ? Number(rollups.tree_total_bytes)
    : 0;

  const repo = project.owner && project.repo
    ? {
      owner: project.owner,
      name: project.repo,
      fullName: `${project.owner}/${project.repo}`,
      language: null,
      description: project.description || null,
      defaultBranch: project.branch || 'main',
    }
    : null;

  if (fileCount > 0) {
    return buildEstimate({
      fileCount,
      treeBytes,
      truncated: !!(rollups && rollups.tree_truncated),
      repo,
      preferredModel,
      signedIn,
    });
  }

  if (typeof project.repo_url === 'string' && !project.repo_url.startsWith('local://')) {
    return estimateForRepo(project.repo_url, { preferredModel, signedIn });
  }

  const tree = Array.isArray(project.analysis_data?.fileTree)
    ? project.analysis_data.fileTree
    : [];
  return buildEstimate({
    fileCount: tree.length,
    treeBytes: 0,
    truncated: false,
    repo,
    preferredModel,
    signedIn,
  });
}

module.exports = {
  estimateForRepo,
  estimateFromStats,
  estimateForProject,
};
