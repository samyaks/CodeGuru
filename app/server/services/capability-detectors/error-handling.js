/**
 * errorHandling — does this codebase have a deliberate error-handling layer?
 *
 * "Deliberate" means an explicit global handler (Express error middleware,
 * Fastify `setErrorHandler`, Flask `@app.errorhandler`, React
 * `<ErrorBoundary>` / `componentDidCatch`, Go `recover()`) or a
 * recognizable error-handling file/dir.
 *
 * Per-file try/catch counts contribute a weaker signal — code can have
 * many local catches and still leak a 500 stack trace to users.
 *
 * Legacy gap shape: { exists, hasGlobalHandler } — preserved via `extra`.
 */

const NAME = 'errorHandling';

const GLOBAL_HANDLER_PATTERNS = [
  { re: /\bapp\.use\s*\(\s*\(\s*err\b/,           label: 'Express error middleware' },
  { re: /\berrorHandler\s*\(/,                     label: 'errorHandler() invocation' },
  { re: /<\s*ErrorBoundary\b/,                     label: 'React <ErrorBoundary>' },
  { re: /\bcomponentDidCatch\s*\(/,                label: 'componentDidCatch()' },
  { re: /\bsetErrorHandler\s*\(/,                  label: 'Fastify setErrorHandler()' },
  { re: /@app\.errorhandler\b/,                    label: 'Flask @app.errorhandler' },
  { re: /\brecover\s*\(\s*\)/,                     label: 'Go recover()' },
];

const PATH_PATTERNS = [
  { re: /(?:^|\/)error\//,                         label: 'error/ directory' },
  { re: /(?:^|\/)error-boundary\.[\w]+$/i,         label: 'error-boundary file' },
  { re: /(?:^|\/)error-handler\.[\w]+$/i,          label: 'error-handler file' },
  { re: /(?:^|\/)middleware\/error[\w.-]*/i,       label: 'middleware/error*' },
];

const ROUTE_FILE_RE = /(?:^|\/)(?:routes?|controllers?|api)\//i;
const CATCH_RE = /\bcatch\s*\(/;

const HANDLER_PER_FILE = 0.7;
const HANDLER_CAP = 0.9;
const PATH_SIGNAL = 0.6;
const ROUTE_CATCH_SIGNAL = 0.5;
const ROUTE_CATCH_THRESHOLD = 3;

function combine(signals) {
  let inv = 1;
  for (const s of signals) inv *= (1 - s);
  return 1 - inv;
}

function capAt(values, perItem, cap) {
  if (values <= 0) return 0;
  const raw = 1 - Math.pow(1 - perItem, values);
  return Math.min(raw, cap);
}

function findHandlerHits(fileContents) {
  const hits = [];
  for (const [path, content] of Object.entries(fileContents)) {
    if (typeof content !== 'string') continue;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const pat of GLOBAL_HANDLER_PATTERNS) {
        if (pat.re.test(lines[i])) {
          hits.push({ file: path, line: i + 1, snippet: lines[i].trim().slice(0, 200), reason: pat.label });
          break;
        }
      }
      if (hits.length > 200) return hits;
    }
  }
  return hits;
}

function findPathHits(files) {
  const hits = [];
  for (const f of files) {
    for (const pat of PATH_PATTERNS) {
      if (pat.re.test(f.path)) {
        hits.push({ file: f.path, reason: pat.label });
        break;
      }
    }
  }
  return hits;
}

function countRouteFilesWithCatch(fileContents) {
  let count = 0;
  for (const [path, content] of Object.entries(fileContents)) {
    if (typeof content !== 'string') continue;
    if (!ROUTE_FILE_RE.test(path)) continue;
    if (CATCH_RE.test(content)) count++;
  }
  return count;
}

async function run({ files = [], fileContents = {} } = {}) {
  const evidence = [];
  const signals = [];

  const handlerHits = findHandlerHits(fileContents);
  const hasGlobalHandler = handlerHits.length > 0;
  if (handlerHits.length > 0) {
    const uniqFiles = new Set(handlerHits.map((h) => h.file));
    signals.push(capAt(uniqFiles.size, HANDLER_PER_FILE, HANDLER_CAP));
    for (const h of handlerHits.slice(0, 10)) evidence.push(h);
  }

  const pathHits = findPathHits(files);
  if (pathHits.length > 0) {
    signals.push(PATH_SIGNAL);
    for (const h of pathHits.slice(0, 5)) evidence.push(h);
  }

  const routeCatchCount = countRouteFilesWithCatch(fileContents);
  if (routeCatchCount >= ROUTE_CATCH_THRESHOLD) {
    signals.push(ROUTE_CATCH_SIGNAL);
    evidence.push({
      file: '(aggregate)',
      reason: `${routeCatchCount} route/controller files use try/catch`,
    });
  }

  const confidence = combine(signals);

  let status;
  if (confidence >= 0.7) status = 'present';
  else if (confidence >= 0.3) status = 'partial';
  else status = 'missing';

  return {
    exists: status !== 'missing',
    confidence,
    status,
    evidence,
    extra: { hasGlobalHandler },
  };
}

module.exports = { name: NAME, run };
