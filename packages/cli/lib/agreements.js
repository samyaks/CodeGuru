'use strict';

// Adding an accepted agreement to takeoff.yaml, and the agent files that go
// with it, as text: the server commits the result through GitHub, so nothing
// here touches the disk. Comments and layout elsewhere in the file are kept.

const { isDeepStrictEqual } = require('util');
const YAML = require('yaml');
const { validateText } = require('./validate');
const { renderBlock, applyBlock, TARGETS } = require('./generate');
const { AGREEMENT_ID_RE } = require('./schema');

class AgreementError extends Error {
  constructor(message, code, issues = []) {
    super(message);
    this.name = 'AgreementError';
    this.code = code;
    this.issues = issues;
  }
}

/**
 * A stable agreement id: agr_<yyyy>_<mm>_<dd>_<words>_<suffix>.
 * @param {string} date YYYY-MM-DD
 * @param {string} text
 * @param {string} suffix a few random [a-z0-9] characters
 */
function agreementId(date, text, suffix) {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 4)
    .join('_')
    .slice(0, 40)
    .replace(/_+$/, '');
  const id = ['agr', date.replace(/-/g, '_'), words, String(suffix).toLowerCase().replace(/[^a-z0-9]/g, '')]
    .filter(Boolean)
    .join('_');
  if (!AGREEMENT_ID_RE.test(id)) throw new AgreementError(`bad agreement id ${id}`, 'bad_id');
  return id;
}

/** `entry` as a block list item, every line indented by `indent`. */
function renderItem(entry, indent, eol) {
  const body = YAML.stringify([entry], { lineWidth: 0, indentSeq: true }).replace(/\n+$/, '');
  return body.split('\n').map((l) => indent + l).join(eol);
}

/**
 * Insert the entry by editing the text around the `agreements` list only, so
 * every other byte of the file stays as it was. Returns null when the file's
 * shape isn't one this handles (the caller falls back to re-serializing).
 */
function appendAsText(text, entry) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const doc = YAML.parseDocument(text);
  if (doc.errors.length || !YAML.isMap(doc.contents)) return null;
  const pair = doc.contents.items.find((p) => YAML.isScalar(p.key) && p.key.value === 'agreements');
  let out;
  if (!pair) {
    const sep = text.endsWith('\n') ? '' : eol;
    out = `${text}${sep}agreements:${eol}${renderItem(entry, '', eol)}${eol}`;
  } else {
    const list = pair.value;
    if (!YAML.isSeq(list) || !list.range) return null;
    if (list.flow) {
      if (list.items.length) return null;
      // `agreements: []` becomes a block list; a comment on that line stays there.
      const [start, end] = list.range;
      const keyLineStart = text.lastIndexOf('\n', start) + 1;
      const keyIndent = /^[ \t]*/.exec(text.slice(keyLineStart))[0];
      const nl = text.indexOf('\n', end);
      const lineRest = (nl === -1 ? text.slice(end) : text.slice(end, nl)).replace(/\r$/, ''); // e.g. ` # none yet`
      const after = nl === -1 ? eol : text.slice(nl).replace(/^\r?\n/, eol);
      out = `${text.slice(0, start).replace(/[ \t]+$/, '')}${lineRest}${eol}${renderItem(entry, keyIndent, eol)}${after}`;
    } else {
      const first = list.items[0];
      const firstStart = first?.range?.[0];
      if (typeof firstStart !== 'number') return null;
      const lineStart = text.lastIndexOf('\n', firstStart) + 1;
      const dash = /^([ \t]*)- /.exec(text.slice(lineStart, firstStart + 1));
      if (!dash) return null;
      const last = list.items[list.items.length - 1];
      const end = last?.range?.[1];
      if (typeof end !== 'number') return null;
      const head = text.slice(0, end);
      const ws = /\s*$/.exec(head);
      out = `${head.slice(0, ws.index)}${eol}${renderItem(entry, dash[1], eol)}${ws[0]}${text.slice(end)}`;
    }
  }
  // Only trust the edit if it means exactly "the old file plus this entry".
  const parsed = YAML.parse(out);
  const want = YAML.parse(text) || {};
  want.agreements = [...(Array.isArray(want.agreements) ? want.agreements : []), entry];
  return isDeepStrictEqual(parsed, want) ? out : null;
}

/** Fallback: re-serialize the document (comments kept, layout may change). */
function appendByDocument(text, entry) {
  const doc = YAML.parseDocument(text);
  const list = doc.get('agreements', true);
  const node = doc.createNode(entry);
  if (YAML.isSeq(list)) {
    if (list.flow && list.items.length === 0) list.flow = false;
    list.add(node);
  } else {
    doc.set('agreements', doc.createNode([entry]));
  }
  return doc.toString({ lineWidth: 0 });
}

/**
 * Append `agreement` to the `agreements` list of a v2 takeoff.yaml.
 * Already present (same id): returns the text unchanged with `alreadyThere`.
 *
 * @param {string} text current takeoff.yaml
 * @param {{ id: string, text: string, area?: string, agreed_by: string[], agreed_on: string, source?: string }} agreement
 * @returns {{ text: string, data: object, alreadyThere: boolean }}
 * @throws {AgreementError} codes: invalid_yaml, needs_migrate, invalid_agreement
 */
function addAgreement(text, agreement) {
  const before = validateText(text);
  const errors = before.issues.filter((i) => i.severity === 'error');
  if (errors.length) {
    throw new AgreementError(`takeoff.yaml has ${errors.length} error(s), so Takeoff can't add to it. Fix them first.`, 'invalid_yaml', errors);
  }
  if (before.version !== 2) {
    throw new AgreementError('takeoff.yaml is still v1. Run `takeoff migrate` and commit it, then try again.', 'needs_migrate');
  }
  const existing = Array.isArray(before.data.agreements) ? before.data.agreements : [];
  if (existing.some((a) => a && a.id === agreement.id)) {
    return { text, data: before.data, alreadyThere: true };
  }

  const entry = { id: agreement.id };
  if (agreement.area) entry.area = agreement.area;
  entry.text = String(agreement.text).trim();
  entry.agreed_by = [...new Set(agreement.agreed_by)];
  entry.agreed_on = agreement.agreed_on;
  if (agreement.source) entry.source = agreement.source;

  const out = appendAsText(String(text), entry) || appendByDocument(String(text), entry);
  const after = validateText(out);
  const newErrors = after.issues.filter((i) => i.severity === 'error');
  if (newErrors.length) {
    throw new AgreementError(`The agreement doesn't fit takeoff.yaml: ${newErrors[0].message}`, 'invalid_agreement', newErrors);
  }
  return { text: out, data: after.data, alreadyThere: false };
}

/**
 * The agent instruction files for `data`, given their current contents
 * (null for a file that doesn't exist yet).
 * @param {object} data v2 takeoff.yaml data
 * @param {Record<string, string|null>} current by path
 * @returns {Array<{ path: string, text: string, changed: boolean }>}
 * @throws {AgreementError} code broken_markers
 */
function renderAgentFiles(data, current = {}) {
  const block = renderBlock(data);
  return TARGETS.map((t) => {
    const existing = current[t.path] ?? null;
    const { text, error } = applyBlock(existing, block, { prefix: t.prefix });
    if (error) throw new AgreementError(`${t.path}: ${error}`, 'broken_markers');
    return { path: t.path, text, changed: text !== existing };
  });
}

module.exports = { addAgreement, renderAgentFiles, agreementId, AgreementError, AGENT_FILE_PATHS: TARGETS.map((t) => t.path) };
