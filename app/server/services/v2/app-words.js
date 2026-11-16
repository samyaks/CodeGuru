'use strict';

// The app's own nouns, taken from its product map: who uses it ("dog owners",
// "walkers") and what it keeps ("bookings"). The launch checks use them so
// "Who sees what" reads as "Each walker only sees their own bookings".
// Nothing here is guessed: with no map, or nothing usable in it, the lists
// are empty and the checks fall back to plain wording.

const INFRA_TABLE = /^(users?|sessions?|accounts?|profiles?|tokens?|identities|identity|migrations?|schema_migrations|.*_migrations|_.*|verifications?|accounts_users|auth_.*|.*_tokens?)$/i;

function words(raw) {
  return String(raw || '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, ' ') // emoji and punctuation
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function pluralize(w) {
  if (/s$/.test(w)) return w;
  if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ies`;
  if (/(x|ch|sh)$/.test(w)) return `${w}es`;
  return `${w}s`;
}

function singularize(w) {
  if (/ies$/.test(w)) return `${w.slice(0, -3)}y`;
  if (/(x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (/ss$/.test(w)) return w;
  if (/s$/.test(w)) return w.slice(0, -1);
  return w;
}

const MAX_WORDS = 3;
const MAX_ITEMS = 2;

function unique(list) {
  return [...new Set(list)];
}

/**
 * @param {{personas?: Array<{name?: string}>, entities?: Array<{type?: string, key?: string, label?: string}>}|null} map
 * @returns {{people: string[], things: string[]}} people are singular ("walker"),
 *   things are plural ("bookings"). Lowercase, at most two of each.
 */
function buildAppWords(map) {
  const personas = Array.isArray(map?.personas) ? map.personas : [];
  const entities = Array.isArray(map?.entities) ? map.entities : [];

  const people = unique(
    personas
      .map((p) => singularize(words(p?.name)))
      .filter((w) => w && w.split(' ').length <= MAX_WORDS),
  ).slice(0, MAX_ITEMS);

  const things = unique(
    entities
      .filter((e) => e?.type === 'table')
      .map((e) => words(e.label || e.key))
      .filter((w) => w && w.split(' ').length <= MAX_WORDS && !INFRA_TABLE.test(w.replace(/ /g, '_')))
      .map(pluralize),
  ).slice(0, MAX_ITEMS);

  return { people, things };
}

module.exports = { buildAppWords, pluralize, singularize };
