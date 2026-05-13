/**
 * Tiny structured-timing helper.
 *
 * Most timing in this codebase is ad-hoc `Date.now()` math. This module
 * exists so every stage emits the SAME JSON shape — making it
 * grep-able in production logs and machine-parseable for "show me the
 * 90th percentile of stage X" without a real APM stack.
 *
 * Output shape (single line per call to `t.end()`):
 *   { event: "stage_timing", stage: <label>, projectId: <id|null>,
 *     ms: <duration>, ...extra }
 *
 * Usage:
 *   const t = startTimer('stage4_ai_suggestions', projectId);
 *   try {
 *     ...work...
 *   } finally {
 *     t.end({ count: results.length });
 *   }
 *
 * The `extra` object on `end()` is merged into the log entry so
 * call sites can attach counts, error flags, etc. without a second
 * console.log call. Keep keys short — these go to prod logs every run.
 *
 * Implementation note: we use `Date.now()` rather than
 * `process.hrtime.bigint()` because we want millisecond resolution
 * and a JSON-friendly number, not nanosecond precision. If we ever
 * need sub-ms timing, swap the impl here without changing call sites.
 */

function startTimer(stage, projectId = null) {
  const start = Date.now();
  let ended = false;
  return {
    end(extra) {
      // Idempotent: a finally block + a catch block both calling end()
      // shouldn't double-log. First end wins.
      if (ended) return 0;
      ended = true;
      const ms = Date.now() - start;
      const payload = {
        event: 'stage_timing',
        stage,
        projectId,
        ms,
        ...(extra && typeof extra === 'object' ? extra : {}),
      };
      console.log(JSON.stringify(payload));
      return ms;
    },
    // For call sites that want to know elapsed time without ending
    // the timer (e.g. "log progress at 30s but keep timing").
    elapsed() {
      return Date.now() - start;
    },
  };
}

/**
 * Convenience wrapper. Use when the stage is a single async function
 * call and you want timing without the try/finally boilerplate. The
 * timer ends with `{ ok: false, error: <msg> }` if `fn` rejects, then
 * re-throws so error semantics aren't swallowed.
 */
async function timeStage(stage, projectId, fn) {
  const t = startTimer(stage, projectId);
  try {
    const result = await fn();
    t.end({ ok: true });
    return result;
  } catch (err) {
    t.end({ ok: false, error: err && err.message ? err.message : String(err) });
    throw err;
  }
}

module.exports = { startTimer, timeStage };
