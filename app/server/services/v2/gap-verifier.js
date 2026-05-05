// v2 verifier — given a gap and a commit, decide whether the commit fully or
// partially resolves the gap, or whether we can't tell.
//
// Hard contract: if anything throws or Claude is unreachable, return
// 'pending' so we never falsely mark a gap as verified.

const { createMessageTracked } = require('../../lib/anthropic-tracked');

const VERIFY_PROMPT = `You are a software-engineering judge. Decide whether a single
commit fully addresses, partially addresses, or fails to address a known gap.

You will be given:
- The gap title, description, category, and (when known) the list of files it
  was scoped to.
- The commit message and the list of files it changed.

Return STRICT JSON with this shape, no prose:
{
  "verification": "verified" | "partial",
  "detail": "<one or two sentence explanation>",
  "partialItems": ["<file>", "..."]   // empty array when verified
}

Rules:
- Use "verified" only when you are confident every aspect of the gap is
  covered by this commit.
- Use "partial" when the commit clearly addresses some but not all of the gap.
- Never invent file names. Only list partialItems that appear in either the
  affected files or the commit's changed files.`;

async function classifyWithClaude({ gap, commit }) {
  const userPayload = {
    gap: {
      title: gap.title,
      description: gap.description,
      category: gap.category,
      affectedFiles: Array.isArray(gap.affectedFiles) ? gap.affectedFiles : [],
    },
    commit: {
      message: commit.message,
      files: Array.isArray(commit.files) ? commit.files : [],
    },
  };

  const response = await createMessageTracked({
    phase: 'v2.gap.verify',
    targetPath: gap.id,
    params: {
      model: process.env.V2_VERIFIER_MODEL || 'claude-3-5-sonnet-latest',
      max_tokens: 600,
      system: VERIFY_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(userPayload) }],
    },
  });

  const text = (response?.content || [])
    .map((b) => (b?.type === 'text' ? b.text : ''))
    .join('')
    .trim();

  // Best-effort: pull JSON out even if Claude wraps it in code fences.
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('verifier: no JSON in response');
  const parsed = JSON.parse(jsonMatch[0]);
  const verification = parsed.verification === 'verified' ? 'verified' : 'partial';
  const detail = typeof parsed.detail === 'string' ? parsed.detail : '';
  const partialItems = Array.isArray(parsed.partialItems)
    ? parsed.partialItems.filter((s) => typeof s === 'string')
    : [];
  return { verification, detail, partialItems };
}

function ruleBasedBrokenCheck({ gap, commit }) {
  const gapFiles = new Set(Array.isArray(gap.affectedFiles) ? gap.affectedFiles : []);
  const commitFiles = new Set(Array.isArray(commit.files) ? commit.files : []);
  if (gapFiles.size === 0) return null;
  let touched = 0;
  const remaining = [];
  for (const f of gapFiles) {
    if (commitFiles.has(f)) touched += 1;
    else remaining.push(f);
  }
  const ratio = touched / gapFiles.size;
  if (ratio === 1) {
    return {
      verification: 'verified',
      detail: `All ${gapFiles.size} affected files were touched by this commit.`,
      partialItems: [],
    };
  }
  if (ratio === 0) return null; // give Claude a shot
  return {
    verification: 'partial',
    detail: `${touched} of ${gapFiles.size} files were touched. Remaining files still need attention.`,
    partialItems: remaining,
  };
}

/**
 * Returns { verification, detail, partialItems? } or { verification: 'pending' }
 * when verification can't run.
 */
async function verifyGap({ gap, commit, options = {} }) {
  if (!gap || !commit) {
    return { verification: 'pending', detail: 'Missing gap or commit context.' };
  }

  // Cheap rule-based pass first — most "broken" gaps with explicit files
  // can be fully or partially adjudicated without Claude.
  if (gap.category === 'broken' || gap.rawCategory === 'broken') {
    const ruleHit = ruleBasedBrokenCheck({ gap, commit });
    if (ruleHit) return ruleHit;
  }

  if (options.skipClaude) {
    return { verification: 'pending', detail: 'Verifier deferred.' };
  }

  try {
    return await classifyWithClaude({ gap, commit });
  } catch (err) {
    console.error(`[v2/verifier] Claude classification failed for gap ${gap.id}: ${err.message}`);
    return { verification: 'pending', detail: 'Verifier unavailable; will retry later.' };
  }
}

module.exports = { verifyGap, ruleBasedBrokenCheck };
