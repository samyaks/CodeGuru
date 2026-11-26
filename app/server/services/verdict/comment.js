'use strict';

// The one Takeoff comment per PR, and the matching check run output. The
// hidden marker at the top is how the next run finds the comment to edit.

const MARKER = '<!-- takeoff:pr-verdict -->';
const CHECK_NAME = 'Takeoff';
const RETRY_ACTION = { label: 'Retry', description: 'Run the Takeoff check again', identifier: 'takeoff_retry' };

const LABELS = {
  matches: { emoji: '✅', label: 'Matches intent' },
  drifts: { emoji: '⚠️', label: 'Drifts from intent' },
  needs_decision: { emoji: '❓', label: 'Needs a decision' },
  failed: { emoji: '⏸️', label: "Takeoff couldn't check this PR" },
};

// GitHub's limits are 65,536 characters for a comment and 65,535 for a check
// run summary; stay well under both.
const MAX_BODY = 60000;

/** Cut a rendered body to `max` characters, ending on a whole line. */
function capBody(text, max = MAX_BODY) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(0, cut.lastIndexOf('\n')))}\n\n_The rest was cut to fit GitHub's limit._`;
}

const ZWSP = '\u200b';

/**
 * Text from the model, the PR or takeoff.yaml goes into Markdown we post as
 * the App. It is shown as plain text: no HTML or entities (so no second
 * marker and no encoded @mentions), no Markdown (no fake headings, links or
 * images), no autolinked URLs, no @mentions, one line.
 */
function clean(text, { max = 600 } = {}) {
  let t = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/[\\`*_{}[\]()#+!|>~-]/g, (c) => `\\${c}`)
    .replace(/:\/\//g, `:/${ZWSP}/`)
    .replace(/\bwww\./gi, (m) => `${m.slice(0, 3)}${ZWSP}.`)
    .replace(/</g, '&lt;')
    .replace(/@(?=[A-Za-z0-9_-])/g, `@${ZWSP}`);
  if (t.length > max) {
    t = t.slice(0, max - 1).replace(/\\$/, '');
    t = `${t}…`;
  }
  return t;
}

/** A file name or sha as inline code, on one line. */
const code = (s) => {
  let t = String(s).replace(/[\r\n]+/g, ' ').replace(/`/g, "'");
  if (t.length > 200) t = `…${t.slice(-199)}`;
  return `\`${t}\``;
};

/** Only a plain https URL is shown, as an autolink. */
function safeUrl(url) {
  return typeof url === 'string' && /^https:\/\/[^\s<>"'`]+$/.test(url) ? url : null;
}

function footer({ reviewUrl, previewUrl, headSha, notes = [], checked = true }) {
  const lines = [];
  for (const n of notes) lines.push('', `_${clean(n, { max: 400 })}_`);
  const preview = safeUrl(previewUrl);
  if (preview) lines.push('', `Preview: <${preview}>`);
  if (reviewUrl) lines.push('', `[Review in Takeoff](${reviewUrl})`);
  const sha = code(String(headSha || '').slice(0, 7));
  lines.push('', `<sub>${checked ? `Checked ${sha} against takeoff.yaml.` : `Commit ${sha}.`} This check never blocks merging.</sub>`);
  return lines;
}

const areaLabel = (id, names) => (id === 'product' ? 'Product-wide' : names?.[id] || id);

/**
 * @param {{ verdict: string, summary: string, conflicts: object[], suggested_agreement: string|null }} result
 * @param {{ areaNames: Record<string,string>, reviewUrl?: string|null, previewUrl?: string|null, headSha: string, notes?: string[] }} ctx
 */
function renderComment(result, ctx) {
  const { emoji, label } = LABELS[result.verdict];
  const lines = [MARKER, `### ${emoji} Takeoff: ${label}`, '', clean(result.summary)];
  if (result.conflicts.length) {
    lines.push('', '**Conflicts**');
    for (const c of result.conflicts) {
      lines.push('', `- **${clean(areaLabel(c.area, ctx.areaNames), { max: 80 })}**: ${clean(c.explanation)}`);
      lines.push(`  > ${clean(c.rule_or_agreement)}`);
      if (c.files.length) lines.push(`  Files: ${c.files.slice(0, 10).map(code).join(', ')}${c.files.length > 10 ? `, and ${c.files.length - 10} more` : ''}`);
    }
    if (result.more_conflicts) lines.push('', `_And ${result.more_conflicts} more conflict${result.more_conflicts === 1 ? '' : 's'}._`);
  }
  if (result.suggested_agreement) {
    lines.push('', '**Possible new agreement**', '', `> ${clean(result.suggested_agreement)}`);
  }
  lines.push(...footer({
    reviewUrl: result.verdict === 'matches' ? null : ctx.reviewUrl,
    previewUrl: ctx.previewUrl,
    headSha: ctx.headSha,
    notes: ctx.notes,
  }));
  return capBody(lines.join('\n'));
}

/** Shown when the check could not run. Never a verdict. */
function renderFailureComment({ reason, headSha, previewUrl = null }) {
  const { emoji, label } = LABELS.failed;
  return [
    MARKER,
    `### ${emoji} ${label}`,
    '',
    clean(reason || 'Something went wrong while checking this PR against takeoff.yaml.'),
    '',
    'To try again, use **Re-run** (or **Retry**) on the Takeoff check, or push a new commit.',
    ...footer({ previewUrl, headSha, checked: false }),
  ].join('\n');
}

function checkRunOutput(result, { areaNames = {}, notes = [] } = {}) {
  const { emoji, label } = LABELS[result.verdict];
  const conflictLines = result.conflicts.map((c) => `- ${clean(areaLabel(c.area, areaNames), { max: 80 })}: ${clean(c.explanation)}`);
  return {
    title: `${emoji} ${label}`,
    summary: capBody([clean(result.summary), ...(conflictLines.length ? ['', ...conflictLines] : []), ...notes.map((n) => `\n_${clean(n, { max: 400 })}_`)].join('\n')),
  };
}

function failureCheckRunOutput(reason) {
  return { title: `${LABELS.failed.emoji} ${LABELS.failed.label}`, summary: clean(reason || 'The check could not run.') };
}

module.exports = {
  MARKER, CHECK_NAME, RETRY_ACTION, LABELS,
  renderComment, renderFailureComment, checkRunOutput, failureCheckRunOutput, clean, safeUrl, capBody, MAX_BODY,
};
