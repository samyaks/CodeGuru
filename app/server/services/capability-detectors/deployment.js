/**
 * deployment — does this codebase ship to somewhere?
 *
 * Signals:
 *   - Presence of platform-specific config files (Dockerfile, vercel.json,
 *     .github/workflows/*, fly.toml, Procfile, etc.).
 *   - A `package.json` "deploy" script (or a "start" script that respects
 *     `PORT`).
 *
 * Note: `analyzer.js` still merges richer `detectDeploymentFiles(tree)`
 * output into `gaps.deployment` AFTER this detector runs — the legacy
 * merge owns the canonical `platform` / `platforms` / `hasCI` values when
 * deployment files are present. This detector exists primarily so the
 * confidence/evidence pipeline stays uniform across capabilities.
 */

const NAME = 'deployment';

const HOSTING_PATTERNS = [
  { re: /^vercel\.json$/,         platform: 'Vercel' },
  { re: /^netlify\.toml$/,        platform: 'Netlify' },
  { re: /^fly\.toml$/,            platform: 'Fly.io' },
  { re: /^railway\.json$/,        platform: 'Railway' },
  { re: /^railway\.toml$/,        platform: 'Railway' },
  { re: /^render\.ya?ml$/,        platform: 'Render' },
  { re: /^Procfile$/,             platform: 'Heroku' },
  { re: /^app\.ya?ml$/,           platform: 'Google App Engine' },
  { re: /^firebase\.json$/,       platform: 'Firebase' },
  { re: /^amplify\.ya?ml$/,       platform: 'AWS Amplify' },
];

const CONTAINER_PATTERNS = [
  { re: /(?:^|\/)Dockerfile(?:\.[\w-]+)?$/, platform: 'Docker' },
  { re: /(?:^|\/)docker-compose\.ya?ml$/,   platform: 'Docker Compose' },
];

const CI_PATTERNS = [
  { re: /^\.github\/workflows\/.+\.ya?ml$/, platform: 'GitHub Actions' },
  { re: /^\.gitlab-ci\.ya?ml$/,             platform: 'GitLab CI' },
  { re: /^\.circleci\/.+\.ya?ml$/,          platform: 'CircleCI' },
];

const IAC_PATTERNS = [
  { re: /^serverless\.ya?ml$/,              platform: 'Serverless Framework' },
  { re: /^cdk\.json$/,                      platform: 'AWS CDK' },
  { re: /^terraform\//,                     platform: 'Terraform' },
];

const ARTIFACT_DIR_RE = /(?:^|\s|\/)(?:dist|build|out|\.next|\.nuxt|\.output)(?:\/|\s|$)/;
const PORT_ENV_RE = /\$(?:PORT|\{PORT\})|process\.env\.PORT/;

const FILE_SIGNAL_PER_FILE = 0.9;
const FILE_SIGNAL_CAP = 1.0;
const SCRIPT_SIGNAL = 0.4;

function safeJson(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

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

function matchPlatforms(files, patternList) {
  const out = [];
  for (const f of files) {
    for (const p of patternList) {
      if (p.re.test(f.path)) {
        out.push({ file: f.path, platform: p.platform });
        break;
      }
    }
  }
  return out;
}

async function run({ files = [], fileContents = {} } = {}) {
  const evidence = [];
  const signals = [];

  const hosting = matchPlatforms(files, HOSTING_PATTERNS);
  const containers = matchPlatforms(files, CONTAINER_PATTERNS);
  const ci = matchPlatforms(files, CI_PATTERNS);
  const iac = matchPlatforms(files, IAC_PATTERNS);

  const platformHits = [...hosting, ...containers, ...ci, ...iac];
  if (platformHits.length > 0) {
    signals.push(capAt(platformHits.length, FILE_SIGNAL_PER_FILE, FILE_SIGNAL_CAP));
    for (const h of platformHits.slice(0, 12)) {
      evidence.push({ file: h.file, reason: `${h.platform} config` });
    }
  }

  const pkg = safeJson(fileContents['package.json']);
  if (pkg && pkg.scripts && typeof pkg.scripts === 'object') {
    let scriptHit = null;
    if (typeof pkg.scripts.deploy === 'string') {
      scriptHit = { file: 'package.json', reason: '"deploy" script defined' };
    } else if (typeof pkg.scripts.start === 'string' && PORT_ENV_RE.test(pkg.scripts.start)) {
      scriptHit = { file: 'package.json', reason: '"start" script uses $PORT' };
    } else if (typeof pkg.scripts.build === 'string' && ARTIFACT_DIR_RE.test(pkg.scripts.build)) {
      scriptHit = { file: 'package.json', reason: '"build" script writes to known artifact dir' };
    }
    if (scriptHit) {
      signals.push(SCRIPT_SIGNAL);
      evidence.push(scriptHit);
    }
  }

  const confidence = combine(signals);

  const hostingPlatforms = [...new Set(hosting.map((h) => h.platform))];
  const containerPlatforms = [...new Set(containers.map((c) => c.platform))];
  const platforms = hostingPlatforms.length > 0 ? hostingPlatforms : containerPlatforms;
  const platform = hostingPlatforms.length > 0
    ? hostingPlatforms.join(', ')
    : (containerPlatforms[0] || null);

  let status;
  if (confidence >= 0.7) status = 'present';
  else if (confidence >= 0.3) status = 'partial';
  else status = 'missing';

  return {
    exists: status !== 'missing',
    confidence,
    status,
    evidence,
    extra: {
      platform,
      platforms,
      hasCI: ci.length > 0,
    },
  };
}

module.exports = { name: NAME, run };
