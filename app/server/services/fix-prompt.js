const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { fixPrompts } = require('../lib/db');
const { broadcast } = require('../lib/sse');
const { buildConventionSearchPrompt } = require('../prompts/fix-convention');
const { CLAUDE_MODEL, anthropic } = require('../lib/constants');

const ACTIONABLE_CATEGORIES = new Set([
  'bug', 'security', 'performance', 'complexity', 'style',
  'documentation', 'testing', 'error-handling', 'input-validation',
  'naming-convention', 'missing-types', 'missing-tests', 'duplicate-utility',
]);

const SECRET_PATTERNS = [
  /(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
  /(?:secret|password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}['"]/gi,
  /(?:token|bearer)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
  /(?:access[_-]?key|secret[_-]?key)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
  /(?:mongodb|postgres|mysql|redis):\/\/[^\s'"]+/gi,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END/gi,
  /ghp_[a-zA-Z0-9]{36}/g,
  /sk-[a-zA-Z0-9]{32,}/g,
  /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/g,
];

const CONTEXT_LINES = 15;
const MAX_RELATED_FILES = 3;
const EXPIRY_DAYS = 30;

async function generateFixPrompts(reviewId, review, report, fileContents) {
  const findings = (report.findings || []).filter(
    (f) => f.file && f.file !== 'general' && ACTIONABLE_CATEGORIES.has(f.category)
  );

  if (findings.length === 0) {
    console.log(`No actionable findings for fix prompts in review ${reviewId}`);
    return [];
  }

  broadcast(reviewId, {
    type: 'progress',
    phase: 'fix-prompts',
    message: `Generating fix prompts for ${findings.length} findings...`,
  });

  let conventions = [];
  try {
    conventions = await findConventions(findings, fileContents);
  } catch (err) {
    console.error('Convention search failed, proceeding without conventions:', err.message);
    conventions = findings.map((_, i) => ({
      findingIndex: i,
      codeSnippet: null,
      referenceFile: null,
      referenceSnippet: null,
      relatedFiles: [],
    }));
  }

  const prompts = [];
  for (let i = 0; i < findings.length; i++) {
    const finding = findings[i];
    const convention = conventions.find((c) => c.findingIndex === i) || {};

    const codeSnippet = convention.codeSnippet || extractSnippetFromFiles(finding, fileContents);
    const language = detectLanguage(finding.file);

    const fullPrompt = buildPromptText({
      finding, language,
      codeSnippet: redactSecrets(codeSnippet || ''),
      snippetLineStart: convention.snippetLineStart || finding.line,
      snippetLineEnd: convention.snippetLineEnd || (finding.line ? finding.line + CONTEXT_LINES : null),
      referenceFile: convention.referenceFile,
      referenceSnippet: convention.referenceSnippet ? redactSecrets(convention.referenceSnippet) : null,
      referenceLineStart: convention.referenceLineStart,
      referenceLineEnd: convention.referenceLineEnd,
      relatedFiles: (convention.relatedFiles || []).slice(0, MAX_RELATED_FILES),
      owner: review.owner,
      repo: review.repo,
    });

    const shortId = await generateShortId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const prompt = {
      id: uuidv4(),
      short_id: shortId,
      review_id: reviewId,
      file_path: finding.file,
      line_start: convention.snippetLineStart || finding.line || null,
      line_end: convention.snippetLineEnd || null,
      issue_category: finding.category,
      issue_title: finding.title,
      issue_description: finding.description,
      severity: finding.severity,
      code_snippet: codeSnippet ? redactSecrets(codeSnippet) : null,
      reference_file_path: convention.referenceFile || null,
      reference_snippet: convention.referenceSnippet ? redactSecrets(convention.referenceSnippet) : null,
      related_files: convention.relatedFiles || [],
      full_prompt: fullPrompt,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };

    await fixPrompts.create(prompt);
    prompts.push(prompt);
  }

  broadcast(reviewId, {
    type: 'progress',
    phase: 'fix-prompts-done',
    message: `Generated ${prompts.length} fix prompts`,
  });

  return prompts;
}

async function findConventions(findings, fileContents) {
  const { system, user } = buildConventionSearchPrompt({ findings, fileContents });
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const text = response.content?.[0]?.text || '';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    const cleaned = jsonMatch[0].replace(/,\s*]/g, ']').replace(/,\s*}/g, '}');
    try { return JSON.parse(cleaned); } catch { return []; }
  }
}

function extractSnippetFromFiles(finding, fileContents) {
  const file = fileContents.find((f) => f.path === finding.file || f.path?.endsWith(finding.file));
  if (!file?.content) return null;
  const lines = file.content.split('\n');
  if (!finding.line) return lines.slice(0, 30).join('\n');
  const start = Math.max(0, finding.line - CONTEXT_LINES - 1);
  const end = Math.min(lines.length, finding.line + CONTEXT_LINES);
  return lines.slice(start, end).join('\n');
}

function buildPromptText({
  finding, language, codeSnippet, snippetLineStart, snippetLineEnd,
  referenceFile, referenceSnippet, referenceLineStart, referenceLineEnd,
  relatedFiles, owner, repo,
}) {
  const lines = [];
  lines.push('## Task', '');
  lines.push(`Fix the following issue in \`${finding.file}\`${snippetLineStart ? ` (lines ${snippetLineStart}-${snippetLineEnd || '?'})` : ''}.`);
  lines.push('', '## Issue', '');
  lines.push(finding.description, '');
  lines.push(`Severity: ${finding.severity}`, `Category: ${finding.category}`, '');

  if (codeSnippet) {
    lines.push('## Current code', '');
    lines.push(`\`\`\`${language}`);
    lines.push(`// ${finding.file}${snippetLineStart ? `, lines ${snippetLineStart}-${snippetLineEnd || '?'}` : ''}`);
    lines.push(codeSnippet, '```', '');
  }

  if (referenceFile && referenceSnippet) {
    lines.push('## Codebase convention', '');
    lines.push('The rest of this codebase handles this pattern as follows. Use this as a reference for your fix:', '');
    lines.push(`\`\`\`${language}`);
    lines.push(`// ${referenceFile}${referenceLineStart ? `, lines ${referenceLineStart}-${referenceLineEnd || '?'}` : ''}`);
    lines.push(referenceSnippet, '```', '');
  } else {
    lines.push('## Note', '');
    lines.push(`No existing pattern was found in this codebase for this type of fix. Apply standard best practices for ${language}.`, '');
  }

  if (relatedFiles.length > 0) {
    lines.push('## Related files for context', '');
    for (const rf of relatedFiles) lines.push(`- \`${rf.path}\`: ${rf.reason}`);
    lines.push('');
  }

  lines.push('## Requirements', '');
  lines.push('- Follow the pattern shown in the codebase convention above (if provided)');
  lines.push('- Do not change the function signature or public API');
  lines.push('- Maintain existing test compatibility');
  lines.push('- Keep the fix minimal — only change what is necessary to resolve the issue');
  lines.push(`- Repository: ${owner}/${repo}`);

  return lines.join('\n');
}

function detectLanguage(filePath) {
  if (!filePath) return '';
  const ext = filePath.split('.').pop()?.toLowerCase();
  const map = {
    js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    kt: 'kotlin', swift: 'swift', cs: 'csharp', cpp: 'cpp', c: 'c',
    php: 'php', yml: 'yaml', yaml: 'yaml', json: 'json', md: 'markdown',
    sh: 'bash', sql: 'sql', tf: 'hcl', css: 'css', html: 'html',
  };
  return map[ext] || ext || '';
}

function redactSecrets(text) {
  let result = text;
  for (const pattern of SECRET_PATTERNS) result = result.replace(pattern, '[REDACTED]');
  return result;
}

async function generateShortId() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const id = crypto.randomBytes(6).toString('base64url').slice(0, 8);
    if (!(await fixPrompts.shortIdExists(id))) return id;
  }
  return crypto.randomBytes(8).toString('base64url').slice(0, 12);
}

module.exports = { generateFixPrompts };
