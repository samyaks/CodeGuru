'use strict';

// Path globs from takeoff.yaml `areas[].paths`, matched against repo-relative
// paths. Supports `**` (any number of directories), `*` and `?` (within one
// segment), `{a,b}` alternatives and `[...]` classes. A pattern with no glob
// characters also matches everything under it when it names a directory
// ("app/billing" covers "app/billing/x.js"). A leading "./" or "/" is ignored.

const cache = new Map();

function escapeRe(ch) {
  return /[\\^$.*+?()[\]{}|/]/.test(ch) ? `\\${ch}` : ch;
}

function globToRegExp(glob) {
  const key = String(glob);
  if (cache.has(key)) return cache.get(key);
  let g = key.trim().replace(/^\.\//, '').replace(/^\/+/, '');
  if (g.endsWith('/')) g += '**';
  const literal = !/[*?[{]/.test(g);
  let re = '';
  let inBraces = 0;
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        const atStart = i === 0 || g[i - 1] === '/';
        const atEnd = i + 2 === g.length || g[i + 2] === '/';
        if (atStart && atEnd) {
          // "**/" → zero or more directories; trailing "**" → anything.
          if (i + 2 === g.length) re += '.*';
          else { re += '(?:.*/)?'; i += 1; }
          i += 1;
          continue;
        }
        re += '[^/]*';
        i += 1;
        continue;
      }
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '[') {
      const close = g.indexOf(']', i + 1);
      if (close === -1) { re += '\\['; continue; }
      let body = g.slice(i + 1, close);
      if (body.startsWith('!')) body = `^${body.slice(1)}`;
      re += `[${body.replace(/\\/g, '\\\\')}]`;
      i = close;
    } else if (c === '{') {
      inBraces += 1;
      re += '(?:';
    } else if (c === '}' && inBraces) {
      inBraces -= 1;
      re += ')';
    } else if (c === ',' && inBraces) {
      re += '|';
    } else {
      re += escapeRe(c);
    }
  }
  while (inBraces > 0) { re += ')'; inBraces -= 1; }
  let out;
  try {
    out = new RegExp(literal ? `^${re}(?:/.*)?$` : `^${re}$`);
  } catch {
    out = /(?!)/; // a broken pattern matches nothing
  }
  cache.set(key, out);
  return out;
}

function matchesAny(filePath, globs) {
  const p = String(filePath || '').replace(/^\.\//, '');
  return (Array.isArray(globs) ? globs : []).some((g) => typeof g === 'string' && globToRegExp(g).test(p));
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

module.exports = { globToRegExp, matchesAny, touchedAreas };
