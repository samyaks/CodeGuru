const crypto = require('crypto');
const { CLAUDE_MODEL, anthropic, truncate } = require('../lib/constants');
const { broadcast } = require('../lib/sse');

const SYSTEM_PROMPT = `You are a senior staff engineer and product advisor reviewing a codebase.
You've been given a list of static analysis findings that were already identified.
Your job is to go deeper and find things that pattern-matching rules cannot:

1. BUSINESS LOGIC SUGGESTIONS — Based on what this app does, what features
   are users going to expect? (e.g., a SaaS app without billing, a social
   app without notifications, an e-commerce app without search)

2. ARCHITECTURE SUGGESTIONS — Given the stack and codebase size, what
   architectural improvements would prevent problems at scale? (e.g.,
   extract shared logic into hooks, add API versioning, separate concerns)

3. BUG DETECTION — Read the actual code. Find logic errors, race conditions,
   incorrect API usage, missing edge cases. Cite specific files and lines.

4. STACK-SPECIFIC BEST PRACTICES — Based on the framework, what
   framework-specific patterns is the codebase violating?

Return a JSON array of suggestions. Each suggestion must have:
{
  "type": "bug" | "fix" | "feature" | "idea" | "perf",
  "category": string (e.g. "security", "ux", "architecture", "performance"),
  "priority": "critical" | "high" | "medium" | "low",
  "title": string (short, actionable),
  "description": string (why this matters, 1-2 sentences),
  "evidence": [{ "file": string, "line": number|null, "snippet": string|null, "reason": string }],
  "effort": "quick" | "medium" | "large",
  "cursor_prompt": string (a detailed prompt someone can paste into Cursor to implement this fix/feature),
  "affected_files": [string]
}

Rules:
- Do NOT repeat suggestions already in the static findings list
- Every suggestion MUST cite specific files as evidence
- Prioritize suggestions that prevent real user-facing problems
- cursor_prompt should be detailed and actionable — imagine pasting it into an AI code editor
- Return 10-15 high-signal suggestions — quality over quantity
- Return ONLY the JSON array, no other text. Do not wrap in markdown code fences.`;

const KEY_FILE_PATTERNS = [
  /route/i, /api/i, /controller/i,
  /auth/i,
  /schema/i, /model/i, /migration/i, /database/i, /db/i, /prisma/i,
  /(^|\/)config\b/i,
  /(^|\/)(index|main|app|server)\.(js|ts|tsx)$/,
];

function extractNotBuiltSection(featuresSummary) {
  if (!featuresSummary) return 'Not available';
  const marker = "## What's not built yet?";
  const idx = featuresSummary.indexOf(marker);
  if (idx === -1) return truncate(featuresSummary, 2000);
  const after = featuresSummary.slice(idx);
  const nextSection = after.indexOf('\n## ', marker.length);
  const section = nextSection === -1 ? after : after.slice(0, nextSection);
  return truncate(section, 2000);
}

function scoreFile(path) {
  for (let i = 0; i < KEY_FILE_PATTERNS.length; i++) {
    if (KEY_FILE_PATTERNS[i].test(path)) return KEY_FILE_PATTERNS.length - i;
  }
  return 0;
}

function buildKeyFilesSection(fileContents) {
  const entries = Object.entries(fileContents)
    .filter(([p]) => !p.toLowerCase().includes('.env'))
    .sort((a, b) => scoreFile(b[0]) - scoreFile(a[0]))
    .slice(0, 20);

  return entries
    .map(([path, content]) => `### ${path}\n\`\`\`\n${truncate(content, 2000)}\n\`\`\``)
    .join('\n\n');
}

function buildUserMessage({ stack, gaps, features, fileTree, fileContents, staticSuggestions, featuresSummary }) {
  const s = stack || {};
  const sections = [
    `## Project
Name: ${s.framework || 'Unknown'} app
Stack: ${s.framework || 'unknown'}, ${s.runtime || 'unknown'}, ${s.database || 'unknown'}, ${s.auth || 'unknown'}, ${s.styling || 'unknown'}
Languages: ${(s.languages || []).join(', ') || 'unknown'}`,

    `## Already-identified issues (do NOT duplicate these)
${(staticSuggestions || []).map(sg => `- [${sg.type}/${sg.priority}] ${sg.title}`).join('\n') || 'None'}`,

    `## What's detected as present or missing
${Object.entries(gaps || {}).map(([key, val]) => `${key}: ${val && val.exists ? 'present' : 'MISSING'}`).join('\n') || 'No gap data'}`,

    `## Areas of the project
${(features || []).map(f => `- ${f.name} (${f.fileCount} files${f.hasUI ? ', has UI' : ''}${f.hasAPI ? ', has API' : ''})`).join('\n') || 'No features detected'}`,

    `## What's not built yet (from plain-English analysis)
${extractNotBuiltSection(featuresSummary)}`,

    `## All files in the project
${(fileTree || []).slice(0, 100).join('\n')}`,

    `## Key source files
${buildKeyFilesSection(fileContents || {})}`,
  ];

  return sections.join('\n\n');
}

function parseResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch { /* fall through */ }
    }
    return null;
  }
}

function isTooSimilar(title, existingTitles) {
  const lower = title.toLowerCase();
  return existingTitles.some(t => lower.includes(t) || t.includes(lower));
}

const VALID_TYPES = new Set(['bug', 'fix', 'feature', 'idea', 'perf']);
const VALID_PRIORITIES = new Set(['critical', 'high', 'medium', 'low']);
const VALID_EFFORTS = new Set(['quick', 'medium', 'large']);

function processSuggestions(raw, staticSuggestions) {
  if (!Array.isArray(raw)) return [];

  const existingTitles = (staticSuggestions || []).map(s => s.title.toLowerCase());
  const results = [];

  for (const s of raw) {
    if (!s.type || !s.category || !s.priority || !s.title || !s.description) continue;
    if (!VALID_TYPES.has(s.type) || !VALID_PRIORITIES.has(s.priority)) continue;
    if (isTooSimilar(s.title, existingTitles)) continue;

    results.push({
      id: crypto.createHash('sha256').update('ai' + s.type + s.category + s.title).digest('hex').slice(0, 16),
      type: s.type,
      category: s.category,
      priority: s.priority,
      title: s.title,
      description: s.description,
      evidence: Array.isArray(s.evidence) ? s.evidence : [],
      effort: VALID_EFFORTS.has(s.effort) ? s.effort : 'medium',
      cursor_prompt: s.cursor_prompt || '',
      affected_files: Array.isArray(s.affected_files) ? s.affected_files : [],
      source: 'ai',
      status: 'open',
    });
  }

  return results;
}

async function runAISuggestions({ projectId, stack, gaps, features, fileContents, fileTree, staticSuggestions, featuresSummary }) {
  broadcast(projectId, { type: 'progress', phase: 'ai-suggestions', message: 'AI is analyzing your codebase for deeper suggestions...' });

  try {
    const userMessage = buildUserMessage({ stack, gaps, features, fileTree, fileContents, staticSuggestions, featuresSummary });

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    const parsed = parseResponse(text);
    if (!parsed) {
      console.error(`AI suggestions for ${projectId}: failed to parse response`);
      broadcast(projectId, { type: 'suggestions-ai-error', error: 'Failed to parse AI response' });
      return [];
    }

    const results = processSuggestions(parsed, staticSuggestions);

    broadcast(projectId, { type: 'suggestions-ai', count: results.length, suggestions: results.slice(0, 5) });

    return results;
  } catch (err) {
    console.error(`AI suggestions for ${projectId} failed:`, err.message);
    broadcast(projectId, { type: 'suggestions-ai-error', error: err.message });
    return [];
  }
}

module.exports = { runAISuggestions };
