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

    deploySection = `

## Deployment & Infrastructure Configuration

Detected deployment files:
${summary.join('\n')}

${deployFileSection}`;
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
- If deployment/infrastructure configuration files are provided, analyze the deployment setup and include a "deployment" section in your report. If no deployment files are found, set deployment.status to "no_config_found" and provide suggestions for setting up deployment.

Respond with ONLY a JSON object (no markdown fences, no extra text). The JSON must conform exactly to this schema:

{
  "summary": "string — 3-5 sentence overall assessment",
  "overallHealth": "healthy" | "needs_attention" | "concerning",
  "strengths": ["string — things done well"],
  "findings": [
    {
      "file": "string — file path or 'general'",
      "line": number | null,
      "category": "architecture" | "bug" | "security" | "performance" | "style" | "complexity" | "documentation" | "testing",
      "severity": "critical" | "warning" | "info",
      "title": "string — one-line title",
      "description": "string — detailed explanation and suggested fix"
    }
  ],
  "filesummaries": [
    {
      "file": "string — file path",
      "severity": "critical" | "warning" | "info" | "ok",
      "comment": "string — one-line summary"
    }
  ],
  "recommendations": {
    "immediate": ["string — do now"],
    "shortTerm": ["string — do this sprint"],
    "longTerm": ["string — plan for"]
  },
  "stats": {
    "totalFindings": number,
    "critical": number,
    "warnings": number,
    "info": number
  },
  "deployment": {
    "status": "deployed" | "partial" | "no_config_found",
    "summary": "string — 2-3 sentence overview of the deployment setup",
    "platforms": ["string — detected hosting/deployment platforms, e.g. 'Vercel', 'Docker', 'AWS'"],
    "cicd": "string — description of CI/CD pipeline, or 'None detected'",
    "containerized": boolean,
    "iac": "string — Infrastructure as Code tools detected, or 'None detected'",
    "concerns": ["string — deployment-related issues or risks found"],
    "suggestions": ["string — improvements to the deployment setup"]
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

function truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '\n... (truncated)';
}

module.exports = { buildRepoReviewPrompt };
