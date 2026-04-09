const { v4: uuidv4 } = require('uuid');
const { buildEntries } = require('./db');

function createAutoEntry(projectId, userId, { entryType, title, content, metadata = null, isPublic = true }) {
  try {
    buildEntries.create({
      id: uuidv4(),
      project_id: projectId,
      user_id: userId || 'system',
      entry_type: entryType,
      title,
      content,
      metadata: metadata,
      is_public: isPublic ? 1 : 0,
      created_at: new Date().toISOString(),
      sort_order: 0,
    });
  } catch (err) {
    console.error(`Auto-entry creation failed for ${projectId}:`, err.message);
  }
}

function seedFromAnalysis(projectId, userId, codebaseModel, readinessScore) {
  const stack = codebaseModel.stack;
  const stackParts = [stack.framework, stack.runtime, stack.styling, stack.database].filter(Boolean);

  createAutoEntry(projectId, userId, {
    entryType: 'milestone',
    title: 'Project analyzed',
    content: `Analyzed ${codebaseModel.meta.name || 'repository'}. Detected stack: ${stackParts.join(', ') || 'unknown'}. Production readiness score: ${readinessScore}%.`,
    metadata: { score: readinessScore, framework: stack.framework },
    isPublic: true,
  });

  const gaps = codebaseModel.gaps;
  const missingGaps = Object.entries(gaps)
    .filter(([_, v]) => !v.exists)
    .map(([k]) => k);

  if (missingGaps.length > 0) {
    createAutoEntry(projectId, userId, {
      entryType: 'note',
      title: 'Areas to build',
      content: `The analysis identified ${missingGaps.length} areas that need work: ${missingGaps.join(', ')}. A step-by-step plan has been generated.`,
      metadata: { gaps: missingGaps },
      isPublic: true,
    });
  }
}

function logDeployEvent(projectId, userId, { status, liveUrl, error }) {
  if (status === 'deploying') {
    createAutoEntry(projectId, userId, {
      entryType: 'deploy_event',
      title: 'Deployment started',
      content: 'Started deploying to production via Railway.',
      isPublic: true,
    });
  } else if (status === 'live' && liveUrl) {
    createAutoEntry(projectId, userId, {
      entryType: 'milestone',
      title: 'Deployed to production!',
      content: `App is now live at ${liveUrl}`,
      metadata: { live_url: liveUrl },
      isPublic: true,
    });
  } else if (status === 'failed') {
    createAutoEntry(projectId, userId, {
      entryType: 'deploy_event',
      title: 'Deployment failed',
      content: `Deploy failed: ${error || 'Unknown error'}`,
      isPublic: false,
    });
  }
}

module.exports = { createAutoEntry, seedFromAnalysis, logDeployEvent };
