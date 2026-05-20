// Debounced auto-rescan trigger for the GitHub push webhook flow.
//
// Wired into `processPush` in services/v2/shipped-runner.js so that every
// push to a project's default branch eventually triggers a full re-analysis
// — closing the loop on the "true CI setup" that the manual Re-analyze
// button only solves halfway.
//
// Why debounce: a typical dev session pushes 3–10 commits over a few
// minutes. Each commit triggers a webhook → processPush → schedule call.
// Without debounce we'd kick off N full pipelines in a row (each ~$0.30-1
// in LLM cost). With a 2-min debounce, all rapid pushes collapse into a
// single run that uses the latest commit's tree.
//
// State is module-level (in-process). On restart the pending timers are
// lost — any push that arrived during the debounce window is silently
// dropped from auto-rescan. The shipped runner still processed the
// commits (gap matches were persisted synchronously when the webhook
// arrived), so this only affects the "should we re-scan the repo" half.
// Acceptable for v1; durable scheduling would need a queue (BullMQ /
// pg-boss) and isn't worth it until we see real loss.

const { deployments } = require('../../lib/db');
const { triggerReanalyzeForProject } = require('../../routes/takeoff');

// Tunable. 2 min was the user-confirmed choice in the design review:
// long enough to collapse rapid dev pushes, short enough that the user
// sees fresh analysis "within a few minutes of pushing" — i.e. still
// feels live, not batched.
const DEBOUNCE_MS = 2 * 60 * 1000;

// projectId → { timer, accumulated: { reasons: Set<string>, commits: string[], branch: string|null } }
//
// The accumulated context lets the eventual trigger log all commits that
// fed into the run, which is useful for "why did this rescan fire?" later.
const pending = new Map();

// projectId → { reasons, commits, branch }
//
// Set when a push arrives while a run is already in flight (either from
// our own previous schedule or from a manual Re-analyze click). The
// completion handler drains this set by re-scheduling — chained ONCE,
// not N times. The drain accumulator is reset on each chain so a long-
// running pipeline followed by a burst of pushes still only spawns one
// follow-up run.
const queuedDuringRun = new Map();

function recordPush(map, projectId, ctx) {
  const existing = map.get(projectId);
  if (existing) {
    existing.reasons.add(ctx.reason);
    if (Array.isArray(ctx.commits)) existing.commits.push(...ctx.commits);
    existing.branch = ctx.branch ?? existing.branch;
    return existing;
  }
  const fresh = {
    reasons: new Set(ctx.reason ? [ctx.reason] : []),
    commits: Array.isArray(ctx.commits) ? [...ctx.commits] : [],
    branch: ctx.branch ?? null,
  };
  map.set(projectId, fresh);
  return fresh;
}

// Schedule a re-analysis for `projectId`. Idempotent + debounced: rapid
// calls within DEBOUNCE_MS reset the timer and merge their context into
// a single pending trigger.
//
// `reason` is logged on the eventual trigger. `commits` and `branch` are
// captured for the log line so operators can grep `auto_reanalyze_fired`
// and see which commits accumulated under one run.
function scheduleReanalyze(projectId, { reason, commits, branch } = {}) {
  if (!projectId) return;

  const accumulated = recordPush(pending, projectId, { reason, commits, branch });

  if (accumulated.timer) {
    clearTimeout(accumulated.timer);
  }

  accumulated.timer = setTimeout(() => {
    // Move the accumulated context out of `pending` BEFORE awaiting, so a
    // push arriving during the trigger starts a fresh debounce window
    // rather than mutating state that's already in flight.
    const ctx = pending.get(projectId);
    pending.delete(projectId);
    if (!ctx) return;
    ctx.timer = null;

    fireReanalyze(projectId, ctx).catch((err) => {
      console.error(`[reanalyze-scheduler] fireReanalyze ${projectId} threw:`, err.message);
    });
  }, DEBOUNCE_MS);
}

async function fireReanalyze(projectId, ctx) {
  let project;
  try {
    project = await deployments.findById(projectId);
  } catch (err) {
    console.warn(`[reanalyze-scheduler] findById ${projectId} failed: ${err.message}`);
    return;
  }
  if (!project) {
    console.log(JSON.stringify({
      event: 'auto_reanalyze_skipped',
      projectId,
      reason: 'project_not_found',
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  let result;
  try {
    result = await triggerReanalyzeForProject(project, {
      reason: `auto:${[...ctx.reasons].join(',') || 'push'}`,
      requestUserId: null,
    });
  } catch (err) {
    // triggerReanalyzeForProject throws AppError.conflict when the project
    // is already in-flight (either because a manual Re-analyze fired
    // concurrently, or because our own previous run hasn't drained yet).
    // In that case we queue ourselves for the next available slot rather
    // than dropping the push.
    if (err && err.statusCode === 409) {
      recordPush(queuedDuringRun, projectId, {
        reason: `chained-after-${[...ctx.reasons].join(',') || 'push'}`,
        commits: ctx.commits,
        branch: ctx.branch,
      });
      console.log(JSON.stringify({
        event: 'auto_reanalyze_queued',
        projectId,
        reasons: [...ctx.reasons],
        commits: ctx.commits.slice(0, 5),
        commitsTotal: ctx.commits.length,
        timestamp: new Date().toISOString(),
      }));
      return;
    }
    if (err && err.statusCode === 400) {
      // local:// upload — never reachable from a real webhook (no GH repo
      // to install on) but log defensively in case a future code path
      // calls scheduleReanalyze on an upload project.
      console.log(JSON.stringify({
        event: 'auto_reanalyze_skipped',
        projectId,
        reason: 'local_upload',
        timestamp: new Date().toISOString(),
      }));
      return;
    }
    throw err;
  }

  console.log(JSON.stringify({
    event: 'auto_reanalyze_fired',
    projectId,
    reasons: [...ctx.reasons],
    branch: ctx.branch,
    commits: ctx.commits.slice(0, 5),
    commitsTotal: ctx.commits.length,
    timestamp: new Date().toISOString(),
  }));

  // Wait for the pipeline to settle, then drain any push that arrived
  // during the run. We schedule the drain (rather than fire immediately)
  // so that a long pipeline followed by another burst of pushes still
  // pays for ONE follow-up run instead of N.
  result.completion.then(() => {
    const drain = queuedDuringRun.get(projectId);
    if (!drain) return;
    queuedDuringRun.delete(projectId);
    scheduleReanalyze(projectId, {
      reason: `drain:${[...drain.reasons].join(',')}`,
      commits: drain.commits,
      branch: drain.branch,
    });
  });
}

// Test/diagnostics hook — clears all pending timers and queued state.
// Not used in production; exported so a future cleanup script or test
// suite can reset the scheduler between scenarios.
function _resetForTests() {
  for (const { timer } of pending.values()) {
    if (timer) clearTimeout(timer);
  }
  pending.clear();
  queuedDuringRun.clear();
}

module.exports = {
  scheduleReanalyze,
  DEBOUNCE_MS,
  _resetForTests,
};
