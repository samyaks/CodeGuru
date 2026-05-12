/**
 * exposed-secrets — find API keys, tokens, and credentials committed
 * to source code.
 *
 * Severity:
 *   - critical for high-confidence vendor key formats (AWS, GitHub PAT,
 *     Anthropic, OpenAI, Stripe, Slack, Google, generic JWT, DB URLs
 *     with embedded credentials)
 *   - high for password / secret patterns assigned to variables
 *
 * Privacy contract: this detector MUST NOT log, persist, or transmit
 * the raw secret value. The `evidence` payload includes only the file
 * path, line number, pattern name, and a redacted snippet (the
 * matched substring is replaced with ***REDACTED*** before storage).
 *
 * Limits:
 *   - Skips .env.example / .env.sample / README.md (well-known
 *     placeholder hosts).
 *   - Per-line scan: a multi-line string holding a secret on the
 *     second line still gets flagged because the patterns match
 *     `<prefix>[A-Za-z0-9_-]{N,}` against any line. Pasted multi-line
 *     keys are rare enough that we accept the miss.
 *   - Patterns are conservative; rotating in new vendor key shapes
 *     means adding a row here, not retraining anything.
 *
 * CWE-798: Use of Hard-coded Credentials.
 */

const NAME = 'exposed-secrets';

// Each pattern: { re, name, severity, cweId? }. We use distinct rows
// rather than a giant alternation so we can attribute severity per
// pattern and surface a meaningful "Possible <kind>" reason in the UI.
const PATTERNS = [
  // High-confidence vendor formats
  { re: /sk-ant-[A-Za-z0-9_-]{20,}/g,        name: 'Anthropic API key',         severity: 'critical' },
  { re: /sk-[A-Za-z0-9]{30,}/g,              name: 'OpenAI / generic sk- key',  severity: 'critical' },
  { re: /AKIA[0-9A-Z]{16}/g,                 name: 'AWS access key id',         severity: 'critical' },
  { re: /ghp_[A-Za-z0-9]{30,}/g,             name: 'GitHub personal access token', severity: 'critical' },
  { re: /gho_[A-Za-z0-9]{30,}/g,             name: 'GitHub OAuth token',        severity: 'critical' },
  { re: /github_pat_[A-Za-z0-9_]{20,}/g,     name: 'GitHub fine-grained PAT',   severity: 'critical' },
  { re: /glpat-[A-Za-z0-9_-]{15,}/g,         name: 'GitLab personal access token', severity: 'critical' },
  { re: /xox[abprs]-[A-Za-z0-9-]{10,}/g,     name: 'Slack token',               severity: 'critical' },
  { re: /sk_live_[A-Za-z0-9]{20,}/g,         name: 'Stripe live secret key',    severity: 'critical' },
  { re: /rk_live_[A-Za-z0-9]{20,}/g,         name: 'Stripe live restricted key',severity: 'critical' },
  { re: /AIza[0-9A-Za-z_-]{35}/g,            name: 'Google API key',            severity: 'critical' },
  // RSA private key block opener — strong signal even if we don't see
  // the full body on one line.
  { re: /-----BEGIN (?:RSA|OPENSSH|EC|DSA|PGP) PRIVATE KEY-----/g,
                                              name: 'Private key block',         severity: 'critical' },
  // Database connection strings with embedded password.
  { re: /(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s'"`]+:[^\s'"`@]+@[^\s'"`]+/g,
                                              name: 'DB URL with embedded credentials', severity: 'critical' },
  // Generic password / secret assignment. Lower confidence — flagged
  // as 'high', not 'critical'.
  { re: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"\s]{8,}['"]/gi,
                                              name: 'Hardcoded password',        severity: 'high' },
  { re: /(?:jwt[_-]?secret|session[_-]?secret|secret[_-]?key)\s*[:=]\s*['"][^'"\s]{6,}['"]/gi,
                                              name: 'Hardcoded JWT/session secret', severity: 'high' },
];

// Files the analyzer shouldn't touch even when they happen to contain
// secret-shaped strings on purpose. Markdown is excluded outright —
// docs and spec files routinely include realistic-looking but
// deliberately-fake connection strings, OAuth tokens, etc., as
// teaching aids. The cost of missing a real secret in a .md file is
// far lower than the cost of every README being a critical finding.
function isExcluded(path) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.env.example')) return true;
  if (lower.endsWith('.env.sample')) return true;
  if (lower.endsWith('.md') || lower.endsWith('.mdx')) return true;
  if (lower.endsWith('.txt')) return true;
  // Doc folders: people paste fake-looking tokens in tutorials.
  if (lower.includes('/docs/') || lower.startsWith('docs/')) return true;
  return false;
}

function redact(line, match) {
  // Replace ALL occurrences of the matched value, not just the first,
  // so a line like `key1, key2 = "AKIA…", "AKIA…"` doesn't leak the
  // second copy through the snippet.
  return line.split(match).join('***REDACTED***').slice(0, 160);
}

async function run({ fileContents }) {
  if (!fileContents || typeof fileContents !== 'object') return [];
  const findings = [];

  for (const [path, content] of Object.entries(fileContents)) {
    if (typeof content !== 'string') continue;
    if (isExcluded(path)) continue;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Cheap guard: most files have nothing matching even the first
      // character class, so testing the first few patterns is wasted
      // work. The cost of running all patterns per line on a 200-file
      // repo is still milliseconds, but this keeps it bounded.
      if (line.length === 0) continue;

      for (const { re, name, severity } of PATTERNS) {
        // Reset because /g regex objects carry lastIndex.
        re.lastIndex = 0;
        const m = re.exec(line);
        if (!m) continue;

        const snippet = redact(line.trim(), m[0]);
        findings.push({
          file: path,
          line: i + 1,
          severity,
          cweId: 'CWE-798',
          title: `Possible ${name} committed in ${path}`,
          description:
            `A line in ${path} matches the pattern of a ${name}. ` +
            `Anyone with read access to this repo can see this credential. ` +
            `Move it to an environment variable, rotate the key (assume it's already compromised), and ` +
            `make sure the file is gitignored if it's a config dump.`,
          evidence: [{ file: path, line: i + 1, reason: name, snippet }],
        });
        // Break after first hit on a line so a multi-pattern line
        // doesn't fan out into duplicate findings.
        break;
      }
    }
  }

  return findings;
}

module.exports = {
  name: NAME,
  severity: 'critical',
  cweId: 'CWE-798',
  run,
};
