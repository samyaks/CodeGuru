'use strict';

/**
 * Ask Takeoff's read-only tools (Milestone 8, PR 3).
 *
 * createAskTools({ project }) gives one question its toolset: the tool
 * definitions for the Messages API, and call(name, input), which runs a
 * tool and returns JSON-ready data. None of the tools can write anything,
 * and none calls a model. Every source a tool returns gets a stable id,
 * kept in `sources` so the answer's citations can be checked (PR 4).
 *
 * The project must already be one the asker may read (checked by the
 * route), with an owner; ownerless projects are refused here as well.
 */

const { AskToolError } = require('./safety');
const plan = require('./plan');
const code = require('./code');
const proj = require('./project');

const str = (description) => ({ type: 'string', description });
const int = (description) => ({ type: 'integer', description });

const TOOLS = [
  {
    name: 'get_plan',
    run: plan.getPlan,
    description: 'The product plan from takeoff.yaml on the default branch: product summary, areas with their paths, rules and never rules, and accepted agreements. Use this first for any question about what the product should do.',
    input_schema: { type: 'object', properties: { area: str('Optional area id or name, to get just that area.') } },
  },
  {
    name: 'rules_for_path',
    run: plan.rulesForPath,
    description: 'Which plan areas cover a file path, with their rules, never rules and agreements. Same matcher as Takeoff\'s PR check.',
    input_schema: { type: 'object', properties: { path: str('Repo-relative file path, like src/billing/charge.js.') }, required: ['path'] },
  },
  {
    name: 'get_agreements',
    run: proj.getAgreements,
    description: 'Agreements the team proposed or decided, with who agreed, who said "Not yet" and why, and whether it is in the plan.',
    input_schema: {
      type: 'object',
      properties: {
        area: str('Optional area id.'),
        status: { type: 'string', enum: ['proposed', 'accepted', 'declined', 'withdrawn'] },
        text: str('Optional words the agreement contains.'),
      },
    },
  },
  {
    name: 'get_decisions',
    run: proj.getDecisions,
    description: 'Decisions people made on pull requests Takeoff checked: accepted (and the plan changes that came with it) or sent back, with notes.',
    input_schema: { type: 'object', properties: { pr: int('Optional pull request number.'), since: str('Optional date, like 2026-11-01.') } },
  },
  {
    name: 'get_pr_checks',
    run: proj.getPrChecks,
    description: 'Takeoff\'s checks of pull requests against the plan: verdict (matches, drifts, needs_decision), summary and the rules each one conflicts with. Latest check per PR.',
    input_schema: {
      type: 'object',
      properties: {
        pr: int('Optional pull request number.'),
        verdict: { type: 'string', enum: ['matches', 'drifts', 'needs_decision'] },
        since: str('Optional date, like 2026-11-01.'),
      },
    },
  },
  {
    name: 'get_people',
    run: proj.getPeople,
    description: 'Members of this project with their labels, and each area\'s Creators.',
    input_schema: { type: 'object', properties: { area: str('Optional area id or name.') } },
  },
  {
    name: 'get_capabilities',
    run: proj.getCapabilities,
    description: 'Confirmed statements of what the product does, and whether Takeoff last found each one holds in the code.',
    input_schema: { type: 'object', properties: { query: str('Optional words to filter by.') } },
  },
  {
    name: 'search_code',
    run: code.searchCode,
    description: 'Full-text search of the stored code. Returns up to 15 files with line ranges and short snippets. Words match as prefixes; all words must match when any file has them all.',
    input_schema: {
      type: 'object',
      properties: { query: str('Words to search for.'), path_glob: str('Optional glob, like src/**/*.ts.') },
      required: ['query'],
    },
  },
  {
    name: 'find_symbol',
    run: code.findSymbol,
    description: 'Where a function, class, route, model or other named thing is defined in the stored code.',
    input_schema: { type: 'object', properties: { name: str('The name to look for.') }, required: ['name'] },
  },
  {
    name: 'list_files',
    run: code.listFiles,
    description: 'Paths in the stored code that match a glob, up to 200.',
    input_schema: { type: 'object', properties: { path_glob: str('Glob, like src/billing/** or **/*.sql.') } },
  },
  {
    name: 'read_file',
    run: code.readFile,
    description: 'Text of one stored file, with line numbers: up to 400 lines or 24 KB per call, and 6 files per question. Secrets are hidden; key and credential files are never shown.',
    input_schema: {
      type: 'object',
      properties: { path: str('Repo-relative path.'), start: int('First line, from 1.'), end: int('Last line.') },
      required: ['path'],
    },
  },
  {
    name: 'find_usages',
    run: code.findUsages,
    description: 'Files that import a given file (relative and @/ or ~/ imports in JavaScript, TypeScript and Python).',
    input_schema: { type: 'object', properties: { path: str('Repo-relative path.') }, required: ['path'] },
  },
  {
    name: 'recent_changes',
    run: proj.recentChanges,
    description: 'Commits on the default branch since a date (default 14 days, at most 90), with author and the PR check of the linked PR.',
    input_schema: { type: 'object', properties: { since: str('Optional date, like 2026-11-01.') } },
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
const DEFINITIONS = TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));

function defaultDeps() {
  const db = require('../../../lib/db');
  return {
    codeIndex: db.codeIndex,
    agreements: db.agreements,
    agreementVotes: db.agreementVotes,
    driftDecisions: db.driftDecisions,
    prChecks: db.prChecks,
    projectMembers: db.projectMembers,
    intentStatements: db.intentStatements,
    clientFor: (project) => require('../../github-access').clientForProject(project),
    ensureBuilt: (project) => require('../../code-index').getCodeIndex().ensureBuilt(project),
  };
}

function createAskTools({ project, deps = null, now = () => Date.now() } = {}) {
  if (!project || !project.id) throw new AskToolError('A project is required', 'not_found');
  if (!project.user_id) throw new AskToolError('Ask isn’t available on a project with no owner.', 'forbidden');
  const sources = new Map();
  const ctx = {
    project,
    deps: deps || defaultDeps(),
    cache: {},
    counters: { fileReads: 0 },
    now,
    addSource(id, meta) { if (!sources.has(id)) sources.set(id, meta); },
  };

  /**
   * Run one tool. Returns { ok: true, result } or { ok: false, error } for
   * bad input, so the model can correct itself; other errors are logged and
   * reported as a failed tool, never with internal detail.
   */
  async function call(name, input) {
    const tool = BY_NAME.get(name);
    if (!tool) return { ok: false, error: `There is no tool called ${String(name).slice(0, 60)}.` };
    const args = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    try {
      return { ok: true, result: await tool.run(ctx, args) };
    } catch (err) {
      if (err instanceof AskToolError) return { ok: false, error: err.message };
      console.warn(`[ask] tool ${name} failed for ${project.id}:`, err && err.message);
      return { ok: false, error: 'That lookup failed. Try a different one, or answer from what you have.' };
    }
  }

  return { definitions: DEFINITIONS, call, sources, counters: ctx.counters };
}

module.exports = { createAskTools, DEFINITIONS, TOOL_NAMES: TOOLS.map((t) => t.name), AskToolError };
