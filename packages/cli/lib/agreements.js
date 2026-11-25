'use strict';

// Adding an accepted agreement to takeoff.yaml, and the agent files that go
// with it, as text: the server commits the result through GitHub, so nothing
// here touches the disk. Comments and layout elsewhere in the file are kept.

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

  const doc = YAML.parseDocument(String(text));
  const list = doc.get('agreements', true);
  if (YAML.isSeq(list)) {
    list.add(doc.createNode(entry));
  } else {
    doc.set('agreements', doc.createNode([entry]));
  }
  const out = doc.toString({ lineWidth: 0 });

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
