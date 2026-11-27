'use strict';

// Brace expansion for takeoff.yaml path patterns, shared by `takeoff validate`
// and the glob matcher (lib/globs.js) the PR check and the hook use, so a
// pattern the validator accepts is always one the PR check can match.

const MAX_PATH_PATTERN = 300;
const MAX_BRACE_ALTERNATIVES = 32;
const MAX_EXPANSION_STEPS = 10000;

/**
 * "src/{a,b}/x" → ["src/a/x", "src/b/x"]. Groups nest; duplicates count once;
 * a "{" with no matching "}" is a literal. Returns null when the pattern
 * expands to more than `max` distinct patterns or takes too many steps.
 */
function expandBraces(pattern, max = MAX_BRACE_ALTERNATIVES) {
  const out = new Set();
  let steps = 0;
  function walk(s) {
    steps += 1;
    if (steps > MAX_EXPANSION_STEPS) return false;
    for (let i = 0; i < s.length; i += 1) {
      if (s[i] !== '{') continue;
      let depth = 0;
      let end = -1;
      const commas = [];
      for (let j = i; j < s.length; j += 1) {
        if (s[j] === '{') depth += 1;
        else if (s[j] === '}') {
          depth -= 1;
          if (depth === 0) { end = j; break; }
        } else if (s[j] === ',' && depth === 1) commas.push(j);
      }
      if (end === -1) continue;
      const cuts = [i, ...commas, end];
      for (let k = 0; k < cuts.length - 1; k += 1) {
        if (!walk(s.slice(0, i) + s.slice(cuts[k] + 1, cuts[k + 1]) + s.slice(end + 1))) return false;
      }
      return true;
    }
    out.add(s);
    return out.size <= max;
  }
  return walk(String(pattern)) ? [...out] : null;
}

module.exports = { expandBraces, MAX_PATH_PATTERN, MAX_BRACE_ALTERNATIVES };
