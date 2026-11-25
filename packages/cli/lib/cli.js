'use strict';

const fs = require('fs');
const path = require('path');
const { validateText } = require('./validate');
const { migrateData, stringifyV2 } = require('./migrate');
const { sync, TakeoffError, readIfExists } = require('./sync');
const { FILENAME, CURRENT_VERSION } = require('./schema');

const FLAGS = {
  validate: ['--strict'],
  sync: ['--check', '--dry-run'],
  migrate: ['--dry-run'],
};

const HELP = `takeoff: keep what you build matching what you agreed

Usage:
  takeoff validate [file]            Check takeoff.yaml (add --strict to fail on warnings)
  takeoff sync [file] [--check] [--dry-run]
                                     Write CLAUDE.md, AGENTS.md and .cursor/rules/takeoff.mdc
  takeoff migrate [file] [--dry-run] Upgrade a v1 takeoff.yaml to v2

Options:
  --dir <path>   Run in another directory (default: current)
  --file <path>  takeoff.yaml location, relative to --dir (default: takeoff.yaml)
  -h, --help     Show this help
`;

function parseArgs(argv) {
  const opts = { _: [], flags: new Set(), dir: null, file: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dir' || a === '--file') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) throw new UsageError(`${a} needs a value.`);
      opts[a.slice(2)] = value;
      i += 1;
    } else if (a.startsWith('--') || a === '-h') {
      opts.flags.add(a);
    } else {
      opts._.push(a);
    }
  }
  return opts;
}

class UsageError extends Error {}

function formatIssue(file, i) {
  const loc = i.line ? `${file}:${i.line}:${i.col}` : file;
  const where = i.path ? `${i.path}: ` : '';
  return `${loc}  ${i.severity === 'error' ? 'error' : 'warn '}  ${where}${i.message}`;
}

/**
 * @param {string[]} argv arguments after the program name
 * @param {{ cwd?: string, out?: (s: string) => void, err?: (s: string) => void }} io
 * @returns {number} exit code: 0 ok, 1 problems found, 2 usage error
 */
function run(argv, { cwd = process.cwd(), out = (s) => console.log(s), err = (s) => console.error(s) } = {}) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    err(e.message);
    return 2;
  }
  const [command, ...rest] = args._;
  if (!command || args.flags.has('-h') || args.flags.has('--help')) {
    out(HELP);
    return command || args.flags.size ? 0 : 2;
  }

  const allowed = FLAGS[command];
  if (allowed) {
    const unknown = [...args.flags].filter((f) => !allowed.includes(f));
    if (unknown.length) {
      err(`Unknown option ${unknown.join(', ')} for \`${command}\`. It accepts: ${allowed.join(', ')}, --dir, --file.`);
      return 2;
    }
  }

  const dir = path.resolve(cwd, args.dir || '.');
  const yamlRel = args.file || rest[0] || FILENAME;
  const yamlPath = path.resolve(dir, yamlRel);
  const label = path.relative(dir, yamlPath) || yamlRel;

  try {
    switch (command) {
      case 'validate': return validateCommand({ yamlPath, label, strict: args.flags.has('--strict'), out, err });
      case 'sync': return syncCommand({ dir, file: args.file || rest[0] || null, args, out, err });
      case 'migrate': return migrateCommand({ yamlPath, label, dryRun: args.flags.has('--dry-run'), out, err });
      default:
        err(`Unknown command "${command}".\n\n${HELP}`);
        return 2;
    }
  } catch (e) {
    if (e instanceof TakeoffError) {
      err(e.message);
      for (const i of e.issues) if (i.severity === 'error') err(`  ${formatIssue(label, i)}`);
      return 1;
    }
    throw e;
  }
}

function validateCommand({ yamlPath, label, strict, out, err }) {
  const text = readIfExists(yamlPath);
  if (text === null) {
    err(`${label} not found.`);
    return 1;
  }
  const r = validateText(text);
  const errors = r.issues.filter((i) => i.severity === 'error');
  const warnings = r.issues.filter((i) => i.severity === 'warning');
  for (const i of r.issues) (i.severity === 'error' ? err : out)(formatIssue(label, i));
  if (errors.length || (strict && warnings.length)) {
    err(`${errors.length} error(s), ${warnings.length} warning(s).`);
    return 1;
  }
  out(`${label} is valid (v${r.version}${warnings.length ? `, ${warnings.length} warning(s)` : ''}).`);
  return 0;
}

function syncCommand({ dir, file, args, out, err }) {
  const check = args.flags.has('--check');
  const dryRun = args.flags.has('--dry-run');
  const r = sync({ dir, file, check, dryRun });
  for (const n of r.notes) out(`note: ${n}`);
  const planned = { created: 'would create', updated: 'would update', unchanged: 'unchanged' };
  for (const x of r.results) out(`${check || dryRun ? planned[x.action] : x.action}  ${x.path}`);
  if (check && !r.inSync) {
    err('Agent files are out of date. Run `takeoff sync`.');
    return 1;
  }
  return 0;
}

function migrateCommand({ yamlPath, label, dryRun, out, err }) {
  const text = readIfExists(yamlPath);
  if (text === null) {
    err(`${label} not found.`);
    return 1;
  }
  const v = validateText(text);
  const errors = v.issues.filter((i) => i.severity === 'error');
  if (errors.length) {
    err(`${label} has errors; fix them before migrating.`);
    for (const i of errors) err(`  ${formatIssue(label, i)}`);
    return 1;
  }
  if (v.version === CURRENT_VERSION) {
    out(`${label} is already v${CURRENT_VERSION}. Nothing to do.`);
    return 0;
  }
  const { data, notes } = migrateData(v.data);
  const next = stringifyV2(data);

  // Never write a file we would reject ourselves.
  const check = validateText(next);
  if (!check.ok) {
    err(`Could not turn ${label} into a valid v2 file, so nothing was written. These fields need fixing in your file first:`);
    // Positions here point into the generated text, not the user's file, so print paths only.
    for (const i of check.issues) if (i.severity === 'error') err(`  ${i.path ? `${i.path}: ` : ''}${i.message}`);
    return 1;
  }

  if (dryRun) {
    out(next.trimEnd());
  } else {
    fs.writeFileSync(yamlPath, next);
    out(`Upgraded ${label} to v${CURRENT_VERSION}. Comments in the old file were not kept; your previous version is in git.`);
  }
  for (const n of notes) out(`note: ${n}`);
  return 0;
}

module.exports = { run, parseArgs, formatIssue };
