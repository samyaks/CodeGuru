const Anthropic = require('@anthropic-ai/sdk');

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';
const HAIKU_MODEL = process.env.HAIKU_MODEL || 'claude-haiku-4-5';

const anthropic = new Anthropic();

function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '\n... (truncated)';
}

module.exports = { CLAUDE_MODEL, HAIKU_MODEL, anthropic, truncate };
