// Pure utilities used by the analyzer capture layer.
// No dependencies beyond Node stdlib. CommonJS exports.

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

// Heuristic, regex-based "skeleton" extractor that keeps imports, exports,
// function / class / type signatures, and top-level const/let assignments
// while stripping function bodies. Supports JS/TS/Python (best effort).
function extractSkeleton(content, maxLen = 400) {
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
      // Strip function bodies: keep signature, drop anything after the first `{`
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
  inferLanguage,
  computeDepth,
};
