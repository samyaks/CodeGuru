/**
 * The Read — the correction cascade.
 *
 * The core moment of the read: a person corrects a claim, the correction
 * settles as ground truth, and the "next thing to build" is re-derived from
 * the settled view. The settle is durable no matter what happens to the
 * re-derivation — a failed LLM call never undoes a human decision.
 *
 * No Express here: errors are plain Errors carrying `.code` ('BAD_REQUEST'
 * or 'NOT_FOUND') that the route translates into the right AppError. Deps
 * are injectable so the cascade is unit-testable without a DB.
 */

const { readClaims } = require('../../lib/db');
// rederiveNext stays in run-read.js (it owns input loading + persistence);
// safe to require at module load — run-read only lazily requires the LLM
// synthesis modules inside its functions.
const { rederiveNext } = require('./run-read');

const defaultDeps = { readClaims, rederiveNext };

function codedError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Resolve what the settled text should be from a PATCH body. Pure.
 *
 * Accepts `{ optionId }` (picked from the claim's stored alternative
 * options) or `{ text }` (free-form correction, trimmed). When both are
 * present, optionId wins — it's the more deliberate gesture.
 *
 * @param {object} claim - the claim row (for `alternative.options`)
 * @param {object} body - { text?, optionId? }
 * @returns {{ text: string }}
 * @throws {Error} with `.code = 'BAD_REQUEST'` and a human message
 */
function resolveCorrectionText(claim, body) {
  const { text, optionId } = body || {};

  if (optionId !== undefined) {
    if (typeof optionId !== 'string' || optionId.length === 0) {
      throw codedError('BAD_REQUEST', '`optionId` must be a non-empty string');
    }
    const options = claim && claim.alternative ? claim.alternative.options : null;
    const option = Array.isArray(options) ? options.find((o) => o && o.id === optionId) : null;
    if (!option || typeof option.claimText !== 'string') {
      throw codedError('BAD_REQUEST', '`optionId` does not match any option on this claim');
    }
    return { text: option.claimText };
  }

  if (typeof text !== 'string' || text.trim().length === 0) {
    throw codedError('BAD_REQUEST', 'Provide `text` (non-empty string) or `optionId`');
  }
  return { text: text.trim() };
}

/**
 * The cascade: settle the claim with the resolved correction, then
 * re-derive the next-thing from the settled view. A re-derivation failure
 * never undoes the settle — it only flags the response.
 *
 * @param {string} projectId - deployments.id (already authorized by caller)
 * @param {string} claimId - read_claims.id
 * @param {object} body - { text?, optionId? } straight from the PATCH
 * @param {object} [deps] - { readClaims, rederiveNext } injectable for tests
 * @returns {Promise<{ claim: object, nextStale: boolean }>} the settled row,
 *          and whether the stored next-thing is now stale
 * @throws {Error} with `.code = 'NOT_FOUND'` (claim missing) or
 *         `.code = 'BAD_REQUEST'` (unusable body)
 */
async function applyCorrection(projectId, claimId, body, deps = defaultDeps) {
  const claim = await deps.readClaims.findById(claimId, projectId);
  if (!claim) throw codedError('NOT_FOUND', 'Claim not found');

  const { text } = resolveCorrectionText(claim, body);

  const settled = await deps.readClaims.settle(claimId, projectId, { text });
  if (!settled) throw codedError('NOT_FOUND', 'Claim not found');

  // A correction changes what the app "is", so the next-thing is re-derived.
  // Non-fatal: the settle is already durable.
  let nextStale = false;
  try {
    await deps.rederiveNext(projectId);
  } catch (err) {
    console.error(`[read] next-thing re-derivation after settle for ${projectId} failed (non-fatal): ${err.message}`);
    nextStale = true;
  }

  return { claim: settled, nextStale };
}

module.exports = { resolveCorrectionText, applyCorrection };
