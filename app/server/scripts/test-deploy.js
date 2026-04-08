#!/usr/bin/env node

/**
 * Phase 0 verification script.
 *
 * Usage:
 *   node app/server/scripts/test-deploy.js <github-url> [--dry-run]
 *
 * --dry-run: analyze + build plan only, skip Railway deploy
 *
 * Requires: GITHUB_TOKEN (optional), RAILWAY_API_TOKEN (required unless --dry-run)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const github = require('../services/github');
const { analyzeRepo } = require('../services/analyzer');
const { detectBuildPlan } = require('../services/build-detector');
const { detectDeploymentFiles } = require('../services/deployment');

const repoUrl = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

if (!repoUrl) {
  console.error('Usage: node test-deploy.js <github-url> [--dry-run]');
  process.exit(1);
}

async function main() {
  console.log(`\n🔍 Analyzing: ${repoUrl}\n`);

  // Step 1: Quick analysis (same as analyzer.js but we capture progress)
  const codebaseModel = await analyzeRepo(repoUrl, (progress) => {
    console.log(`  [${progress.phase}] ${progress.message}`);
  });

  console.log('\n📊 Stack Detection:');
  console.log(`  Framework: ${codebaseModel.stack.framework || 'none'}`);
  console.log(`  Runtime:   ${codebaseModel.stack.runtime || 'unknown'}`);
  console.log(`  Styling:   ${codebaseModel.stack.styling || 'none'}`);
  console.log(`  Database:  ${codebaseModel.stack.database || 'none'}`);
  console.log(`  Auth:      ${codebaseModel.stack.auth || 'none'}`);
  console.log(`  Languages: ${codebaseModel.stack.languages.join(', ')}`);

  // Step 2: Build plan
  const buildPlan = detectBuildPlan({
    stack: codebaseModel.stack,
    fileTree: codebaseModel.fileTree,
    fileContents: codebaseModel.fileContents,
    deployInfo: codebaseModel.deployInfo,
  });

  console.log('\n🏗️  Build Plan:');
  console.log(`  Type:          ${buildPlan.type}`);
  console.log(`  Framework:     ${buildPlan.framework}`);
  console.log(`  Build command: ${buildPlan.buildCommand || '(none)'}`);
  console.log(`  Start command: ${buildPlan.startCommand || '(none — static site)'}`);
  console.log(`  Output dir:    ${buildPlan.outputDir || '(n/a)'}`);
  console.log(`  Port:          ${buildPlan.port || '(n/a)'}`);
  console.log(`  Dockerfile:    ${buildPlan.hasDockerfile ? 'yes' : 'no'}`);
  console.log(`  Confidence:    ${buildPlan.confidence}`);
  console.log(`  Reason:        ${buildPlan.reason}`);

  if (buildPlan.envVarsRequired.length > 0) {
    console.log('\n  Env vars needed:');
    for (const v of buildPlan.envVarsRequired) {
      console.log(`    ${v.name}${v.hasDefault ? ` (has default: ${v.value})` : ' (required)'}`);
    }
  }

  // Step 3: Deploy (unless --dry-run)
  if (dryRun) {
    console.log('\n✅ Dry run complete. Add RAILWAY_API_TOKEN and remove --dry-run to deploy.\n');
    return;
  }

  if (!process.env.RAILWAY_API_TOKEN) {
    console.error('\n❌ RAILWAY_API_TOKEN not set. Set it in app/.env or use --dry-run.\n');
    process.exit(1);
  }

  const railway = require('@codeguru/railway');
  const { owner, repo } = github.parseRepoUrl(repoUrl);
  const projectName = `takeoff-${repo}`.toLowerCase().slice(0, 32);

  console.log(`\n🚀 Deploying ${owner}/${repo} to Railway as "${projectName}"...\n`);

  try {
    const result = await railway.deployFromRepo(`${owner}/${repo}`, {
      projectName,
      branch: codebaseModel.meta.defaultBranch || 'main',
      onProgress: (p) => {
        console.log(`  [${p.phase}] ${p.message}`);
      },
    });

    if (result.status === 'SUCCESS') {
      console.log(`\n✅ Deployed successfully!`);
      console.log(`   URL: ${result.url}`);
      console.log(`   Railway Project ID: ${result.projectId}`);
      console.log(`   Railway Service ID: ${result.serviceId}`);
    } else {
      console.log(`\n⚠️  Deploy finished with status: ${result.status}`);
      console.log(`   URL: ${result.url}`);
      console.log(`   You may need to check Railway dashboard for details.`);
    }
  } catch (err) {
    console.error(`\n❌ Deploy failed: ${err.message}`);
    if (err.graphqlErrors) {
      for (const e of err.graphqlErrors) {
        console.error(`   GraphQL: ${e.message}`);
      }
    }
    process.exit(1);
  }

  console.log('');
}

main().catch((err) => {
  console.error(`\n❌ Error: ${err.message}\n`);
  process.exit(1);
});
