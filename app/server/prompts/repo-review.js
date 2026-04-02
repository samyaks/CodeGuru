const { truncate } = require('../lib/constants');

function buildRepoReviewPrompt({ owner, repo, files, deployInfo, deployFiles }) {
  const fileSection = files
    .filter((f) => f.content)
    .map((f) => `### ${f.path} (${f.size} bytes)\n\`\`\`\n${truncate(f.content, 3000)}\n\`\`\``)
    .join('\n\n');

  const fileList = files.map((f) => f.path).join('\n');

  let deploySection = '';
  if (deployInfo && deployInfo.detected) {
    const deployFileSection = (deployFiles || [])
      .filter((f) => f.content)
      .map((f) => `### ${f.path}\n\`\`\`\n${truncate(f.content, 2000)}\n\`\`\``)
      .join('\n\n');

    const summary = [];
    if (deployInfo.cicd.length) summary.push(`CI/CD: ${deployInfo.cicd.map((d) => `${d.platform} (${d.path})`).join(', ')}`);
    if (deployInfo.hosting.length) summary.push(`Hosting: ${deployInfo.hosting.map((d) => `${d.platform} (${d.path})`).join(', ')}`);
    if (deployInfo.containers.length) summary.push(`Containers: ${deployInfo.containers.map((d) => `${d.platform} (${d.path})`).join(', ')}`);
    if (deployInfo.iac.length) summary.push(`IaC: ${deployInfo.iac.map((d) => `${d.platform} (${d.path})`).join(', ')}`);

    deploySection = `\n\n## Deployment & Infrastructure Configuration\n\nDetected deployment files:\n${summary.join('\n')}\n\n${deployFileSection}`;
  }

  return {
    system: `You are a senior staff engineer performing a codebase quality review.
Your report will be used by a human tech lead to prioritize improvements and onboard new developers.

Guidelines:
- Assess architecture, code quality, patterns, and maintainability.
- Categorize findings: architecture, bug, security, performance, style, complexity, documentation, testing.
- Assign severity: critical, warning, or info.
- Be constructive — note what's done well alongside what needs improvement.
- Keep the overall summary to 3-5 sentences.

Respond with ONLY a JSON object (no markdown fences, no extra text). The JSON must conform exactly to this schema:

{
  "summary": "string",
  "overallHealth": "healthy" | "needs_attention" | "concerning",
  "strengths": ["string"],
  "findings": [
    {
      "file": "string",
      "line": number | null,
      "category": "architecture" | "bug" | "security" | "performance" | "style" | "complexity" | "documentation" | "testing",
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
  "recommendations": {
    "immediate": ["string"],
    "shortTerm": ["string"],
    "longTerm": ["string"]
  },
  "stats": {
    "totalFindings": number,
    "critical": number,
    "warnings": number,
    "info": number
  },
  "deployment": {
    "status": "deployed" | "partial" | "no_config_found",
    "summary": "string",
    "platforms": ["string"],
    "cicd": "string",
    "containerized": boolean,
    "iac": "string",
    "concerns": ["string"],
    "suggestions": ["string"]
  }
}`,

    user: `Review this repository.

**Repository:** ${owner}/${repo}

## File Tree
${fileList}

## File Contents (sampled)

${fileSection}${deploySection}`,
  };
}

module.exports = { buildRepoReviewPrompt };
