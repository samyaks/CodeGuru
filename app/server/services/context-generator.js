const Anthropic = require('@anthropic-ai/sdk');
const { broadcast } = require('../lib/sse');
const { CLAUDE_MODEL, truncate } = require('../lib/constants');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MAX_TOKENS = 4096;

const SYSTEM_PROMPT = `You are an expert software architect analyzing a codebase to generate .context.md files. These files serve as the source of truth between human developers and AI coding tools.

Your output will be used by vibe coders — people who build apps primarily through AI tools like Cursor and Claude Code. They understand their app's purpose but may not know engineering best practices for auth, databases, deployment, etc.

For EXISTING code: document what's there accurately. Capture the purpose, constraints, decisions, and dependencies.

For MISSING capabilities: write a PRESCRIPTIVE context file that specifies what should be built. Include:
- What the capability needs to do (in plain English)
- Recommended approach given the existing tech stack
- Constraints that must be respected
- Common pitfalls to avoid
- How it connects to existing code

Always follow the .context.md spec format with these sections:
## owner, ## purpose, ## constraints, ## decisions, ## ai-log, ## dependencies, ## status

Keep language clear and non-technical where possible. A PM should be able to read and understand every context file.`;

async function generateContextFiles(analysisId, codebaseModel) {
  const send = (data) => broadcast(analysisId, data);
  const contextFiles = [];

  send({ type: 'progress', phase: 'context-start', message: 'Generating context files...' });

  // 1. App-level .context.md
  send({ type: 'progress', phase: 'context-app', message: 'Generating app-level .context.md...' });
  const appContext = await generateAppContext(analysisId, codebaseModel);
  contextFiles.push({ path: '.context.md', content: appContext, type: 'existing' });

  // 2. Feature-level .context.md files
  const featureDirs = identifyFeatureDirs(codebaseModel);
  for (const dir of featureDirs) {
    send({ type: 'progress', phase: 'context-feature', message: `Generating context for ${dir}...` });
    try {
      const featureContext = await generateFeatureContext(analysisId, codebaseModel, dir, appContext);
      if (featureContext) {
        contextFiles.push({ path: `${dir}/.context.md`, content: featureContext, type: 'existing' });
      }
    } catch (err) {
      console.error(`Failed to generate context for ${dir}:`, err.message);
    }
  }

  // 3. Gap-specific prescriptive .context.md files
  const gaps = identifyActionableGaps(codebaseModel);
  for (const gap of gaps) {
    send({ type: 'progress', phase: 'context-gap', message: `Generating spec for missing ${gap.name}...` });
    try {
      const gapContext = await generateGapContext(analysisId, codebaseModel, gap, appContext);
      contextFiles.push({ path: gap.path, content: gapContext, type: 'gap' });
    } catch (err) {
      console.error(`Failed to generate gap context for ${gap.name}:`, err.message);
    }
  }

  // 4. Completion report
  const completionPct = calculateCompletion(codebaseModel);

  send({ type: 'progress', phase: 'context-done', message: `Generated ${contextFiles.length} context files` });

  return { contextFiles, completionPct };
}

async function generateAppContext(analysisId, model) {
  const fileTree = model.fileTree.slice(0, 100).join('\n');
  const keyFiles = Object.entries(model.fileContents)
    .slice(0, 10)
    .map(([path, content]) => `### ${path}\n\`\`\`\n${truncate(content, 1500)}\n\`\`\``)
    .join('\n\n');

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    stream: true,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Generate the root .context.md file for this project.

## Project Info
Name: ${model.meta.name}
Description: ${model.meta.description || 'No description'}
Primary Language: ${model.meta.language || 'Unknown'}
Framework: ${model.stack.framework || 'Unknown'}
Runtime: ${model.stack.runtime || 'Unknown'}
Styling: ${model.stack.styling || 'None detected'}
Database: ${model.stack.database || 'None detected'}
Auth: ${model.stack.auth || 'None detected'}

## File Tree
${fileTree}

## Key Files
${keyFiles}

## Detected Gaps
Auth: ${model.gaps.auth.exists ? 'exists' : 'MISSING'}
Database: ${model.gaps.database.exists ? 'exists' : 'MISSING'}
Deployment: ${model.gaps.deployment.exists ? 'exists' : 'MISSING'}
Testing: ${model.gaps.testing.exists ? 'exists' : 'MISSING'}
Error Handling: ${model.gaps.errorHandling.exists ? 'exists' : 'MISSING'}

Generate a comprehensive .context.md that captures the project's purpose, tech stack, current state, and what still needs to be built.`,
    }],
  });

  let fullText = '';
  for await (const event of response) {
    if (event.type === 'content_block_delta' && event.delta?.text) {
      fullText += event.delta.text;
      broadcast(analysisId, {
        type: 'context-stream',
        path: '.context.md',
        partial: fullText,
      });
    }
  }

  return fullText;
}

async function generateFeatureContext(analysisId, model, dirPath, appContext) {
  const relevantFiles = Object.entries(model.fileContents)
    .filter(([path]) => path.startsWith(dirPath))
    .map(([path, content]) => `### ${path}\n\`\`\`\n${truncate(content, 1000)}\n\`\`\``)
    .join('\n\n');

  if (!relevantFiles) return null;

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Generate a .context.md file for the "${dirPath}" directory.

## App Context (from root .context.md)
${truncate(appContext, 1500)}

## Files in this directory
${relevantFiles}

## Stack
Framework: ${model.stack.framework || 'Unknown'}
Runtime: ${model.stack.runtime || 'Unknown'}

Generate a focused .context.md for this specific module. Include purpose, constraints, decisions, and dependencies.`,
    }],
  });

  return response.content?.[0]?.text || '';
}

async function generateGapContext(analysisId, model, gap, appContext) {
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    stream: true,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `This codebase is MISSING: ${gap.name}

Generate a PRESCRIPTIVE .context.md that specifies what should be built.

## App Context
${truncate(appContext, 1500)}

## Current Stack
Framework: ${model.stack.framework || 'Unknown'}
Runtime: ${model.stack.runtime || 'Unknown'}
Database: ${model.stack.database || 'None'}
Auth: ${model.stack.auth || 'None'}

## Gap Details
${gap.description}

## Requirements
The .context.md should tell an AI tool exactly what to build:
- What the capability needs to do
- Recommended approach for this tech stack
- Constraints that must be respected
- Common pitfalls to avoid
- How it connects to existing code
- Specific files that need to be created or modified

This is a PRESCRIPTIVE spec, not documentation of existing code.`,
    }],
  });

  let fullText = '';
  for await (const event of response) {
    if (event.type === 'content_block_delta' && event.delta?.text) {
      fullText += event.delta.text;
      broadcast(analysisId, {
        type: 'context-stream',
        path: gap.path,
        partial: fullText,
      });
    }
  }

  return fullText;
}

function identifyFeatureDirs(model) {
  const dirs = new Set();
  const seen = new Set();

  for (const [path] of Object.entries(model.fileContents)) {
    const parts = path.split('/');
    if (parts.length >= 2) {
      const topDir = parts[0];
      if (!seen.has(topDir) && !['node_modules', '.git', 'dist', 'build'].includes(topDir)) {
        seen.add(topDir);
        if (['src', 'app', 'server', 'client', 'lib', 'api', 'pages', 'components'].includes(topDir)) {
          if (parts.length >= 3) {
            dirs.add(`${parts[0]}/${parts[1]}`);
          }
        } else {
          dirs.add(topDir);
        }
      }
    }
  }

  return [...dirs].slice(0, 5);
}

function identifyActionableGaps(model) {
  const gaps = [];
  const g = model.gaps;

  if (!g.auth.exists) {
    gaps.push({
      name: 'Authentication',
      path: 'src/auth/.context.md',
      description: `No authentication system detected. Stack: ${model.stack.framework || 'Unknown'}, Runtime: ${model.stack.runtime || 'Unknown'}`,
    });
  }

  if (!g.database.exists) {
    gaps.push({
      name: 'Database',
      path: 'src/database/.context.md',
      description: `No database configuration detected. The app likely needs persistent storage for user data and application state.`,
    });
  }

  if (!g.deployment.exists) {
    gaps.push({
      name: 'Deployment',
      path: 'deploy/.context.md',
      description: `No deployment configuration found. No CI/CD pipeline, no hosting platform config, no containerization.`,
    });
  }

  if (!g.testing.exists) {
    gaps.push({
      name: 'Testing',
      path: 'tests/.context.md',
      description: `No test files detected. The codebase has no automated testing strategy.`,
    });
  }

  if (!g.errorHandling.exists) {
    gaps.push({
      name: 'Error Handling',
      path: 'src/error-handling/.context.md',
      description: `No global error handling strategy detected. Missing error boundaries, global error handlers, or structured error responses.`,
    });
  }

  return gaps;
}

function calculateCompletion(model) {
  const categories = {
    ui: 40,
    routing: 10,
    api: 15,
    auth: 10,
    database: 10,
    deployment: 10,
    testing: 5,
  };

  let earned = 0;
  const g = model.gaps;
  const paths = model.fileTree;

  const hasUI = paths.some((p) => /\.(tsx|jsx|vue|svelte)$/.test(p));
  if (hasUI) earned += categories.ui;

  const hasRouting = paths.some((p) => /route|page|app\.(tsx|jsx)/i.test(p));
  if (hasRouting) earned += categories.routing;

  const hasAPI = paths.some((p) => /api|route|controller|endpoint/i.test(p));
  if (hasAPI) earned += categories.api;

  if (g.auth.exists) earned += categories.auth;
  if (g.database.exists) earned += categories.database;
  if (g.deployment.exists) earned += categories.deployment;
  if (g.testing.exists) earned += categories.testing;

  return earned;
}

module.exports = { generateContextFiles, calculateCompletion };
