'use strict';

/**
 * What the code index learns from one file's text. Pure: no I/O.
 *
 * extractSymbols(path, text)  -> [{ symbol, kind, line }]   (line is 1-based)
 * extractSpecs(path, text)    -> { lang: 'js'|'py', specs } or null
 * resolveEdges(specsByPath, paths) -> [[from, to], ...]
 *
 * Symbols come from line-based patterns, not a parser: good enough to answer
 * "where is X defined" and to point the model at the right file.
 */

const {
  isPy, extractJsSpecs, extractPySpecs, resolveJsSpec, resolvePyFromSpec, resolvePyAbsoluteModule,
} = require('../import-graph');

const MAX_SYMBOLS_PER_FILE = 500;
const MAX_SYMBOL_LEN = 200;
const MAX_SPECS_PER_FILE = 300;
const MAX_LINE_SCAN = 4000; // characters of one line we look at

const JS_RE = /\.(m|c)?[jt]sx?$|\.(vue|svelte|astro)$/i;

// [regex, kind]. Each regex runs against one line and captures the name in group 1.
const JS_RULES = [
  [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, 'function'],
  [/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, 'class'],
  [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/, 'function'],
  [/^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, 'interface'],
  [/^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*=/, 'type'],
  [/^\s*(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, 'enum'],
  [/^\s*(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/, 'export'],
];
// Express-style routes: app.get('/x', ...), router.post("/y", ...)
const ROUTE_RE = /\b(?:app|router|api|server|r)\.(get|post|put|patch|delete|all|use)\s*\(\s*(['"`])(\/[^'"`]*)\2/;

const PY_RULES = [
  [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, 'function'],
  [/^\s*class\s+([A-Za-z_]\w*)/, 'class'],
];
const GO_RULES = [
  [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, 'function'],
  [/^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/, 'type'],
];
const RUBY_RULES = [
  [/^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/, 'function'],
  [/^\s*(?:class|module)\s+([A-Z]\w*(?:::[A-Z]\w*)*)/, 'class'],
];
const JVM_RULES = [
  [/^\s*(?:(?:public|private|protected|internal|abstract|final|sealed|open|data|static)\s+)*(?:class|interface|object|enum|record)\s+([A-Za-z_]\w*)/, 'class'],
  [/^\s*(?:(?:public|private|protected|internal|override|suspend|static|final|abstract)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?([A-Za-z_]\w*)\s*\(/, 'function'],
];
const RUST_RULES = [
  [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/, 'function'],
  [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/, 'type'],
];

function rulesFor(p) {
  const lower = p.toLowerCase();
  if (JS_RE.test(lower)) return 'js';
  if (lower.endsWith('.py')) return 'py';
  if (lower.endsWith('.go')) return 'go';
  if (lower.endsWith('.rb')) return 'rb';
  if (/\.(java|kt|kts|scala)$/.test(lower)) return 'jvm';
  if (lower.endsWith('.rs')) return 'rs';
  return null;
}

const RULESETS = { js: JS_RULES, py: PY_RULES, go: GO_RULES, rb: RUBY_RULES, jvm: JVM_RULES, rs: RUST_RULES };

function extractSymbols(p, text) {
  if (typeof text !== 'string' || !text) return [];
  const kindSet = rulesFor(p);
  if (!kindSet) return [];
  const rules = RULESETS[kindSet];
  const out = [];
  const seen = new Set();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length && out.length < MAX_SYMBOLS_PER_FILE; i += 1) {
    const line = lines[i].length > MAX_LINE_SCAN ? lines[i].slice(0, MAX_LINE_SCAN) : lines[i];
    for (const [re, kind] of rules) {
      const m = re.exec(line);
      if (m && m[1]) {
        const symbol = m[1].slice(0, MAX_SYMBOL_LEN);
        const key = `${kind}:${symbol}:${i}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ symbol, kind, line: i + 1 });
        }
        break;
      }
    }
    if (kindSet === 'js' && out.length < MAX_SYMBOLS_PER_FILE) {
      const r = ROUTE_RE.exec(line);
      if (r) out.push({ symbol: `${r[1].toUpperCase()} ${r[3]}`.slice(0, MAX_SYMBOL_LEN), kind: 'route', line: i + 1 });
    }
  }
  return out;
}

function extractSpecs(p, text) {
  if (typeof text !== 'string' || !text) return null;
  if (isPy(p)) {
    const specs = extractPySpecs(text).slice(0, MAX_SPECS_PER_FILE);
    return specs.length ? { lang: 'py', specs } : null;
  }
  if (JS_RE.test(p)) {
    const specs = extractJsSpecs(text)
      .filter((s) => s.startsWith('.') || s.startsWith('@/') || s.startsWith('~/'))
      .slice(0, MAX_SPECS_PER_FILE);
    return specs.length ? { lang: 'js', specs } : null;
  }
  return null;
}

/**
 * @param {Map<string, {lang, specs}>|Array<[string,{lang,specs}]>} specsByPath
 * @param {Set<string>} paths every indexed path
 */
function resolveEdges(specsByPath, paths) {
  const edges = [];
  const entries = specsByPath instanceof Map ? specsByPath.entries() : specsByPath;
  for (const [from, entry] of entries) {
    if (!entry || !Array.isArray(entry.specs)) continue;
    const seen = new Set();
    const add = (to) => {
      if (!to || to === from || seen.has(to)) return;
      seen.add(to);
      edges.push([from, to]);
    };
    if (entry.lang === 'py') {
      for (const sp of entry.specs) {
        if (!sp || typeof sp.module !== 'string') continue;
        if (sp.kind === 'import') add(resolvePyAbsoluteModule(sp.module, paths));
        else for (const r of resolvePyFromSpec(from, { module: sp.module, imported: Array.isArray(sp.imported) ? sp.imported : [] }, paths)) add(r);
      }
    } else if (entry.lang === 'js') {
      for (const spec of entry.specs) if (typeof spec === 'string') add(resolveJsSpec(from, spec, paths));
    }
  }
  return edges;
}

module.exports = { extractSymbols, extractSpecs, resolveEdges, MAX_SYMBOLS_PER_FILE };
