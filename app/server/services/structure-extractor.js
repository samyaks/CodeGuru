/**
 * Deterministic structure extractor.
 *
 * Pure module: no network, no LLM, no DB. Walks an in-memory
 * { path: content } map and emits "anchors" — the structural landmarks
 * (routes, models, exported functions/classes, entrypoints) that intent
 * statements attach to.
 *
 * Same input map -> same output (files are processed in sorted order and
 * every anchor is deduped), so callers can treat this as a pure function.
 *
 * Anchor shape:
 *   { file_path, symbol, kind, feature_area }
 *   kind ∈ "route" | "model" | "function" | "endpoint" | "entrypoint"
 *
 * JS/TS/Python exported symbols come from tree-sitter (same parser-picking
 * approach as lib/capture-utils.js) with a regex fallback when the native
 * bindings are unavailable; routes/models use regex heuristics that mirror
 * services/code-entities.js.
 */

const { inferLanguage } = require('../lib/capture-utils');

// ---------------------------------------------------------------------------
// Skip filtering. Reuse analyzer's shouldSkipFile so vendored code, build
// output and archived trees are excluded identically. Required lazily to
// avoid a load-order cycle (analyzer.js requires this module). A local skip
// set mirrors analyzer's SKIP_DIRS as a defensive fallback.
// ---------------------------------------------------------------------------

const LOCAL_SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.output',
  '__pycache__', '.cache', 'coverage', '.turbo', '.vercel', 'vendor',
  '.svelte-kit', 'target', 'out', '.expo', 'archive',
]);

function localShouldSkip(filePath) {
  return filePath.split('/').some((part) => LOCAL_SKIP_DIRS.has(part));
}

let _shouldSkipFile = null;
function getShouldSkipFile() {
  if (_shouldSkipFile) return _shouldSkipFile;
  try {
    const fn = require('./analyzer').shouldSkipFile;
    _shouldSkipFile = typeof fn === 'function' ? fn : localShouldSkip;
  } catch {
    _shouldSkipFile = localShouldSkip;
  }
  return _shouldSkipFile;
}

// Tests are not source anchors. shouldSkipFile doesn't drop them, so we do.
const TEST_FILE_RE = /(?:^|\/)(?:__tests__|__mocks__|tests?)\//i;
function isTestFile(filePath) {
  if (TEST_FILE_RE.test(filePath)) return true;
  if (/\.(?:test|spec)\.[jt]sx?$/i.test(filePath)) return true;
  if (/(?:^|\/)test_[^/]*\.py$/i.test(filePath) || /_test\.py$/i.test(filePath)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// feature_area derivation — the ONE place path/route -> area mapping lives.
// Keep the rule table easy to tune. Rules win over the path-segment fallback.
// ---------------------------------------------------------------------------

// Path segments that describe layout, not a feature. Skipped when falling
// back to "first meaningful segment".
const GENERIC_SEGMENTS = new Set([
  'src', 'app', 'server', 'client', 'lib', 'libs', 'packages', 'pkg',
  'api', 'apis', 'routes', 'route', 'pages', 'components', 'services',
  'controllers', 'handlers', 'modules', 'features', 'backend', 'frontend',
  'web', 'apps', 'v1', 'v2',
]);

const FEATURE_AREA_RULES = [
  { area: 'auth', test: /(?:^|\/)(?:auth|login|signin|signup|session|oauth)s?(?:\/|\.|$)/i },
  { area: 'checkout', test: /(?:^|\/)(?:checkout|orders?|cart|billing|payments?)(?:\/|\.|$)/i },
];

/**
 * Derive a feature_area from a file path and (optionally) a route path.
 * @param {string} filePath
 * @param {string|null} routePath  e.g. "/api/orders" — biases route anchors.
 */
function deriveFeatureArea(filePath, routePath) {
  const signal = `${routePath || ''} ${filePath || ''}`;
  for (const rule of FEATURE_AREA_RULES) {
    if (rule.test.test(signal)) return rule.area;
  }

  if (routePath) {
    const m = routePath.match(/^\/(?:api\/)?([a-z0-9_-]+)/i);
    if (m && !GENERIC_SEGMENTS.has(m[1].toLowerCase())) return m[1].toLowerCase();
  }

  const parts = String(filePath || '').split('/').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    let seg = parts[i];
    if (i === parts.length - 1) {
      const dot = seg.indexOf('.');
      if (dot > 0) seg = seg.slice(0, dot);
    }
    if (!GENERIC_SEGMENTS.has(seg.toLowerCase())) return seg.toLowerCase();
  }
  return 'core';
}

// ---------------------------------------------------------------------------
// Tree-sitter loader — same defensive, lazy, fall-through-to-regex pattern as
// lib/capture-utils.js. Bindings are cached by require(), so re-loading here
// is cheap.
// ---------------------------------------------------------------------------

let _warned = false;
function _safeRequire(name) {
  try {
    return require(name);
  } catch (err) {
    if (!_warned) {
      _warned = true;
      console.warn('[structure-extractor] tree-sitter not available, using regex fallback:', err && err.message ? err.message : err);
    }
    return null;
  }
}

const _Parser = _safeRequire('tree-sitter');
const _TS = _safeRequire('tree-sitter-typescript');
const _JS = _safeRequire('tree-sitter-javascript');
const _Py = _safeRequire('tree-sitter-python');

function _initParser(lang) {
  if (!_Parser || !lang) return null;
  try {
    const p = new _Parser();
    p.setLanguage(lang);
    return p;
  } catch {
    return null;
  }
}

const parsers = {
  ts: _initParser(_TS && _TS.typescript),
  tsx: _initParser(_TS && _TS.tsx),
  js: _initParser(_JS),
  py: _initParser(_Py),
};

function pickParser(language, filePath) {
  if (language === 'python') return parsers.py;
  const isTsx = !!(filePath && /\.tsx$/i.test(filePath));
  if (language === 'typescript') return isTsx ? (parsers.tsx || parsers.ts) : parsers.ts;
  if (language === 'javascript') return isTsx ? (parsers.tsx || parsers.js) : parsers.js;
  return null;
}

// ---------------------------------------------------------------------------
// Exported function / class extraction (kind "function") + HTTP handler
// endpoints (kind "endpoint").
// ---------------------------------------------------------------------------

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']);
const FN_DECLS = new Set(['function_declaration', 'generator_function_declaration']);
const CLASS_DECLS = new Set(['class_declaration', 'abstract_class_declaration']);
const VAR_DECLS = new Set(['lexical_declaration', 'variable_declaration']);
const FN_EXPR_TYPES = new Set(['arrow_function', 'function_expression', 'generator_function']);

function _declName(node) {
  for (const c of node.namedChildren) {
    if (c.type === 'identifier' || c.type === 'type_identifier') return c.text;
  }
  return null;
}

function _arrowDeclNames(varDeclNode) {
  const names = [];
  for (const d of varDeclNode.namedChildren) {
    if (d.type !== 'variable_declarator') continue;
    const nameNode = d.namedChildren[0];
    const valNode = d.namedChildren[d.namedChildren.length - 1];
    if (nameNode && nameNode.type === 'identifier' && valNode && FN_EXPR_TYPES.has(valNode.type)) {
      names.push(nameNode.text);
    }
  }
  return names;
}

// AST path: collect declared function/class names, inline `export` names, and
// `export { ... }` specifier names.
function _astCollect(content, parser) {
  const declared = new Set();
  const esExportedInline = new Set();
  const exportSpecifiers = new Set();

  const tree = parser.parse(content);
  for (const child of tree.rootNode.namedChildren) {
    const t = child.type;

    if (t === 'export_statement') {
      for (const c of child.namedChildren) {
        if (FN_DECLS.has(c.type) || CLASS_DECLS.has(c.type)) {
          const nm = _declName(c);
          if (nm) { declared.add(nm); esExportedInline.add(nm); }
        } else if (VAR_DECLS.has(c.type)) {
          for (const nm of _arrowDeclNames(c)) { declared.add(nm); esExportedInline.add(nm); }
        } else if (c.type === 'export_clause') {
          for (const spec of c.namedChildren) {
            if (spec.type === 'export_specifier' && spec.namedChildren.length) {
              exportSpecifiers.add(spec.namedChildren[spec.namedChildren.length - 1].text);
            }
          }
        }
      }
      continue;
    }

    if (FN_DECLS.has(t) || CLASS_DECLS.has(t)) {
      const nm = _declName(child);
      if (nm) declared.add(nm);
    } else if (VAR_DECLS.has(t)) {
      for (const nm of _arrowDeclNames(child)) declared.add(nm);
    }
  }

  return { declared, esExportedInline, exportSpecifiers };
}

// Regex fallback for JS/TS when tree-sitter is unavailable.
function _regexCollect(content) {
  const declared = new Set();
  const esExportedInline = new Set();
  const exportSpecifiers = new Set();

  const fnRe = /^[ \t]*(export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm;
  const classRe = /^[ \t]*(export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm;
  const arrowRe = /^[ \t]*(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*(?:async\s+)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/gm;

  for (const re of [fnRe, classRe, arrowRe]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content)) !== null) {
      declared.add(m[2]);
      if (m[1]) esExportedInline.add(m[2]);
    }
  }

  const specRe = /export\s*\{([^}]*)\}/g;
  let sm;
  while ((sm = specRe.exec(content)) !== null) {
    for (const raw of sm[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/i).pop().trim();
      if (name) exportSpecifiers.add(name);
    }
  }

  return { declared, esExportedInline, exportSpecifiers };
}

// CommonJS export names — always regex (runtime assignments, not declarations).
function _commonjsExports(content) {
  const names = new Set();

  const objRe = /(?:module\.)?exports\s*=\s*\{([^}]*)\}/g;
  let m;
  while ((m = objRe.exec(content)) !== null) {
    for (const raw of m[1].split(',')) {
      const key = raw.split(':')[0].trim().replace(/\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(key)) names.add(key);
    }
  }

  const propRe = /(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g;
  while ((m = propRe.exec(content)) !== null) names.add(m[1]);

  const singleRe = /module\.exports\s*=\s*([A-Za-z_$][\w$]*)\s*;?/g;
  while ((m = singleRe.exec(content)) !== null) names.add(m[1]);

  return names;
}

const NEXT_ROUTE_RES = [
  /(?:^|\/)app\/api\/(.+?)\/route\.[jt]sx?$/,
  /(?:^|\/)api\/(.+?)\/route\.[jt]sx?$/,
  /(?:^|\/)pages\/api\/(.+?)\.[jt]sx?$/,
];
function deriveNextRoutePath(filePath) {
  for (const re of NEXT_ROUTE_RES) {
    const m = filePath.match(re);
    if (m) return `/api/${m[1]}`;
  }
  return null;
}
function isApiFile(filePath) {
  return /(?:^|\/)api\//.test(filePath) || /route\.[jt]sx?$/.test(filePath);
}

function _pyTopLevel(content, parser) {
  const names = [];
  const tree = parser.parse(content);
  for (const child of tree.rootNode.namedChildren) {
    let node = child;
    if (node.type === 'decorated_definition') {
      node = node.namedChildren.find((c) => c.type === 'function_definition' || c.type === 'class_definition');
      if (!node) continue;
    }
    if (node.type === 'function_definition' || node.type === 'class_definition') {
      const nm = _declName(node);
      if (nm && !nm.startsWith('_')) names.push(nm);
    }
  }
  return names;
}

function _pyTopLevelRegex(content) {
  const names = [];
  const re = /^(?:async\s+)?(?:def|class)\s+([A-Za-z_]\w*)/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (!m[1].startsWith('_')) names.push(m[1]);
  }
  return names;
}

// Returns { functions: [symbol], endpoints: [{ symbol, routePath }] }.
function collectExportsAndEndpoints(content, filePath, language) {
  if (language === 'python') {
    const parser = pickParser(language, filePath);
    let names = null;
    if (parser) {
      try { names = _pyTopLevel(content, parser); } catch { names = null; }
    }
    if (!names) names = _pyTopLevelRegex(content);
    return { functions: [...new Set(names)], endpoints: [] };
  }

  if (language !== 'javascript' && language !== 'typescript') {
    return { functions: [], endpoints: [] };
  }

  const parser = pickParser(language, filePath);
  let collected = null;
  if (parser) {
    try { collected = _astCollect(content, parser); } catch { collected = null; }
  }
  if (!collected) collected = _regexCollect(content);

  const { declared, esExportedInline, exportSpecifiers } = collected;
  const cjs = _commonjsExports(content);

  const exported = new Set(esExportedInline);
  for (const n of exportSpecifiers) if (declared.has(n)) exported.add(n);
  for (const n of cjs) if (declared.has(n)) exported.add(n);

  const functions = [];
  const endpoints = [];
  const apiFile = isApiFile(filePath);
  const routePath = deriveNextRoutePath(filePath);

  for (const name of exported) {
    if (apiFile && HTTP_METHODS.has(name)) {
      endpoints.push({ symbol: routePath ? `${name} ${routePath}` : name, routePath });
    } else {
      functions.push(name);
    }
  }

  return { functions, endpoints };
}

// ---------------------------------------------------------------------------
// Routes — express/koa-style handler registration and framework decorators.
// ---------------------------------------------------------------------------

const ROUTER_IDENTS = new Set(['app', 'router', 'api', 'server', 'route', 'routes']);
const JS_ROUTE_RE = /\b([A-Za-z_$][\w$]*)\s*\.\s*(get|post|put|delete|patch|options|head|all)\s*\(\s*(['"])([^'"]+)\3/gi;
const PY_ROUTE_RE = /@\s*([A-Za-z_][\w]*)\s*\.\s*(get|post|put|delete|patch|route)\s*\(\s*(['"])([^'"]+)\3/gi;

function collectRoutes(content, filePath, language) {
  const routes = [];
  const seen = new Set();
  const add = (method, path) => {
    const symbol = `${method.toUpperCase()} ${path}`;
    if (seen.has(symbol)) return;
    seen.add(symbol);
    routes.push({ symbol, routePath: path });
  };

  if (language === 'python') {
    let m;
    PY_ROUTE_RE.lastIndex = 0;
    while ((m = PY_ROUTE_RE.exec(content)) !== null) {
      const method = m[2].toLowerCase() === 'route' ? 'ROUTE' : m[2];
      add(method, m[4]);
    }
    return routes;
  }

  let m;
  JS_ROUTE_RE.lastIndex = 0;
  while ((m = JS_ROUTE_RE.exec(content)) !== null) {
    const ident = m[1];
    const path = m[4];
    if (!path.startsWith('/')) continue;
    if (!ROUTER_IDENTS.has(ident.toLowerCase()) && !/router$/i.test(ident)) continue;
    add(m[2], path);
  }
  return routes;
}

// ---------------------------------------------------------------------------
// Models — prisma models, SQL tables, mongoose/sequelize definitions.
// ---------------------------------------------------------------------------

function collectModels(content, filePath) {
  const models = [];
  const seen = new Set();
  const add = (name) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    models.push(name);
  };

  let m;
  if (/\.prisma$/i.test(filePath)) {
    const re = /(?:^|\n)\s*model\s+([A-Za-z_]\w*)\s*\{/g;
    while ((m = re.exec(content)) !== null) add(m[1]);
  }

  if (/\.sql$/i.test(filePath) || /(?:^|\/)(?:migrations?|schema)/i.test(filePath)) {
    const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([A-Za-z_]\w*)["'`]?/gi;
    while ((m = re.exec(content)) !== null) add(m[1]);
  }

  const mongooseRe = /(?:mongoose|db)\s*\.\s*model\s*\(\s*(['"])([A-Za-z_]\w*)\1/g;
  while ((m = mongooseRe.exec(content)) !== null) add(m[2]);

  const sequelizeRe = /sequelize\s*\.\s*define\s*\(\s*(['"])([A-Za-z_]\w*)\1/g;
  while ((m = sequelizeRe.exec(content)) !== null) add(m[2]);

  const modelClassRe = /class\s+([A-Za-z_]\w*)\s+extends\s+Model\b/g;
  while ((m = modelClassRe.exec(content)) !== null) add(m[1]);

  return models;
}

// ---------------------------------------------------------------------------
// Entrypoints.
// ---------------------------------------------------------------------------

const ENTRYPOINT_RE = /^(?:app|server|index|main)\.(?:mjs|cjs|jsx?|tsx?|py)$/;
function entrypointSymbol(filePath) {
  const base = filePath.split('/').pop();
  return ENTRYPOINT_RE.test(base) ? base : null;
}

// ---------------------------------------------------------------------------
// Public API.
// ---------------------------------------------------------------------------

/**
 * @param {Record<string,string>} fileContents  in-memory { path: content }
 * @param {string[]} [fileTree]                  full path list (unused today;
 *   accepted so callers can pass analyzer's fileTree without change)
 * @returns {{file_path:string,symbol:string,kind:string,feature_area:string}[]}
 */
function extractStructureAnchors(fileContents, fileTree) {
  void fileTree;
  const anchors = [];
  if (!fileContents || typeof fileContents !== 'object') return anchors;

  const skip = getShouldSkipFile();
  const seen = new Set();
  const push = (file_path, symbol, kind, feature_area) => {
    if (!symbol) return;
    const key = `${file_path}|${kind}|${symbol}`;
    if (seen.has(key)) return;
    seen.add(key);
    anchors.push({ file_path, symbol, kind, feature_area });
  };

  const paths = Object.keys(fileContents)
    .filter((p) => typeof p === 'string')
    .sort();

  for (const filePath of paths) {
    const content = fileContents[filePath];
    if (typeof content !== 'string') continue;
    if (skip(filePath) || isTestFile(filePath)) continue;

    const language = inferLanguage(filePath);

    const entry = entrypointSymbol(filePath);
    if (entry) push(filePath, entry, 'entrypoint', deriveFeatureArea(filePath, null));

    for (const name of collectModels(content, filePath)) {
      push(filePath, name, 'model', deriveFeatureArea(filePath, null));
    }

    for (const r of collectRoutes(content, filePath, language)) {
      push(filePath, r.symbol, 'route', deriveFeatureArea(filePath, r.routePath));
    }

    const { functions, endpoints } = collectExportsAndEndpoints(content, filePath, language);
    for (const e of endpoints) {
      push(filePath, e.symbol, 'endpoint', deriveFeatureArea(filePath, e.routePath));
    }
    for (const name of functions) {
      push(filePath, name, 'function', deriveFeatureArea(filePath, null));
    }
  }

  return anchors;
}

module.exports = { extractStructureAnchors, deriveFeatureArea };
