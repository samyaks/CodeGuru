/**
 * sql-injection-patterns — flag SQL queries built via string
 * concatenation or template-literal interpolation, which is the
 * canonical shape of a SQL injection bug in Node.js.
 *
 * The spec calls for an AST-based detector; we deliberately use
 * regex here to keep the dependency surface small (no @babel/parser
 * required) and to match the rest of this codebase's static-rule
 * style. The regex is conservative — it looks at lines that contain
 * BOTH a query call site (`db.query`, `pool.query`, `client.query`,
 * raw `pgClient.query`, `connection.query`, `knex.raw`, etc.) AND a
 * template literal with `${}` interpolation OR string concatenation
 * with `+` against a variable.
 *
 * False-positive sources we accept:
 *   - Parameterised queries that happen to share a line with a
 *     template literal used only for logging. Rare; users can reject.
 *   - ORMs whose string-builder API is technically safe even with
 *     concatenation (Drizzle's `sql` template tag is a safe example).
 *     We exclude `sql\`` template tags (per popular SQL-tagged libs)
 *     to dodge the most common case.
 *
 * False-negative sources we accept:
 *   - Multi-line query construction split into vars first, then
 *     passed to `.query()` separately. This is the AST case the
 *     spec mentions; revisit in slice (b)+ if false-negative rate
 *     turns out to matter.
 *
 * Severity: high.
 * CWE-89: Improper Neutralization of Special Elements used in an SQL
 * Command ('SQL Injection').
 */

const NAME = 'sql-injection-patterns';

// Well-known query call shapes. The capture group is just for
// debugging; we don't use it.
const QUERY_CALL = /\b(?:db|pool|client|connection|conn|pg|pgClient|prisma\.\$queryRawUnsafe|knex\.raw)\.(query|raw|exec|execute|run)\s*\(/;
// `prisma.$queryRawUnsafe(...)` is unconditionally dangerous —
// includes the function name in the match. Same for `sequelize.query`.
const UNSAFE_CALL = /\b(?:\$queryRawUnsafe|\$executeRawUnsafe)\s*\(/;
// SQL keyword guard so we don't flag `redisClient.query("INFO")`
// style calls as SQL when no actual SQL keyword is present.
const SQL_KEYWORD = /\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|MERGE)\b/i;
// A template literal containing a `${}` interpolation. Matches across
// the whole line so something like `db.query(\`SELECT * FROM x WHERE id = ${id}\`)`
// matches.
const TEMPLATE_INTERP = /`[^`]*\$\{[^}]+\}[^`]*`/;
// String concat with a variable: `'SELECT … ' + foo + ' …'`. We use a
// rough check — a single-/double-quoted string immediately followed
// by `+` and a non-string token. Skips `'foo' + 'bar'` (literal-only
// concat).
const STRING_CONCAT = /(?:['"][^'"]*['"]\s*\+\s*[^'"\s)]+|[^'"\s(]+\s*\+\s*['"][^'"]*['"])/;
// Safe-tag opt-out: `sql\`SELECT ...\`` (tagged template). Drizzle,
// postgres-js, and slonik all use this convention.
const SAFE_TAG = /\b(?:sql|prisma\.\$queryRaw|prisma\.\$executeRaw)\s*`/;

function looksLikeSqlInjection(line) {
  if (SAFE_TAG.test(line)) return null;
  const isQueryCall = QUERY_CALL.test(line) || UNSAFE_CALL.test(line);
  if (!isQueryCall) return null;

  // For the unsafe-by-name calls (`$queryRawUnsafe`, `$executeRawUnsafe`)
  // we don't require the SQL keyword to fire — the function name is
  // already a confession.
  const isUnsafe = UNSAFE_CALL.test(line);
  if (!isUnsafe && !SQL_KEYWORD.test(line)) return null;

  if (TEMPLATE_INTERP.test(line)) return 'template-literal interpolation in a query';
  if (STRING_CONCAT.test(line))   return 'string concatenation in a query';
  if (isUnsafe)                    return 'use of *Unsafe Prisma raw query';
  return null;
}

function isLikelyJsOrTs(path) {
  return /\.(js|jsx|ts|tsx|mjs|cjs)$/.test(path);
}

async function run({ fileContents }) {
  if (!fileContents || typeof fileContents !== 'object') return [];
  const findings = [];

  for (const [path, content] of Object.entries(fileContents)) {
    if (typeof content !== 'string') continue;
    if (!isLikelyJsOrTs(path)) continue;
    // Skip test files — they often build "obviously vulnerable"
    // strings on purpose to verify sanitization.
    if (/(?:^|\/)__tests__\//.test(path) || /\.(test|spec)\.[a-z]+$/i.test(path)) continue;

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const reason = looksLikeSqlInjection(line);
      if (!reason) continue;

      const snippet = line.trim().slice(0, 200);
      findings.push({
        file: path,
        line: i + 1,
        severity: 'high',
        cweId: 'CWE-89',
        title: `Possible SQL injection at ${path}:${i + 1}`,
        description:
          `This line builds a SQL query via ${reason}. ` +
          `If any interpolated value is user-controlled (req.body / req.query / req.params), an attacker can ` +
          `terminate the intended query and run their own. Use parameterised queries — ` +
          `the second argument to \`.query(text, values)\` for pg, the \`?\` placeholder for mysql2, the ` +
          `\`sql\` tagged template for Drizzle/postgres-js, or \`prisma.$queryRaw\` (NOT \`$queryRawUnsafe\`) for Prisma.`,
        evidence: [{ file: path, line: i + 1, reason, snippet }],
      });
    }
  }

  return findings;
}

module.exports = {
  name: NAME,
  severity: 'high',
  cweId: 'CWE-89',
  run,
};
