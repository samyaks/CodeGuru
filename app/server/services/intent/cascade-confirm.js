/**
 * Cascade confirmation — confirming a job confirms its high-confidence
 * invariants by inheritance (instant, LLM-free).
 */

const { intentStatements, statementJobs } = require('../../lib/db');
const { isAutoConfirmEligible } = require('./confidence');
const { hashLinkedFiles } = require('./satisfaction');
const { analysisFiles } = require('../../lib/db');

async function cascadeConfirmJob(projectId, jobId) {
  const candidates = await statementJobs.findStatementsForJob(jobId, { status: 'candidate' });
  if (candidates.length === 0) {
    return { confirmed: 0, leftCandidate: 0 };
  }

  const contents = await analysisFiles.getContentsMap(projectId).catch(() => ({}));
  let confirmed = 0;
  let leftCandidate = 0;

  for (const row of candidates) {
    if (!isAutoConfirmEligible(row.confidence)) {
      leftCandidate += 1;
      continue;
    }
    const codeHash = hashLinkedFiles(contents, row.links) ?? row.code_hash;
    await intentStatements.update(row.id, projectId, {
      status: 'confirmed',
      confirmed_via: 'job',
      code_hash: codeHash,
      satisfied: row.satisfied !== false,
      last_checked_at: new Date().toISOString(),
    });
    confirmed += 1;
  }

  return { confirmed, leftCandidate };
}

async function confirmStatementDirect(projectId, statementId) {
  const row = await intentStatements.findById(statementId, projectId);
  if (!row) return null;
  const contents = await analysisFiles.getContentsMap(projectId).catch(() => ({}));
  const codeHash = hashLinkedFiles(contents, row.links) ?? row.code_hash;
  return intentStatements.update(statementId, projectId, {
    status: 'confirmed',
    confirmed_via: 'direct',
    code_hash: codeHash,
    satisfied: row.satisfied !== false,
    last_checked_at: new Date().toISOString(),
  });
}

module.exports = { cascadeConfirmJob, confirmStatementDirect };
