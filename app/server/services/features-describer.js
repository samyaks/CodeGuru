const Anthropic = require('@anthropic-ai/sdk');
const { broadcast } = require('../lib/sse');
const { CLAUDE_MODEL, truncate } = require('../lib/constants');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You explain software projects to people who have NEVER written code.

Your reader might be a startup founder, a product manager, a designer, an investor, or someone who just found this project and wants to understand it. They don't know what an API is, what a database does, or what "deploying" means.

Your job: read the actual code files provided and explain what this software does, what features it has, and how someone would use it — all in plain, everyday language.

Rules:
- NEVER use programming words: no "API", "endpoint", "component", "middleware", "state", "render", "route", "hook", "prop", "schema", "migration", "function", "class", "module", "SDK", "CLI", "ORM", "SSR", "SSE", "REST", "CRUD", "JSON", "deploy"
- Replace jargon with analogies: "the app talks to GitHub" not "calls the GitHub API". "saves your work" not "persists to database". "checks who you are before letting you in" not "authenticates via OAuth"
- Be SPECIFIC about what the app actually does — don't say "handles data management", say "keeps a list of your past projects so you can go back to them"
- Write short paragraphs. Use bullet points. Use headers.
- Describe the user experience: what screens they see, what buttons they click, what happens next
- If parts of the app aren't built yet, say what's missing and why it matters

Structure your response EXACTLY like this:

## In a nutshell
(1-2 sentences. If you had 10 seconds to explain this app to someone in an elevator, what would you say?)

## What can you do with it?
(Each feature the app has, explained with: what it is, what happens when you use it, and why it's useful. Group related things under sub-headers like "Analyze a project" or "Get a code review".)

## What does the experience look like?
(Walk through opening the app → doing the main thing → getting results. Describe what the person sees and does at each step, like you're narrating a demo.)

## What's under the hood?
(In simple terms, explain the key parts — what reads the code, what writes the explanations, how information is saved. Use analogies: "Think of it like..." No jargon.)

## What's not built yet?
(If there are obvious gaps — no way to save your work, no login, no way to get it online — explain what's missing and what it would mean for users.)`;

async function describeFeatures(analysisId, codebaseModel) {
  broadcast(analysisId, {
    type: 'progress',
    phase: 'describing',
    message: 'Writing a plain-English summary of what this project does...',
  });

  const fileTree = codebaseModel.fileTree.slice(0, 80).join('\n');

  const keyFileEntries = Object.entries(codebaseModel.fileContents).slice(0, 15);
  const keyFiles = keyFileEntries
    .map(([path, content]) => `### ${path}\n\`\`\`\n${truncate(content, 2000)}\n\`\`\``)
    .join('\n\n');

  const stackLines = [
    codebaseModel.stack.framework && `Framework: ${codebaseModel.stack.framework}`,
    codebaseModel.stack.runtime && `Runtime: ${codebaseModel.stack.runtime}`,
    codebaseModel.stack.styling && `Styling: ${codebaseModel.stack.styling}`,
    codebaseModel.stack.database && `Database: ${codebaseModel.stack.database}`,
    codebaseModel.stack.auth && `Auth: ${codebaseModel.stack.auth}`,
    codebaseModel.stack.languages?.length && `Languages: ${codebaseModel.stack.languages.join(', ')}`,
  ].filter(Boolean).join('\n');

  const gapLines = Object.entries(codebaseModel.gaps)
    .map(([key, val]) => `${key}: ${val.exists ? 'present' : 'MISSING'}`)
    .join('\n');

  const featureLines = (codebaseModel.features || [])
    .map((f) => `- ${f.name} (${f.fileCount} files${f.hasUI ? ', has user interface' : ''}${f.hasAPI ? ', has server logic' : ''})`)
    .join('\n');

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    stream: true,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Read this codebase and explain what it does. The person reading your explanation has never written code.

## Project
Name: ${codebaseModel.meta.name}
Description: ${codebaseModel.meta.description || 'No description provided'}
${stackLines}

## What's detected as present or missing
${gapLines}

## Areas of the project
${featureLines}

## All files in the project
${fileTree}

## Actual code from the most important files
${keyFiles}

Now explain this project to someone who has never seen code before. What is it? What does it do? How would they use it? What's not finished?`,
    }],
  });

  let fullText = '';
  for await (const event of response) {
    if (event.type === 'content_block_delta' && event.delta?.text) {
      fullText += event.delta.text;
      broadcast(analysisId, {
        type: 'features-stream',
        partial: fullText,
      });
    }
  }

  broadcast(analysisId, {
    type: 'progress',
    phase: 'describing-done',
    message: 'Feature description complete',
  });

  return fullText;
}

module.exports = { describeFeatures };
