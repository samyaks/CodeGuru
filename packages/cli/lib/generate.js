'use strict';

const { MARKER_START, MARKER_END } = require('./schema');

const oneLine = (s) => String(s).replace(/\s*\n\s*/g, ' ').trim();
const ruleText = (r) => oneLine(typeof r === 'string' ? r : r.text);

/** The text between (and including) the markers, for a v2 `data` object. Deterministic. */
function renderBlock(data) {
  const lines = [MARKER_START];
  lines.push('## Takeoff: what this product should do', '');
  lines.push('_Generated from `takeoff.yaml` by `takeoff sync`. Edit that file, not this block._', '');

  const product = data.product || {};
  lines.push(product.summary ? `**${oneLine(product.name)}**: ${oneLine(product.summary)}` : `**${oneLine(product.name)}**`, '');
  lines.push(
    'Before you change code, find the area it falls in below. If your change would break a rule or a "never",',
    'or does something the area does not cover, say so plainly in your summary instead of going ahead quietly.',
    'Takeoff checks every pull request against this.',
    '',
  );

  const areaName = new Map();
  for (const area of data.areas || []) {
    areaName.set(area.id, area.name);
    lines.push(`### ${oneLine(area.name)} (\`${area.id}\`)`, '');
    lines.push(`- Covers: ${(area.paths || []).map((p) => `\`${p}\``).join(', ') || '(no paths yet)'}`);
    if (area.creators && area.creators.length) lines.push(`- Creators: ${area.creators.join(', ')}`);
    if (area.rules && area.rules.length) {
      lines.push('- Rules:');
      for (const r of area.rules) lines.push(`  - ${ruleText(r)}`);
    }
    if (area.never && area.never.length) {
      lines.push('- Never:');
      for (const r of area.never) lines.push(`  - ${ruleText(r)}`);
    }
    lines.push('');
  }

  if (data.agreements && data.agreements.length) {
    lines.push('### Agreements', '');
    lines.push('Decisions the team has agreed on. Treat them as rules.', '');
    for (const a of data.agreements) {
      const bits = [a.area ? (areaName.get(a.area) || a.area) : null, `agreed ${a.agreed_on} by ${(a.agreed_by || []).join(', ')}`].filter(Boolean);
      lines.push(`- ${oneLine(a.text)} [${bits.join(' · ')}]`);
    }
    lines.push('');
  }

  while (lines[lines.length - 1] === '') lines.pop();
  lines.push(MARKER_END);
  return lines.join('\n');
}

/**
 * Put `block` into `existing` (null when the file does not exist) without
 * touching anything outside the markers.
 *
 * @returns {{ text: string, error?: string }}
 */
function applyBlock(existing, block, { prefix = '' } = {}) {
  if (existing === null) return { text: `${prefix}${block}\n` };

  const crlf = existing.includes('\r\n');
  const b = crlf ? block.replace(/\n/g, '\r\n') : block;
  const eol = crlf ? '\r\n' : '\n';

  const count = (needle) => existing.split(needle).length - 1;
  const starts = count(MARKER_START);
  const ends = count(MARKER_END);

  if (starts === 0 && ends === 0) {
    if (existing.trim() === '') return { text: `${prefix}${b}${eol}` };
    const sep = existing.endsWith('\n') ? eol : `${eol}${eol}`;
    return { text: `${existing}${sep}${b}${eol}` };
  }
  const s = existing.indexOf(MARKER_START);
  const e = existing.indexOf(MARKER_END);
  if (starts !== 1 || ends !== 1 || e < s) {
    return {
      text: existing,
      error: `Found ${starts} "${MARKER_START}" and ${ends} "${MARKER_END}" markers, or they are out of order. `
        + 'There must be exactly one start marker followed by one end marker. Fix or remove them, then run sync again.',
    };
  }
  return { text: existing.slice(0, s) + b + existing.slice(e + MARKER_END.length) };
}

const MDC_PREFIX = '---\ndescription: What this product should do, from takeoff.yaml\nalwaysApply: true\n---\n\n';

const TARGETS = [
  { path: 'CLAUDE.md', prefix: '' },
  { path: 'AGENTS.md', prefix: '' },
  { path: '.cursor/rules/takeoff.mdc', prefix: MDC_PREFIX },
];

module.exports = { renderBlock, applyBlock, TARGETS };
