const { CLAUDE_MODEL, anthropic } = require('../lib/constants');

const MAX_TITLE_CHARS = 120;
const MAX_CONTENT_CHARS = 600;
const MAX_FILES_IN_PROMPT = 30;
const MAX_FINDINGS_IN_PROMPT = 3;

const SYSTEM_PROMPT =
  'You are documenting a software build story for a non-engineer PM audience. ' +
  'Given a commit\'s diff and AI review, write a SHORT title (≤8 words) and a 2-sentence body in plain English describing WHAT changed and WHY. ' +
  'Avoid jargon. Don\'t say "this commit" or "this PR". ' +
  'Frame the change like a build journal entry. ' +
  'Respond with ONLY a JSON object: {"title":"...","content":"..."}';

function buildFileLines(files) {
  if (!Array.isArray(files) || files.length === 0) return '(no files)';
  return files
    .slice(0, MAX_FILES_IN_PROMPT)
    .map((f) => {
      const status = f.status || 'modified';
      const adds = f.additions || 0;
      const dels = f.deletions || 0;
      return `- ${f.filename} [${status}] +${adds}/-${dels}`;
    })
    .join('\n');
}

function buildFindingLines(aiReport) {
  const findings = Array.isArray(aiReport?.findings) ? aiReport.findings : [];
  if (findings.length === 0) return '(no findings reported)';
  return findings
    .slice(0, MAX_FINDINGS_IN_PROMPT)
    .map((f, i) => `${i + 1}. ${f.title || f.message || '(untitled finding)'}`)
    .join('\n');
}

// Mirrors reviewer.js parseReport — extracts the first {...} substring,
// JSON.parses it, with a single fallback that strips trailing commas.
function parseDraft(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('commit-context-generator: Claude did not return a JSON object');
  }
  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    const cleaned = jsonMatch[0].replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
    try {
      return JSON.parse(cleaned);
    } catch {
      throw new Error(`commit-context-generator: failed to parse draft JSON: ${e.message}`);
    }
  }
}

function clamp(str, max) {
  if (typeof str !== 'string') return '';
  const trimmed = str.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max).trimEnd();
}

async function generateCommitContextDraft({
  project,
  commitTitle,
  commitBody,
  files,
  aiReport,
}) {
  const owner = project?.owner || '(unknown owner)';
  const repo = project?.repo || '(unknown repo)';
  const framework = project?.framework || '(unknown framework)';
  const summary = aiReport?.summary || '(no summary)';

  const userContent = [
    `Project: ${owner}/${repo}`,
    `Framework: ${framework}`,
    '',
    `Commit title: ${commitTitle || '(no title)'}`,
    `Commit body: ${commitBody ? commitBody.slice(0, 500) : '(no body)'}`,
    '',
    'Files changed:',
    buildFileLines(files),
    '',
    'AI review summary:',
    summary,
    '',
    'Top findings:',
    buildFindingLines(aiReport),
  ].join('\n');

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  const text = (response?.content || [])
    .map((b) => (b && b.type === 'text' ? b.text : ''))
    .join('');

  const draft = parseDraft(text);

  if (typeof draft.title !== 'string' || draft.title.trim().length === 0) {
    throw new Error('commit-context-generator: draft.title was empty or not a string');
  }
  if (typeof draft.content !== 'string' || draft.content.trim().length === 0) {
    throw new Error('commit-context-generator: draft.content was empty or not a string');
  }

  return {
    title: clamp(draft.title, MAX_TITLE_CHARS),
    content: clamp(draft.content, MAX_CONTENT_CHARS),
  };
}

module.exports = { generateCommitContextDraft };
