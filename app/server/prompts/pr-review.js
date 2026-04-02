function buildPRReviewPrompt({ owner, repo, prNumber, prTitle, prBody, files, deployInfo }) {
  const fileSection = files
    .map((f) => {
      const header = `### ${f.filename} (${f.status}, +${f.additions} -${f.deletions})`;
      const patch = f.patch ? `\`\`\`diff\n${f.patch}\n\`\`\`` : '_Binary or empty file_';
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
    deployNote = `\n\n**Deployment files changed in this PR:** ${changed.join(', ')}\n**Platforms affected:** ${[...new Set(platforms)].join(', ')}\n\nPay special attention to these deployment configuration changes and include a "deployment" section in your report assessing the impact.`;
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
    "summary": "No deployment files changed in this PR",
    "platforms": [],
    "cicd": "Not affected",
    "containerized": false,
    "iac": "Not affected",
    "concerns": [],
    "suggestions": []
  }`;

  return {
    system: `You are a senior staff engineer performing a thorough first-pass code review.
Your review will be handed to a human reviewer as a structured report so they can focus on high-level decisions rather than catching routine issues.

Guidelines:
- Be specific: reference file names and line numbers from the diff when possible.
- Categorize every finding into exactly one of: bug, security, performance, style, complexity, documentation.
- Assign a severity to every finding: critical, warning, or info.
- "critical" = likely production bug or security vulnerability.
- "warning" = should be fixed before merge but not a showstopper.
- "info" = suggestion or nit that improves quality.
- Keep your overall summary concise (3-5 sentences) and actionable.
- If the PR looks clean, say so — don't invent problems.

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

    user: `Review this pull request.

**Repository:** ${owner}/${repo}
**PR #${prNumber}:** ${prTitle || '(no title)'}
${prBody ? `**Description:** ${prBody}` : ''}${deployNote}

## Changed Files

${fileSection}`,
  };
}

module.exports = { buildPRReviewPrompt };
