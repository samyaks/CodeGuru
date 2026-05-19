// Pure utilities used by the analyzer capture layer.
// CommonJS exports. Tree-sitter is loaded lazily and defensively;
// if any binding fails to build (e.g. on a host without prebuilds and
// without node-gyp), we silently fall back to the regex skeletonizer.

function estimateTokens(text) {
  if (text == null) return 0;
  const len = typeof text === 'string' ? text.length : String(text).length;
  return Math.ceil(len / 4);
}

const EXT_LANG = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  java: 'java',
  kt: 'java',
  json: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'markdown',
  mdx: 'markdown',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'css',
  sass: 'css',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
};

function inferLanguage(filePath) {
  if (!filePath || typeof filePath !== 'string') return null;
  const name = filePath.split('/').pop() || '';
  const lower = name.toLowerCase();
  if (lower === 'dockerfile' || lower.endsWith('.dockerfile')) return 'shell';
  if (lower === 'makefile') return 'shell';
  const dot = lower.lastIndexOf('.');
  if (dot === -1) return null;
  const ext = lower.slice(dot + 1);
  return EXT_LANG[ext] || null;
}

function computeDepth(filePath) {
  if (!filePath || typeof filePath !== 'string') return 1;
  let slashes = 0;
  for (let i = 0; i < filePath.length; i++) {
    if (filePath[i] === '/') slashes++;
  }
  return slashes + 1;
}

// ---------------------------------------------------------------------------
// Tree-sitter loader. Each module is wrapped individually so a single failed
// binding can't take down the others (and so we always fall through cleanly
// to the regex skeletonizer when the native build is missing).
// ---------------------------------------------------------------------------

let _warned = false;
function _warnOnce(err) {
  if (_warned) return;
  _warned = true;
  console.warn('[capture-utils] tree-sitter not available, falling back to regex:', err && err.message ? err.message : err);
}

function _safeRequire(name) {
  try { return require(name); } catch (err) { _warnOnce(err); return null; }
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
  } catch (err) {
    _warnOnce(err);
    return null;
  }
}

const parsers = {
  ts: _initParser(_TS && _TS.typescript),
  tsx: _initParser(_TS && _TS.tsx),
  js: _initParser(_JS),
  py: _initParser(_Py),
};

function _pickParser(language, filePath) {
  if (language === 'python') return parsers.py;
  const isTsx = !!(filePath && /\.tsx$/i.test(filePath));
  if (language === 'typescript') return isTsx ? (parsers.tsx || parsers.ts) : parsers.ts;
  if (language === 'javascript') return isTsx ? (parsers.tsx || parsers.js) : parsers.js;
  return null;
}

// ---------------------------------------------------------------------------
// Public skeleton extractor.
// ---------------------------------------------------------------------------

function extractSkeleton(content, maxLen = 4000, opts = {}) {
  if (!content) return '';
  const language = (opts && opts.language) || inferLanguage(opts && opts.path);
  const parser = _pickParser(language, opts && opts.path);

  if (parser) {
    try {
      const lines = language === 'python'
        ? _extractPythonSkeleton(content, parser)
        : _extractJsTsSkeleton(content, parser);
      if (lines && lines.length) {
        return _truncate(lines.join('\n'), maxLen);
      }
    } catch (_err) {
      // fall through to regex
    }
  }

  return extractSkeletonRegex(content, maxLen);
}

function _truncate(out, maxLen) {
  if (out.length <= maxLen) return out;
  const suffix = '\n// …';
  const cut = Math.max(0, maxLen - suffix.length);
  return out.slice(0, cut) + suffix;
}

function _oneLine(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// JS / TS extractor.
// ---------------------------------------------------------------------------

const _JS_FN_DECLS = new Set([
  'function_declaration',
  'generator_function_declaration',
  'function_signature',
]);
const _JS_CLASS_DECLS = new Set([
  'class_declaration',
  'abstract_class_declaration',
]);
const _JS_VAR_DECLS = new Set([
  'lexical_declaration',
  'variable_declaration',
]);
const _JS_TYPE_DECLS = new Set([
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
  'module_declaration',
  'internal_module',
]);
const _JS_BODY_TYPES = new Set([
  'statement_block',
  'class_body',
  'interface_body',
  'enum_body',
  'object_type',
]);
const _JS_FN_EXPR_TYPES = new Set([
  'arrow_function',
  'function_expression',
  'generator_function',
]);

function _extractJsTsSkeleton(content, parser) {
  const tree = parser.parse(content);
  const root = tree.rootNode;
  const out = [];
  for (const child of root.namedChildren) {
    _formatJsTopLevel(child, out);
  }
  return out;
}

function _formatJsTopLevel(node, out) {
  const t = node.type;

  if (t === 'import_statement') {
    out.push(_oneLine(node.text));
    return;
  }

  if (t === 'export_statement') {
    const inner = _findExportInner(node);
    if (inner) {
      const prefix = node.text.slice(0, inner.startIndex - node.startIndex);
      if (_JS_CLASS_DECLS.has(inner.type)) {
        _emitClass(inner, out, prefix);
      } else if (_JS_VAR_DECLS.has(inner.type)) {
        const sig = _formatVariableDeclaration(inner);
        if (sig) out.push(prefix + sig);
      } else if (_JS_FN_DECLS.has(inner.type) || _JS_TYPE_DECLS.has(inner.type)) {
        out.push(prefix + _stripBody(inner));
      } else {
        out.push(_oneLine(node.text));
      }
      return;
    }
    out.push(_oneLine(node.text));
    return;
  }

  if (_JS_FN_DECLS.has(t)) {
    out.push(_stripBody(node));
    return;
  }

  if (_JS_CLASS_DECLS.has(t)) {
    _emitClass(node, out, '');
    return;
  }

  if (_JS_TYPE_DECLS.has(t)) {
    out.push(_stripBody(node));
    return;
  }

  if (_JS_VAR_DECLS.has(t)) {
    const sig = _formatVariableDeclaration(node);
    if (sig) out.push(sig);
    return;
  }
}

function _findExportInner(exportNode) {
  for (const c of exportNode.namedChildren) {
    if (
      _JS_FN_DECLS.has(c.type) ||
      _JS_CLASS_DECLS.has(c.type) ||
      _JS_TYPE_DECLS.has(c.type) ||
      _JS_VAR_DECLS.has(c.type)
    ) {
      return c;
    }
  }
  return null;
}

function _findFirstBodyChild(node) {
  for (const c of node.children) {
    if (_JS_BODY_TYPES.has(c.type)) return c;
  }
  return null;
}

function _stripBody(node) {
  const body = _findFirstBodyChild(node);
  if (!body) return _trimSemiTrailing(node.text);
  const head = node.text.slice(0, body.startIndex - node.startIndex).replace(/\s+$/, '');
  return head + ' { ... }';
}

function _trimSemiTrailing(s) {
  return String(s).replace(/\s+$/, '');
}

function _emitClass(classNode, out, prefix) {
  const body = classNode.children.find((c) => c.type === 'class_body');
  if (!body) {
    out.push(prefix + classNode.text.trim());
    return;
  }
  const head = classNode.text.slice(0, body.startIndex - classNode.startIndex).replace(/\s+$/, '');
  const members = body.namedChildren.filter(
    (c) => c.type === 'method_definition' || c.type === 'method_signature' || c.type === 'abstract_method_signature'
  );
  if (!members.length) {
    out.push(prefix + head + ' { ... }');
    return;
  }
  out.push(prefix + head + ' {');
  for (const m of members) {
    out.push('  ' + _stripBody(m));
  }
  out.push('}');
}

function _findFnExprBody(node) {
  // DFS pre-order for the first statement_block whose parent is an arrow/function expression.
  const stack = [{ n: node, parentType: null }];
  while (stack.length) {
    const { n, parentType } = stack.shift();
    if (n.type === 'statement_block' && parentType && _JS_FN_EXPR_TYPES.has(parentType)) {
      return n;
    }
    for (let i = n.namedChildren.length - 1; i >= 0; i--) {
      stack.unshift({ n: n.namedChildren[i], parentType: n.type });
    }
  }
  return null;
}

function _hasFnLikeInit(varDecl) {
  for (const d of varDecl.namedChildren) {
    if (d.type !== 'variable_declarator') continue;
    for (const c of d.namedChildren) {
      if (_JS_FN_EXPR_TYPES.has(c.type) || c.type === 'call_expression') return true;
    }
  }
  return false;
}

function _formatVariableDeclaration(node) {
  if (!_hasFnLikeInit(node)) return null;
  const body = _findFnExprBody(node);
  if (body) {
    return node.text.slice(0, body.startIndex - node.startIndex).replace(/\s+$/, '') + ' { ... }';
  }
  return _oneLine(node.text);
}

// ---------------------------------------------------------------------------
// Python extractor.
// ---------------------------------------------------------------------------

const _PY_IMPORTS = new Set(['import_statement', 'import_from_statement', 'future_import_statement']);
const _PY_TYPE_RHS = new Set(['identifier', 'subscript', 'attribute', 'tuple', 'binary_operator', 'string', 'generic_type']);

function _extractPythonSkeleton(content, parser) {
  const tree = parser.parse(content);
  const root = tree.rootNode;
  const out = [];
  for (const child of root.namedChildren) {
    _formatPyTopLevel(child, out);
  }
  return out;
}

function _formatPyTopLevel(node, out) {
  const t = node.type;
  if (_PY_IMPORTS.has(t)) {
    out.push(_oneLine(node.text));
    return;
  }
  if (t === 'function_definition') {
    out.push(_pySignature(node));
    return;
  }
  if (t === 'class_definition') {
    _emitPyClass(node, out, []);
    return;
  }
  if (t === 'decorated_definition') {
    const decorators = node.namedChildren.filter((c) => c.type === 'decorator').map((d) => d.text.trim());
    const inner = node.namedChildren.find((c) => c.type === 'function_definition' || c.type === 'class_definition');
    if (!inner) return;
    if (inner.type === 'function_definition') {
      for (const d of decorators) out.push(d);
      out.push(_pySignature(inner));
    } else {
      _emitPyClass(inner, out, decorators);
    }
    return;
  }
  if (t === 'expression_statement') {
    const assign = node.children.find((c) => c.type === 'assignment');
    if (assign && _looksLikePyTypeAlias(assign)) {
      out.push(_oneLine(node.text));
    }
  }
}

function _pySignature(fnNode) {
  const body = fnNode.children.find((c) => c.type === 'block');
  if (!body) return fnNode.text.trim() + ' ...';
  const head = fnNode.text.slice(0, body.startIndex - fnNode.startIndex).replace(/\s+$/, '');
  return head + ' ...';
}

function _emitPyClass(classNode, out, decorators) {
  for (const d of decorators) out.push(d);
  const body = classNode.children.find((c) => c.type === 'block');
  if (!body) {
    out.push(classNode.text.trim() + ' ...');
    return;
  }
  const head = classNode.text.slice(0, body.startIndex - classNode.startIndex).replace(/\s+$/, '');
  out.push(head + ' ...');
  const first = body.namedChildren[0];
  if (first && first.type === 'expression_statement') {
    const str = first.children.find((c) => c.type === 'string');
    if (str) {
      const firstLine = _firstDocstringLine(str.text);
      if (firstLine) out.push('  """' + firstLine + '"""');
    }
  }
  for (const member of body.namedChildren) {
    if (member.type === 'function_definition') {
      out.push('  ' + _pySignature(member));
    } else if (member.type === 'decorated_definition') {
      const inner = member.namedChildren.find((c) => c.type === 'function_definition');
      if (!inner) continue;
      for (const dec of member.namedChildren.filter((c) => c.type === 'decorator')) {
        out.push('  ' + dec.text.trim());
      }
      out.push('  ' + _pySignature(inner));
    }
  }
}

function _firstDocstringLine(raw) {
  let s = String(raw);
  // strip optional prefix flags (r, b, u, R, B, U)
  s = s.replace(/^[ruRUbB]{0,2}/, '');
  // strip leading triple or single quotes
  s = s.replace(/^(?:'''|"""|'|")/, '');
  // strip trailing triple or single quotes
  s = s.replace(/(?:'''|"""|'|")\s*$/, '');
  const line = s.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
  return line || '';
}

function _looksLikePyTypeAlias(assignNode) {
  const named = assignNode.namedChildren;
  if (named.length < 2) return false;
  const lhs = named[0];
  if (lhs.type !== 'identifier') return false;
  const rhs = named[named.length - 1];
  return _PY_TYPE_RHS.has(rhs.type);
}

// ---------------------------------------------------------------------------
// Regex skeletonizer — original implementation kept verbatim as a fallback
// for languages with no tree-sitter binding (and as the last line of defence
// if the parsers fail to load on the host).
// ---------------------------------------------------------------------------

function extractSkeletonRegex(content, maxLen = 4000) {
  if (!content) return '';
  const lines = String(content).split(/\r?\n/);
  const kept = [];

  const importRe = /^\s*(?:import\b|export\s+(?:\*|\{)|from\s+['"][^'"]+['"]\s+import\b|from\b)/;
  const jsExportRe = /^\s*export\b/;
  const jsFnRe = /^\s*(?:export\s+)?(?:async\s+)?function\s+[\w$]+\s*\(/;
  const jsClassRe = /^\s*(?:export\s+)?(?:abstract\s+)?class\s+[\w$]+/;
  const jsTypeRe = /^\s*(?:export\s+)?(?:type|interface|enum)\s+[\w$]+/;
  const jsTopAssignRe = /^\s*(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)\s*=>|function\b|[\w$]+\s*\()?/;
  const pyImportRe = /^\s*(?:import\s+\w|from\s+[\w.]+\s+import\b)/;
  const pyDefRe = /^\s*(?:async\s+)?def\s+[\w_]+\s*\(/;
  const pyClassRe = /^\s*class\s+[\w_]+/;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) continue;

    if (
      importRe.test(line) ||
      pyImportRe.test(line) ||
      jsExportRe.test(line) ||
      jsFnRe.test(line) ||
      jsClassRe.test(line) ||
      jsTypeRe.test(line) ||
      pyDefRe.test(line) ||
      pyClassRe.test(line) ||
      jsTopAssignRe.test(line)
    ) {
      let signature = line;
      const braceIdx = signature.indexOf('{');
      if (braceIdx !== -1 && (jsFnRe.test(line) || jsClassRe.test(line) || jsTopAssignRe.test(line) || jsExportRe.test(line))) {
        signature = signature.slice(0, braceIdx).replace(/\s+$/, '') + ' { ... }';
      }
      const colonIdx = signature.indexOf(':');
      if ((pyDefRe.test(line) || pyClassRe.test(line)) && colonIdx !== -1) {
        signature = signature.slice(0, colonIdx + 1) + ' ...';
      }
      kept.push(signature);
    }
  }

  let out = kept.join('\n');
  if (out.length > maxLen) {
    const suffix = '\n// …';
    const cut = Math.max(0, maxLen - suffix.length);
    out = out.slice(0, cut) + suffix;
  }
  return out;
}

module.exports = {
  estimateTokens,
  extractSkeleton,
  extractSkeletonRegex,
  inferLanguage,
  computeDepth,
};
