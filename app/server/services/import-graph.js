/**
 * Import-graph computation for analysis files.
 *
 * Pure module: no DB, no I/O — operates on an in-memory { path: content }
 * map. Used by the analyzer to derive structural-centrality multipliers
 * that influence file ranking (so an orchestrator buried at
 * server/lib/pipeline.ts can outrank a leaf util named index.ts).
 *
 * Resolution is best-effort and line-based. We don't need a real AST
 * because all we want is an edge count, not the import shape.
 */

const path = require('path');

const JS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const PY_EXT = '.py';
const ALL_EXTS = [...JS_EXTS, PY_EXT];

const JS_INDEX_FILES = ['/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
const PY_INDEX_FILE = '/__init__.py';
const ALL_INDEX_FILES = [...JS_INDEX_FILES, PY_INDEX_FILE];

const PY_EXT_RE = /\.py$/i;

// JS/TS import-style extractors. Each captures the literal between quotes.
// `[^'"]` matches across newlines so multi-line destructured imports still work.
const RE_JS_IMPORT  = /(?:^|\n)\s*import\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/g;
const RE_JS_DYNAMIC = /(?:^|\n)\s*(?:import|export)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const RE_JS_REQUIRE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
// Re-exports — barrel-style `export * from './foo'` and `export { Bar } from './bar'`.
// Without these, every barrel file's downstream targets undercount their inbound edges.
const RE_JS_REEXPORT = /(?:^|\n)\s*export\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g;

// Python — we extend the documented `from … import …` regex to also capture
// the imported names, because `from . import foo` cannot be resolved without
// knowing `foo`.
const RE_PY_IMPORT = /(?:^|\n)\s*import\s+([\w.]+)/g;
const RE_PY_FROM   = /(?:^|\n)\s*from\s+(\.+[\w.]*|[\w.]+)\s+import\s+([^\n;#]+)/g;

function isPy(p) {
  return PY_EXT_RE.test(p);
}

function tryPaths(candidates, fileSet) {
  for (const c of candidates) if (fileSet.has(c)) return c;
  return null;
}

function resolveByExt(base, fileSet) {
  if (fileSet.has(base)) return base;
  for (const e of ALL_EXTS) if (fileSet.has(base + e)) return base + e;
  for (const e of ALL_INDEX_FILES) if (fileSet.has(base + e)) return base + e;
  return null;
}

function resolveJsSpec(importerPath, spec, fileSet) {
  if (!spec) return null;
  if (spec.startsWith('./') || spec.startsWith('../')) {
    const dir = path.posix.dirname(importerPath);
    const base = path.posix.normalize(path.posix.join(dir, spec));
    return resolveByExt(base, fileSet);
  }
  // Next.js / Vite alias conventions. We try `src/` first because it's by far
  // the most common; if a project uses a different baseUrl we'll leave the
  // import in `unresolved` rather than risk false matches.
  if (spec.startsWith('@/')) {
    return resolveByExt(path.posix.join('src', spec.slice(2)), fileSet);
  }
  if (spec.startsWith('~/')) {
    return resolveByExt(path.posix.join('src', spec.slice(2)), fileSet);
  }
  return null; // bare specifier — treat as external
}

function resolvePyRelativeModule(importerPath, dots, suffix, fileSet) {
  // PEP 328: a single leading dot means the current package, two dots one
  // level up, etc. `from .foo import x` starts at the importer's directory
  // (0 levels up) and resolves `foo`.
  const upLevels = dots.length - 1;
  let dir = path.posix.dirname(importerPath);
  for (let i = 0; i < upLevels; i++) dir = path.posix.dirname(dir);
  if (dir === '.') dir = '';
  if (suffix) {
    const subPath = suffix.replace(/\./g, '/');
    const base = dir ? path.posix.join(dir, subPath) : subPath;
    return tryPaths([base + PY_EXT, base + PY_INDEX_FILE], fileSet);
  }
  return tryPaths([dir ? dir + PY_INDEX_FILE : '__init__.py'], fileSet);
}

function resolvePyAbsoluteModule(modulePath, fileSet) {
  const subPath = modulePath.replace(/\./g, '/');
  return tryPaths([subPath + PY_EXT, subPath + PY_INDEX_FILE], fileSet);
}

function extractJsSpecs(content) {
  const specs = [];
  const seen = new Set();
  for (const re of [RE_JS_IMPORT, RE_JS_DYNAMIC, RE_JS_REQUIRE, RE_JS_REEXPORT]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      const s = m[1];
      if (!seen.has(s)) {
        seen.add(s);
        specs.push(s);
      }
    }
  }
  return specs;
}

function extractPySpecs(content) {
  const out = [];

  RE_PY_IMPORT.lastIndex = 0;
  let m;
  while ((m = RE_PY_IMPORT.exec(content)) !== null) {
    out.push({ kind: 'import', module: m[1] });
  }

  RE_PY_FROM.lastIndex = 0;
  while ((m = RE_PY_FROM.exec(content)) !== null) {
    const importedRaw = (m[2] || '').trim().replace(/[()]/g, '');
    const names = importedRaw
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/i)[0].trim())
      .filter(Boolean);
    out.push({ kind: 'from', module: m[1], imported: names });
  }
  return out;
}

function resolvePyFromSpec(importerPath, spec, fileSet) {
  const { module: mod, imported } = spec;
  const dotMatch = mod.match(/^(\.+)(.*)$/);
  if (dotMatch) {
    const dots = dotMatch[1];
    const suffix = dotMatch[2] || '';
    if (suffix) {
      const r = resolvePyRelativeModule(importerPath, dots, suffix, fileSet);
      return r ? [r] : [];
    }
    // `from . import a, b` — each name in the import list is a sibling target.
    const results = [];
    for (const name of imported || []) {
      const r = resolvePyRelativeModule(importerPath, dots, name, fileSet);
      if (r) results.push(r);
    }
    return results;
  }
  return [resolvePyAbsoluteModule(mod, fileSet)].filter(Boolean);
}

function computeImportGraph(fileContents) {
  const nodes = new Map();
  if (!fileContents || typeof fileContents !== 'object') return nodes;

  const fileSet = new Set();
  for (const p of Object.keys(fileContents)) {
    if (typeof p === 'string') fileSet.add(p);
  }

  for (const p of fileSet) {
    nodes.set(p, {
      outbound: [],
      inboundDegree: 0,
      outboundDegree: 0,
      unresolved: [],
      centrality: 1,
    });
  }

  for (const [filePath, content] of Object.entries(fileContents)) {
    if (typeof filePath !== 'string' || typeof content !== 'string') continue;
    const node = nodes.get(filePath);
    if (!node) continue;

    const seenResolved = new Set();
    const seenUnresolved = new Set();

    const addResolved = (r) => {
      if (!r || r === filePath) return;
      if (seenResolved.has(r)) return;
      seenResolved.add(r);
      node.outbound.push(r);
    };
    const addUnresolved = (s) => {
      if (!s) return;
      if (seenUnresolved.has(s)) return;
      seenUnresolved.add(s);
      node.unresolved.push(s);
    };

    if (isPy(filePath)) {
      for (const sp of extractPySpecs(content)) {
        const resolved = sp.kind === 'import'
          ? [resolvePyAbsoluteModule(sp.module, fileSet)].filter(Boolean)
          : resolvePyFromSpec(filePath, sp, fileSet);
        if (resolved.length === 0) {
          addUnresolved(sp.module);
        } else {
          for (const r of resolved) addResolved(r);
        }
      }
    } else {
      for (const spec of extractJsSpecs(content)) {
        const r = resolveJsSpec(filePath, spec, fileSet);
        if (r) addResolved(r);
        else addUnresolved(spec);
      }
    }
  }

  for (const [, node] of nodes) {
    for (const t of node.outbound) {
      const tn = nodes.get(t);
      if (tn) tn.inboundDegree += 1;
    }
  }

  // outboundDegree intentionally counts unresolved (package/external) imports
  // too — a file that pulls in many third-party libs is still a "wide" node
  // structurally, even though those edges don't land anywhere in our map.
  for (const [, node] of nodes) {
    node.outboundDegree = node.outbound.length + node.unresolved.length;
    node.centrality = centralityMultiplier(node);
  }

  return nodes;
}

function centralityMultiplier(metrics) {
  if (!metrics) return 1.0;
  const inbound = metrics.inboundDegree || 0;
  const outbound = metrics.outboundDegree || 0;
  // Files no one imports get no boost regardless of how much they pull in —
  // they're leaves by definition and shouldn't outrank a true hub.
  if (inbound <= 0) return 1.0;
  const raw = 1 + 0.5 * Math.log2(1 + inbound) + 0.25 * Math.log2(1 + outbound);
  if (raw < 1) return 1.0;
  if (raw > 3) return 3.0;
  return raw;
}

module.exports = { computeImportGraph, centralityMultiplier };
