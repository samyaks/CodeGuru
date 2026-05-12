/**
 * eval-with-input — flag `eval()` and `new Function()` calls whose
 * argument is plausibly user-controlled.
 *
 * The spec calls for AST-based taint tracking (`req.body` flows into
 * `eval()` through any number of intermediate variables). We
 * approximate with a regex two-step:
 *
 *   1. Find a line that calls eval() or new Function().
 *   2. Look at the SAME line and the WINDOW preceding lines for any
 *      reference to `req.body`, `req.query`, `req.params`, `req.headers`,
 *      `request.body`, or a variable that was assigned from one of
 *      those in the window. We don't track variables across function
 *      boundaries — accept the resulting false negatives.
 *
 * Standalone `eval(literal)` (eval of a constant string) is also
 * surfaced at LOW severity with a different message — code-eval is a
 * footgun even when no user input is involved (linting, anti-debug
 * tricks, etc.).
 *
 * Severity:
 *   - critical when input plausibly reaches the eval site.
 *   - low when eval is present but no input is nearby.
 *
 * CWE-95: Improper Neutralization of Directives in Dynamically
 * Evaluated Code ('Eval Injection').
 */

const NAME = 'eval-with-input';

// `eval(...)` — deliberately not just `eval` so we don't fire on
// `eval` mentioned in a string. Matches `eval(`, `eval (`, `globalThis.eval(`.
const EVAL_CALL  = /\b(?:globalThis\.|window\.|self\.)?eval\s*\(/;
// `new Function(...)` — multi-arg form is the dangerous one.
const NEW_FUNCTION_CALL = /\bnew\s+Function\s*\(/;
// Standalone JS rule. A few legit usages exist (Webpack runtime, etc.)
// so we keep severity low for the no-input case.
const INPUT_PATTERN = /\breq(?:uest)?\.(?:body|query|params|headers)\b/;

const WINDOW = 6; // lines back to look for input flow
const VAR_ASSIGN_FROM_INPUT = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]*req(?:uest)?\.(?:body|query|params|headers)/;

function isLikelyServerCode(path) {
  if (!/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(path)) return false;
  if (/(?:^|\/)__tests__\//.test(path) || /\.(test|spec)\.[a-z]+$/i.test(path)) return false;
  return true;
}

function tracedFromInput(lines, evalLine) {
  const start = Math.max(0, evalLine - WINDOW);
  const window = lines.slice(start, evalLine + 1);
  const windowText = window.join('\n');

  // Direct mention on or near the eval line.
  if (INPUT_PATTERN.test(windowText)) return true;

  // Indirect: a variable in the eval-line was assigned from input
  // somewhere in the window.
  const evalLineText = lines[evalLine] || '';
  for (const winLine of window) {
    const m = winLine.match(VAR_ASSIGN_FROM_INPUT);
    if (m && m[1] && new RegExp(`\\b${m[1]}\\b`).test(evalLineText)) return true;
  }
  return false;
}

async function run({ fileContents }) {
  if (!fileContents || typeof fileContents !== 'object') return [];
  const findings = [];

  for (const [path, content] of Object.entries(fileContents)) {
    if (typeof content !== 'string') continue;
    if (!isLikelyServerCode(path)) continue;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isEval = EVAL_CALL.test(line);
      const isNewFn = NEW_FUNCTION_CALL.test(line);
      if (!isEval && !isNewFn) continue;

      // `// eslint-disable-next-line no-eval` and similar
      // comment-based opt-outs are STILL flagged: a security review
      // shouldn't trust ad-hoc opt-outs.
      const tainted = tracedFromInput(lines, i);
      const callKind = isEval ? 'eval()' : 'new Function()';

      if (tainted) {
        findings.push({
          file: path,
          line: i + 1,
          severity: 'critical',
          cweId: 'CWE-95',
          title: `Possible eval injection at ${path}:${i + 1}`,
          description:
            `${callKind} is called with a value that traces back to a request input ` +
            `(req.body / req.query / req.params / req.headers) within the surrounding ${WINDOW} lines. ` +
            `An attacker who controls that input can run arbitrary JavaScript inside your server process. ` +
            `Replace ${callKind} with a structured parser (JSON.parse, a math expression library, a sandbox like vm2 — ` +
            `noting vm2 itself has had escapes — or, ideally, eliminate the dynamic-evaluation requirement entirely).`,
          evidence: [{ file: path, line: i + 1, reason: `${callKind} reachable from request input`, snippet: line.trim().slice(0, 200) }],
        });
      } else {
        findings.push({
          file: path,
          line: i + 1,
          severity: 'low',
          cweId: 'CWE-95',
          title: `${callKind} in ${path}:${i + 1}`,
          description:
            `${callKind} is in use here but no obvious user-input flow reaches it. ` +
            `That makes the immediate risk low, but ${callKind} is still a footgun: any future refactor that wires ` +
            `input through this code path becomes a critical eval-injection issue. Prefer an explicit parser or a ` +
            `safe expression library.`,
          evidence: [{ file: path, line: i + 1, reason: `${callKind} present, no input flow detected`, snippet: line.trim().slice(0, 200) }],
        });
      }
    }
  }

  return findings;
}

module.exports = {
  name: NAME,
  severity: 'critical',
  cweId: 'CWE-95',
  run,
};
