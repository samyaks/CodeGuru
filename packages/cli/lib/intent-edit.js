'use strict';

// Small, exact edits to takeoff.yaml: remove or reword one rule, never-rule or
// agreement, or add a rule. Used when a person accepts drift on a PR ("the
// code is right, update the intent"). Edits go through the YAML document, so
// comments and the rest of the file stay as they were, and the result is
// validated before it is returned: an edit never produces a file Takeoff
// itself would reject.

const YAML = require('yaml');
const { validateText } = require('./validate');

class IntentEditError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'IntentEditError';
    this.code = code;
  }
}

const KINDS = new Set(['rule', 'never', 'agreement']);
const OPS = new Set(['remove', 'reword', 'add']);
const MAX_EDITS = 20;
const MAX_TEXT = 1000;
const listKey = (kind) => (kind === 'never' ? 'never' : 'rules');
const norm = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

/** The text of a rule or agreement item node: a plain string, or a map with `text`. */
function itemText(node) {
  if (YAML.isScalar(node)) return typeof node.value === 'string' ? norm(node.value) : null;
  if (YAML.isMap(node)) {
    const t = node.get('text');
    return typeof t === 'string' ? norm(t) : null;
  }
  return null;
}

function findArea(doc, id) {
  const areas = doc.get('areas', true);
  if (!YAML.isSeq(areas)) return null;
  return areas.items.find((a) => YAML.isMap(a) && a.get('id') === id) || null;
}

/** [seq, index] of the item `edit.target` names, or throws. */
function locate(doc, target) {
  const want = norm(target.text);
  if (target.kind === 'agreement') {
    const list = doc.get('agreements', true);
    const items = YAML.isSeq(list) ? list.items : [];
    let hits = items.map((n, i) => [n, i]).filter(([n]) => itemText(n) === want);
    if (hits.length > 1) {
      const area = target.area || null;
      hits = hits.filter(([n]) => (YAML.isMap(n) && typeof n.get('area') === 'string' ? n.get('area') : null) === area);
    }
    if (hits.length !== 1) {
      throw new IntentEditError(`takeoff.yaml no longer has the agreement "${short(want)}"${hits.length ? ' exactly once' : ''}.`, 'not_found');
    }
    return [list, hits[0][1]];
  }
  const area = findArea(doc, target.area);
  if (!area) throw new IntentEditError(`takeoff.yaml has no area "${short(String(target.area))}".`, 'area_not_found');
  const list = area.get(listKey(target.kind), true);
  const items = YAML.isSeq(list) ? list.items : [];
  const hits = items.map((n, i) => [n, i]).filter(([n]) => itemText(n) === want);
  if (hits.length !== 1) {
    const label = target.kind === 'never' ? 'never-rule' : 'rule';
    throw new IntentEditError(`The area "${short(String(target.area))}" no longer has the ${label} "${short(want)}"${hits.length ? ' exactly once' : ''}.`, 'not_found');
  }
  return [list, hits[0][1]];
}

const short = (t) => (t.length > 120 ? `${t.slice(0, 119)}…` : t);

function checkText(t, what) {
  const s = norm(t);
  if (!s) throw new IntentEditError(`${what} can't be empty.`, 'bad_edit');
  if (s.length > MAX_TEXT) throw new IntentEditError(`${what} is too long (at most ${MAX_TEXT} characters).`, 'bad_edit');
  return s;
}

/** Throws unless `edits` is a list of well-formed edits. */
function checkEdits(edits) {
  if (!Array.isArray(edits) || !edits.length) throw new IntentEditError('Choose at least one change to takeoff.yaml.', 'bad_edit');
  if (edits.length > MAX_EDITS) throw new IntentEditError(`At most ${MAX_EDITS} changes at once.`, 'bad_edit');
  return edits.map((e) => {
    if (!e || typeof e !== 'object' || !OPS.has(e.op)) throw new IntentEditError('Each change must remove, reword or add.', 'bad_edit');
    if (e.op === 'add') {
      if (e.kind !== 'rule' && e.kind !== 'never') throw new IntentEditError('Only a rule or never-rule can be added here.', 'bad_edit');
      if (typeof e.area !== 'string' || !e.area) throw new IntentEditError('A new rule needs an area.', 'bad_edit');
      return { op: 'add', kind: e.kind, area: e.area, text: checkText(e.text, 'The new rule') };
    }
    const t = e.target;
    if (!t || typeof t !== 'object' || !KINDS.has(t.kind)) throw new IntentEditError('Each change must name the rule it changes.', 'bad_edit');
    if (t.kind !== 'agreement' && (typeof t.area !== 'string' || !t.area)) throw new IntentEditError('A rule is named with its area.', 'bad_edit');
    const target = { kind: t.kind, area: typeof t.area === 'string' && t.area ? t.area : null, text: checkText(t.text, 'The rule to change') };
    if (e.op === 'remove') return { op: 'remove', target };
    // An agreement records who agreed to its exact words, so it is never
    // reworded: remove it, and record a new agreement instead.
    if (target.kind === 'agreement') throw new IntentEditError('An agreement can\'t be reworded, since people agreed to its exact words. Remove it and record a new one.', 'bad_edit');
    const to = checkText(e.to, 'The new wording');
    if (to === target.text) throw new IntentEditError(`The new wording of "${short(to)}" is the same as the old.`, 'bad_edit');
    return { op: 'reword', target, to };
  });
}

/**
 * Apply `edits` to a v2 takeoff.yaml.
 *
 * Edits:
 *   { op: 'remove', target: { kind: 'rule'|'never'|'agreement', area, text } }
 *   { op: 'reword', target: {...}, to: 'new text' }
 *   { op: 'add', kind: 'rule'|'never', area, text }
 *
 * A target is found by its exact text (whitespace aside); it must be there
 * exactly once, so an edit never lands on the wrong rule.
 *
 * @returns {{ text: string, data: object, summary: string[] }}
 * @throws {IntentEditError} codes: invalid_yaml, needs_migrate, bad_edit, not_found, area_not_found, invalid_result
 */
function applyIntentEdits(text, edits) {
  const before = validateText(String(text));
  const errors = before.issues.filter((i) => i.severity === 'error');
  if (errors.length) throw new IntentEditError(`takeoff.yaml has ${errors.length} error(s), so Takeoff can't edit it. Fix them first.`, 'invalid_yaml');
  if (before.version !== 2) throw new IntentEditError('takeoff.yaml is still v1. Run `takeoff migrate` and commit it, then try again.', 'needs_migrate');
  const list = checkEdits(edits);

  const doc = YAML.parseDocument(String(text));
  const summary = [];
  // Find every target first, against the file as it is, so one edit can't
  // shift what a later one points at.
  const located = list.map((e) => (e.op === 'add' ? null : locate(doc, e.target)));
  const seen = new Map(); // seq -> indexes already edited
  located.forEach((loc, i) => {
    if (!loc) return;
    const idxs = seen.get(loc[0]) || new Set();
    if (idxs.has(loc[1])) throw new IntentEditError(`"${short(list[i].target.text)}" is changed twice.`, 'bad_edit');
    idxs.add(loc[1]);
    seen.set(loc[0], idxs);
  });

  // Rewords first (in place), then removals from the end, then additions.
  list.forEach((e, i) => {
    if (e.op !== 'reword') return;
    const [seq, idx] = located[i];
    if (seq.items.some((n, j) => j !== idx && itemText(n) === e.to)) throw new IntentEditError(`"${short(e.to)}" is already a rule there.`, 'bad_edit');
    const node = seq.items[idx];
    // Change the value in place, so comments and quoting on it stay.
    const scalar = YAML.isMap(node) ? node.get('text', true) : node;
    if (YAML.isScalar(scalar)) scalar.value = e.to;
    else node.set('text', e.to);
    summary.push(`Reword "${short(e.target.text)}" to "${short(e.to)}"`);
  });
  // Highest index first, so removing one item doesn't move the next.
  const removals = list.map((e, i) => [e, located[i]]).filter(([e]) => e.op === 'remove')
    .sort((a, b) => b[1][1] - a[1][1]);
  for (const [e, [seq, idx]] of removals) {
    seq.items.splice(idx, 1);
    summary.push(`Remove ${e.target.kind === 'agreement' ? 'the agreement' : e.target.kind === 'never' ? 'the never-rule' : 'the rule'} "${short(e.target.text)}"`);
  }
  for (const e of list.filter((x) => x.op === 'add')) {
    const area = findArea(doc, e.area);
    if (!area) throw new IntentEditError(`takeoff.yaml has no area "${short(e.area)}".`, 'area_not_found');
    const key = listKey(e.kind);
    const seq = area.get(key, true);
    if (YAML.isSeq(seq)) {
      if (seq.items.some((n) => itemText(n) === e.text)) throw new IntentEditError(`"${short(e.text)}" is already a rule there.`, 'bad_edit');
      if (seq.flow && seq.items.length === 0) seq.flow = false;
      seq.add(doc.createNode(e.text));
    } else {
      area.set(key, doc.createNode([e.text]));
    }
    summary.push(`Add the ${e.kind === 'never' ? 'never-rule' : 'rule'} "${short(e.text)}"`);
  }
  // An emptied block list prints as "[]" so the file stays valid.
  YAML.visit(doc, { Seq(_, node) { if (!node.items.length) node.flow = true; } });

  let out;
  try {
    out = doc.toString({ lineWidth: 0, flowCollectionPadding: false });
  } catch (err) {
    throw new IntentEditError(`That change would leave takeoff.yaml unreadable: ${err.message}`, 'invalid_result');
  }
  const after = validateText(out);
  const newErrors = after.issues.filter((i) => i.severity === 'error');
  if (newErrors.length) throw new IntentEditError(`That change would leave takeoff.yaml invalid: ${newErrors[0].message}`, 'invalid_result');
  return { text: out, data: after.data, summary };
}

module.exports = { applyIntentEdits, IntentEditError, MAX_INTENT_EDITS: MAX_EDITS };
