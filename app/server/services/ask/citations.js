'use strict';

/**
 * The citation check for Ask answers (Milestone 8, PR 4). Enforced in code,
 * like the PR verdict's quote check, so it holds whatever the model writes:
 *
 * - every source id a paragraph cites must be one a tool returned in this
 *   question; a paragraph that cites none, or cites one that wasn't
 *   returned, is removed;
 * - a quote ("…" of 8 characters or more) must appear word for word in a
 *   source the paragraph cites that has text (a rule, an agreement, a code
 *   slice the model was shown); otherwise the paragraph is removed;
 * - links, images and HTML are taken out of the text, so an answer can't
 *   carry data off to another site when it's shown.
 */

const MAX_PARAGRAPHS = 12;
const MAX_PARAGRAPH_CHARS = 2000;
const MAX_IDS_PER_PARAGRAPH = 8;
const MIN_QUOTE = 8;

const sha12 = (sha) => String(sha || '').slice(0, 12);
const norm = (s) => String(s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();

/** Plain text: no images, links (their words stay), HTML tags or raw URLs. */
function cleanParagraph(text) {
  return String(text == null ? '' : text)
    .replace(/\u0000/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]{0,500}>/g, '')
    .replace(/\b(?:https?|ftp|data|javascript):\/?\/?[^\s)]+/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
    .slice(0, MAX_PARAGRAPH_CHARS);
}

/** The words a quote is checked against. Code slices drop the line numbers they were shown with. */
function sourceText(meta) {
  const t = meta && typeof meta.text === 'string' ? meta.text : '';
  if (!t) return '';
  return meta.kind === 'code' ? t.replace(/^\d+\t/gm, '') : t;
}

/** Quoted spans in a paragraph, straight or curly double quotes. */
function quotesIn(text) {
  const out = [];
  const re = /"([^"\n]{1,600})"|“([^”\n]{1,600})”/g;
  let m;
  while ((m = re.exec(text))) {
    const q = (m[1] || m[2] || '').trim();
    if (q.length >= MIN_QUOTE) out.push(q);
  }
  return out;
}

/** What a reader sees for a source. */
function describe(id, meta, project) {
  const base = { id, kind: meta.kind };
  switch (meta.kind) {
    case 'plan':
      return { ...base, label: `Plan (takeoff.yaml @ ${sha12(meta.sha)})`, area: meta.area || null, text: meta.text || null, sha: meta.sha || null };
    case 'agreement':
      return { ...base, label: 'Agreement', text: meta.text || null, status: meta.status || null };
    case 'decision':
      return { ...base, label: `Decision on PR #${meta.pr}`, pr: meta.pr };
    case 'pr_check':
      return { ...base, label: `PR check on #${meta.pr}`, pr: meta.pr, sha: meta.sha || null };
    case 'capability':
      return { ...base, label: 'Confirmed capability', text: meta.text || null };
    case 'commit':
      return { ...base, label: `Commit ${sha12(meta.sha)}`, sha: meta.sha || null };
    case 'code': {
      const lines = meta.start ? `${meta.start}-${meta.end}` : null;
      // A link to the file at that commit on GitHub; the stored text is never served.
      const enc = String(meta.path).split('/').map(encodeURIComponent).join('/');
      const url = project && project.owner && project.repo && /^[0-9a-f]{7,40}$/i.test(String(meta.sha || ''))
        ? `https://github.com/${encodeURIComponent(project.owner)}/${encodeURIComponent(project.repo)}/blob/${meta.sha}/${enc}${meta.start ? `#L${meta.start}-L${meta.end}` : ''}`
        : null;
      return { ...base, label: `Code @ ${sha12(meta.sha)}, not checked against the plan`, path: meta.path, lines, sha: meta.sha || null, url };
    }
    default:
      return { ...base, label: 'Source' };
  }
}

/**
 * @param {object} answer the parsed model answer (ANSWER_SCHEMA)
 * @param {Map<string, object>} sources what the tools returned this question
 * @returns {{ paragraphs, sources, dropped, planSilent, notBuilt, suggestedAgreement, didntGetTo, content }}
 */
function checkAnswer(answer, sources, { project = null } = {}) {
  const raw = Array.isArray(answer && answer.paragraphs) ? answer.paragraphs.slice(0, MAX_PARAGRAPHS) : [];
  const numbered = new Map();
  const kept = [];
  let dropped = Math.max(0, (Array.isArray(answer && answer.paragraphs) ? answer.paragraphs.length : 0) - raw.length);
  for (const p of raw) {
    const text = cleanParagraph(p && p.text);
    const ids = Array.isArray(p && p.source_ids) ? [...new Set(p.source_ids.map(String))].slice(0, MAX_IDS_PER_PARAGRAPH) : [];
    if (!text) continue;
    if (!ids.length || ids.some((id) => !sources.has(id))) { dropped += 1; continue; }
    const texts = ids.map((id) => sourceText(sources.get(id))).filter(Boolean).map(norm);
    const quotes = quotesIn(text);
    if (quotes.some((q) => !texts.some((t) => t.includes(norm(q))))) { dropped += 1; continue; }
    const refs = ids.map((id) => {
      if (!numbered.has(id)) numbered.set(id, numbered.size + 1);
      return numbered.get(id);
    });
    kept.push({ text, source_ids: ids, refs, code_only: ids.every((id) => sources.get(id).kind === 'code') });
  }
  const list = [...numbered.entries()].map(([id, n]) => ({ n, ...describe(id, sources.get(id), project) }));
  const short = (v, max) => (typeof v === 'string' && v.trim() ? cleanParagraph(v).slice(0, max) || null : null);
  const out = {
    paragraphs: kept,
    sources: list,
    dropped,
    planSilent: !!(answer && answer.plan_silent),
    notBuilt: !!(answer && answer.not_built),
    suggestedAgreement: short(answer && answer.suggested_agreement, 500),
    didntGetTo: short(answer && answer.didnt_get_to, 500),
  };
  out.content = render(out);
  return out;
}

const NO_SOURCED_ANSWER = 'Takeoff couldn’t find sources to back an answer to this, so it isn’t showing one. Try asking it a narrower way.';

/** Markdown for the thread and for follow-ups: paragraphs with [n] markers. */
function render({ paragraphs, dropped, didntGetTo }) {
  const parts = paragraphs.map((p) => `${p.text} ${p.refs.map((n) => `[${n}]`).join('')}`);
  if (!parts.length) parts.push(NO_SOURCED_ANSWER);
  if (dropped === 1) parts.push('One part of this answer was left out because its source couldn’t be checked.');
  else if (dropped > 1) parts.push(`${dropped} parts of this answer were left out because their sources couldn’t be checked.`);
  if (didntGetTo) parts.push(`Not checked: ${didntGetTo}`);
  return parts.join('\n\n');
}

module.exports = { checkAnswer, cleanParagraph, quotesIn, describe, render, NO_SOURCED_ANSWER, MAX_PARAGRAPHS };
