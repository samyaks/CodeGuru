const { parseRepoUrl } = require('../services/github');

function validateUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: 'Please provide a valid URL' };
  }
  if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') {
    return { valid: false, error: 'Please provide a valid GitHub repository URL' };
  }
  return { valid: true };
}

function validateRepoUrl(url) {
  const urlCheck = validateUrl(url);
  if (!urlCheck.valid) return urlCheck;

  try {
    const { owner, repo } = parseRepoUrl(url);
    return { valid: true, owner, repo };
  } catch {
    return { valid: false, error: 'Could not parse owner/repo from URL. Expected format: https://github.com/owner/repo' };
  }
}

function validatePagination(query) {
  let limit = parseInt(query.limit, 10);
  if (isNaN(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;

  let offset = parseInt(query.offset, 10);
  if (isNaN(offset) || offset < 0) offset = 0;

  return { limit, offset };
}

module.exports = { validateUrl, validateRepoUrl, validatePagination };
