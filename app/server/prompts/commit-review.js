function buildCommitReviewPrompt({
  owner,
  repo,
  afterSha,
  beforeSha,
  ref,
  commitTitle,
  commitBody,
  files,
  deployInfo,
}) {
  const fileSection = files
    .map((f) => {
      const header = `### ${f.filename} (${f.status}, +${f.additions} -${f.deletions})`;
      const patch = f.patch ? `\`\`\`diff\n${f.patch}\n\`\`\`` : '_Binary or empty diff_';
      return `${header}\n${patch}`;
    })
    .join('\n\n');

  let deployNote = '';
  if (deployInfo && deployInfo.detected) {
    const changed = deployInfo.allPaths;
    const platforms = [
      ...deployInfo.cicd.map((d) => d.platform),
      ...deployInfo.hosting.map((d) => d.platform),
      ...deployInfo.containers.map((d) => d.platform),
      ...deployInfo.iac.map((d) => d.platform),
    ];
    deployNote = `\n\n**Deployment-related paths in this change:** ${changed.join(', ')}\n**Platforms affected:** ${[...new Set(platforms)].join(', ')}\n\nAssess deployment impact in your report.`;
  }

  const deploySchemaNote = deployInfo && deployInfo.detected
    ? `
  "deployment": {
    "status": "deployed" | "partial" | "no_config_found" | "not_applicable",
    "summary": "string",
    "platforms": ["string"],
    "cicd": "string",
    "containerized": boolean,
    "iac": "string",
    "concerns": ["string"],
    "suggestions": ["string"]
  }`
    : `
  "deployment": {
    "status": "not_applicable",
    "summary": "No deployment configuration touched in this push",
    "platforms": [],
    "cicd": "Not affected",
    "containerized": false,
    "iac": "Not affected",
    "concerns": [],
    "suggestions": []
  }`;

  return {
    system: `You are a senior staff engineer reviewing a single pushed change (one or more commits between two SHAs).
The diff may include multiple commits from one push; treat it as one reviewable unit.

Guidelines:
- Be specific: reference file names and line numbers from the diff when possible.
- Categorize every finding into exactly one of: bug, security, performance, style, complexity, documentation.
- Assign severity: critical, warning, or info.
- Keep the overall summary concise (3-5 sentences).
- If the change looks clean, say so.

Respond with ONLY a JSON object (no markdown fences, no extra text). The JSON must conform exactly to this schema:

{
  "summary": "string",
  "verdict": "approve" | "request_changes" | "needs_discussion",
  "findings": [
    {
      "file": "string",
      "line": number | null,
      "category": "bug" | "security" | "performance" | "style" | "complexity" | "documentation",
      "severity": "critical" | "warning" | "info",
      "title": "string",
      "description": "string"
    }
  ],
  "filesummaries": [
    {
      "file": "string",
      "severity": "critical" | "warning" | "info" | "ok",
      "comment": "string"
    }
  ],
  "stats": {
    "totalFindings": number,
    "critical": number,
    "warnings": number,
    "info": number
  },${deploySchemaNote}
}`,

    user: `Review this push to ${owner}/${repo}.

**Branch ref:** ${ref || '(unknown)'}
**Range:** ${beforeSha || '(initial or unknown)'} → ${afterSha}
**Commit title:** ${commitTitle || '(no title)'}
${commitBody ? `**Commit message:** ${commitBody}` : ''}${deployNote}

## Changed files (diff)

${fileSection}`,
  };
}

module.exports = { buildCommitReviewPrompt };
