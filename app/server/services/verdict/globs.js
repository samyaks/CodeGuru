'use strict';

// Path globs from takeoff.yaml `areas[].paths`, matched against repo-relative
// paths. Supports `**` (any number of directories), `*` and `?` (within one
// segment), `{a,b}` alternatives and `[...]` / `[!...]` classes. A pattern with
// no glob characters also matches everything under it when it names a
// directory ("app/billing" covers "app/billing/x.js"). A leading "./" or "/"
// is ignored.
//
// Patterns can come from the PR's own takeoff.yaml, so matching is done
// segment by segment with dynamic programming (no regular expressions, no
// backtracking): time is bounded by pattern length × path length.

const MAX_PATTERN_LENGTH = 300;
const MAX_BRACE_EXPANSIONS = 32;
const CACHE_LIMIT = 500;
const cache = new Map();

/** "src/{a,b}/x" → ["src/a/x", "src/b/x"]; one level of nesting at a time, capped. */
function expandBraces(glob) {
  const out = [];
  const queue = [glob];
  while (queue.length) {
    const g = queue.shift();
    const open = g.indexOf('{');
    const close = open === -1 ? -1 : g.indexOf('}', open);
    if (open === -1 || close === -1) {
      out.push(g);
    } else {
      // innermost-last: take the last "{" before the first "}" so nesting expands inside out
      const start = g.lastIndexOf('{', close);
      for (const alt of g.slice(start + 1, close).split(',')) {
        queue.push(g.slice(0, start) + alt + g.slice(close + 1));
        if (out.length + queue.length > MAX_BRACE_EXPANSIONS) return null;
      }
    }
  }
  return out;
}

/** Tokens for one path segment: { lit } | { any } (*) | { one } (?) | { set, neg }. */
function compileSegment(seg) {
  const tokens = [];
  for (let i = 0; i < seg.length; i += 1) {
    const c = seg[i];
    if (c === '*') {
      if (tokens.length && tokens[tokens.length - 1].any) continue; // "**" inside a segment is "*"
      tokens.push({ any: true });
    } else if (c === '?') {
      tokens.push({ one: true });
    } else if (c === '[') {
      const close = seg.indexOf(']', i + 2);
      if (close === -1) { tokens.push({ lit: c }); continue; }
      let body = seg.slice(i + 1, close);
      const neg = body.startsWith('!') || body.startsWith('^');
      if (neg) body = body.slice(1);
      const ranges = [];
      for (let j = 0; j < body.length; j += 1) {
        if (body[j + 1] === '-' && j + 2 < body.length) { ranges.push([body[j], body[j + 2]]); j += 2; }
        else ranges.push([body[j], body[j]]);
      }
      tokens.push({ set: ranges, neg });
      i = close;
    } else {
      tokens.push({ lit: c });
    }
  }
  return tokens;
}

function tokenMatches(t, ch) {
  if (t.one) return true;
  if (t.set) {
    const hit = t.set.some(([a, b]) => ch >= a && ch <= b);
    return t.neg ? !hit : hit;
  }
  return t.lit === ch;
}

/** Wildcard match of one segment, O(tokens × chars). */
function segmentMatches(tokens, s) {
  let prev = new Array(s.length + 1).fill(false);
  prev[0] = true;
  for (const t of tokens) {
    const next = new Array(s.length + 1).fill(false);
    if (t.any) {
      let seen = false;
      for (let j = 0; j <= s.length; j += 1) { seen = seen || prev[j]; next[j] = seen; }
    } else {
      for (let j = 1; j <= s.length; j += 1) next[j] = prev[j - 1] && tokenMatches(t, s[j - 1]);
    }
    prev = next;
  }
  return prev[s.length];
}

function compileOne(glob) {
  let g = glob.trim().replace(/^\.\//, '').replace(/^\/+/, '');
  if (g.endsWith('/')) g += '**';
  const literal = !/[*?[]/.test(g);
  const segs = [];
  for (const part of g.split('/')) {
    if (part === '') continue;
    if (part === '**') {
      if (segs.length && segs[segs.length - 1] === '**') continue; // collapse "**/**"
      segs.push('**');
    } else {
      segs.push(compileSegment(part));
    }
  }
  // "src/billing/**" needs something under src/billing; a plain "src/billing"
  // matches that file or anything under that directory.
  const plusTail = !literal && segs.length > 1 && segs[segs.length - 1] === '**';
  if (literal) segs.push('**');
  return { segs, plusTail };
}

/** Path segments × pattern segments, O(segs × path segments × segment cost). */
function pathMatches({ segs, plusTail }, parts) {
  let prev = new Array(parts.length + 1).fill(false);
  prev[0] = true;
  for (let si = 0; si < segs.length; si += 1) {
    const seg = segs[si];
    const next = new Array(parts.length + 1).fill(false);
    if (seg === '**') {
      const atLeastOne = plusTail && si === segs.length - 1;
      let seen = false;
      for (let j = 0; j <= parts.length; j += 1) {
        if (atLeastOne) { next[j] = seen; seen = seen || prev[j]; } else { seen = seen || prev[j]; next[j] = seen; }
      }
    } else {
      for (let j = 1; j <= parts.length; j += 1) next[j] = prev[j - 1] && segmentMatches(seg, parts[j - 1]);
    }
    prev = next;
  }
  return prev[parts.length];
}

function compile(glob) {
  const key = String(glob);
  if (cache.has(key)) return cache.get(key);
  let compiled = [];
  if (key.length <= MAX_PATTERN_LENGTH) {
    const alts = expandBraces(key);
    compiled = alts ? alts.map(compileOne) : [];
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, compiled);
  return compiled;
}

function globMatches(glob, filePath) {
  const parts = String(filePath || '').replace(/^\.\//, '').split('/').filter(Boolean);
  return compile(glob).some((c) => pathMatches(c, parts));
}

function matchesAny(filePath, globs) {
  return (Array.isArray(globs) ? globs : []).some((g) => typeof g === 'string' && globMatches(g, filePath));
}

/**
 * Which areas a set of changed paths touches.
 * @returns {{ touched: Array<{ area: object, files: string[] }>, unmapped: string[] }}
 */
function touchedAreas(intent, paths) {
  const areas = Array.isArray(intent?.areas) ? intent.areas : [];
  const byArea = new Map();
  const unmapped = [];
  for (const p of paths) {
    let hit = false;
    for (const area of areas) {
      if (area && matchesAny(p, area.paths)) {
        hit = true;
        if (!byArea.has(area)) byArea.set(area, []);
        byArea.get(area).push(p);
      }
    }
    if (!hit) unmapped.push(p);
  }
  const touched = areas.filter((a) => byArea.has(a)).map((area) => ({ area, files: byArea.get(area) }));
  return { touched, unmapped };
}

/** Area path patterns this matcher can't compile (too long, too many brace alternatives), which match nothing. */
function uncheckablePatterns(intent) {
  const out = [];
  for (const area of Array.isArray(intent?.areas) ? intent.areas : []) {
    for (const g of Array.isArray(area?.paths) ? area.paths : []) {
      if (typeof g === 'string' && compile(g).length === 0) out.push({ area: area.id, pattern: g });
    }
  }
  return out;
}

module.exports = { globMatches, matchesAny, touchedAreas, uncheckablePatterns, MAX_PATTERN_LENGTH };
