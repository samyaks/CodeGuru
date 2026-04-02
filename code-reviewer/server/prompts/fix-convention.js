/**
 * Builds the Claude prompt that finds codebase convention references for each finding.
 * One call handles all findings in a review to minimize API usage.
 */
function buildConventionSearchPrompt({ findings, fileContents }) {
  const filesSection = fileContents
    .filter((f) => f.content)
    .map((f) => `### ${f.path}\n\`\`\`\n${truncate(f.content, 2500)}\n\`\`\``)
    .join('\n\n');

  const findingsSection = findings
    .map((f, i) => `[${i}] ${f.severity} | ${f.category} | ${f.file}:${f.line || '?'} — ${f.title}\n    ${f.description}`)
    .join('\n\n');

  return {
    system: `You are an expert code analyst. Given a list of code review findings and the source files from the repository, your job is to:

1. For each finding, identify the BEST existing code in the provided files that demonstrates how this pattern should be handled correctly (the "convention reference").
2. Identify related files the developer should be aware of when fixing this issue.

Rules:
- Only reference code that is ACTUALLY present in the provided files. Never invent code.
- The convention reference should be from a DIFFERENT location than the issue itself.
- If no good convention reference exists in the provided files, set referenceFile to null.
- For related files, only list files from the provided set that are genuinely relevant.
- Keep reference snippets concise (10-30 lines max).
- For each finding, also extract a clean code snippet showing the problematic code (15 lines of context around the issue line).

Respond with ONLY a JSON array (no markdown fences). Each element must match this schema:

[
  {
    "findingIndex": number,
    "codeSnippet": "string — the problematic code with ~15 lines of surrounding context",
    "snippetLineStart": number | null,
    "snippetLineEnd": number | null,
    "referenceFile": "string — file path of the convention reference, or null",
    "referenceSnippet": "string — the reference code showing correct pattern, or null",
    "referenceLineStart": number | null,
    "referenceLineEnd": number | null,
    "relatedFiles": [
      { "path": "string", "reason": "string — why this file is relevant to the fix" }
    ]
  }
]`,

    user: `Find convention references for these findings.

## Findings

${findingsSection}

## Repository Files

${filesSection}`,
  };
}

function truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '\n... (truncated)';
}

module.exports = { buildConventionSearchPrompt };
