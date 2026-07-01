/**
 * Intent MCP tool logic — Phase 7 (transport-agnostic).
 *
 * The five tools that expose the intent substrate to agents, implemented as
 * plain async functions returning JSON-serializable data. The MCP server
 * (or any other transport) is a thin wrapper over these — keeping the tool
 * behavior here makes it unit-testable without standing up a server or a
 * transport/auth decision.
 *
 *   get_intent    -> confirmed statements (the shared spec)          [DB read]
 *   check_intent  -> confirmed statements touching a file            [DB read]
 *   claim_intent  -> stake a claim on a statement/area               [DB write]
 *   get_my_gaps   -> open gaps under this claimant's claims          [DB read]
 *   resolve_gap   -> re-check one statement's satisfaction           [1 LLM call]
 *
 * Tools 1-4 are LLM-free. Invalid input throws McpToolError (the wrapper maps
 * it to a structured tool error); a missing project/statement throws too.
 */

const { deployments, intentStatements, claims, analysisFiles } = require('../../lib/db');
const { toStatement } = require('./intent-mapper');
const { synthesizeIntentGaps } = require('./intent-gaps');
const { hashLinkedFiles, checkStatementSatisfied } = require('./satisfaction');

class McpToolError extends Error {
  constructor(message, code = 'invalid_request') {
    super(message);
    this.name = 'McpToolError';
    this.code = code;
  }
}

async function assertProject(projectId) {
  if (typeof projectId !== 'string' || !projectId) {
    throw new McpToolError('`project_id` is required');
  }
  const project = await deployments.findById(projectId);
  if (!project) throw new McpToolError(`Project ${projectId} not found`, 'not_found');
  return project;
}

/**
 * get_intent(project_id, feature_area?) — the confirmed intent statements an
 * agent should treat as the source of truth, optionally scoped to one area.
 */
async function getIntent(projectId, featureArea = null) {
  await assertProject(projectId);
  const confirmed = await intentStatements.findConfirmedByProjectId(projectId);
  const filtered = featureArea
    ? confirmed.filter((s) => (s.feature_area ?? null) === featureArea)
    : confirmed;
  return { statements: filtered.map(toStatement) };
}

/**
 * check_intent(project_id, file_path) — boundary alert. Before editing a file,
 * an agent learns which confirmed statements depend on it.
 */
async function checkIntent(projectId, filePath) {
  await assertProject(projectId);
  if (typeof filePath !== 'string' || !filePath) {
    throw new McpToolError('`file_path` is required');
  }
  const confirmed = await intentStatements.findConfirmedByProjectId(projectId);
  const touching = confirmed.filter((s) => {
    const links = Array.isArray(s.links) ? s.links : [];
    return links.some((l) => l && l.file_path === filePath);
  });
  return { filePath, statements: touching.map(toStatement) };
}

/**
 * claim_intent(project_id, { claimant_type, claimant_id, statement_id? | feature_area? })
 * Stakes an active claim. If the target is already actively claimed by SOMEONE
 * ELSE, returns that existing claim with `conflict: true` (never throws on
 * contention). If the same claimant already holds it, returns it idempotently.
 */
async function claimIntent(projectId, { claimantType, claimantId, statementId = null, featureArea = null } = {}) {
  await assertProject(projectId);
  if (claimantType !== 'human' && claimantType !== 'agent') {
    throw new McpToolError('`claimant_type` must be "human" or "agent"');
  }
  if (typeof claimantId !== 'string' || !claimantId) {
    throw new McpToolError('`claimant_id` is required');
  }
  if (!statementId && !featureArea) {
    throw new McpToolError('Provide either `statement_id` or `feature_area` to claim');
  }
  if (statementId && featureArea) {
    throw new McpToolError('Claim a `statement_id` OR a `feature_area`, not both');
  }

  if (statementId) {
    const stmt = await intentStatements.findById(statementId, projectId);
    if (!stmt) throw new McpToolError(`Statement ${statementId} not found`, 'not_found');
  }

  const existing = statementId
    ? await claims.findActiveByStatement(projectId, statementId)
    : await claims.findActiveByArea(projectId, featureArea);

  if (existing) {
    const mine = existing.claimant_id === claimantId;
    return { claim: existing, conflict: !mine, alreadyHeld: mine };
  }

  const claim = await claims.create({ projectId, statementId, featureArea, claimantType, claimantId });
  return { claim, conflict: false, alreadyHeld: false };
}

/**
 * get_my_gaps(project_id, claimant_id) — the open intent gaps that fall under
 * intents/areas this claimant currently holds an active claim on.
 */
async function getMyGaps(projectId, claimantId) {
  await assertProject(projectId);
  if (typeof claimantId !== 'string' || !claimantId) {
    throw new McpToolError('`claimant_id` is required');
  }

  const myClaims = await claims.findActiveByClaimant(projectId, claimantId);
  if (myClaims.length === 0) return { gaps: [], claims: 0 };

  const claimedStatementIds = new Set();
  const claimedAreas = new Set();
  for (const c of myClaims) {
    if (c.statement_id) claimedStatementIds.add(c.statement_id);
    else if (c.feature_area) claimedAreas.add(c.feature_area);
  }

  const confirmed = await intentStatements.findConfirmedByProjectId(projectId);
  const allGaps = synthesizeIntentGaps(confirmed);
  const mine = allGaps.filter(
    (g) => claimedStatementIds.has(g.statementId) || (g.featureArea && claimedAreas.has(g.featureArea)),
  );
  return { gaps: mine, claims: myClaims.length };
}

/**
 * resolve_gap(project_id, statement_id) — the one LLM tool. Re-checks a single
 * confirmed statement against its current linked code and records the verdict.
 * Injectable `llmCheck` for tests.
 */
async function resolveGap(projectId, statementId, { contents, llmCheck } = {}) {
  await assertProject(projectId);
  if (typeof statementId !== 'string' || !statementId) {
    throw new McpToolError('`statement_id` is required');
  }
  const stmt = await intentStatements.findById(statementId, projectId);
  if (!stmt) throw new McpToolError(`Statement ${statementId} not found`, 'not_found');
  if (stmt.status !== 'confirmed') {
    return { statementId, satisfied: stmt.satisfied ?? null, skipped: 'not_confirmed' };
  }

  const map = contents || (await analysisFiles.getContentsMap(projectId));
  const links = Array.isArray(stmt.links) ? stmt.links : [];
  const freshHash = hashLinkedFiles(map, links);
  if (freshHash === null) {
    return { statementId, satisfied: stmt.satisfied ?? null, reason: 'no linked content to check' };
  }

  const check = llmCheck || checkStatementSatisfied;
  const verdict = await check(projectId, stmt, map);
  await intentStatements.setSatisfaction(statementId, projectId, {
    codeHash: freshHash,
    satisfied: verdict.satisfied,
    lastCheckedAt: new Date().toISOString(),
  });
  return { statementId, satisfied: verdict.satisfied, reason: verdict.reason || '' };
}

module.exports = {
  McpToolError,
  getIntent,
  checkIntent,
  claimIntent,
  getMyGaps,
  resolveGap,
};
