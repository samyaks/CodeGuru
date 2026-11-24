'use strict';

const YAML = require('yaml');

/**
 * Parse takeoff.yaml text. Never throws on bad input: YAML syntax problems come
 * back as `issues` so callers can print them like any other validation error.
 *
 * @returns {{ data: any, doc: YAML.Document, issues: Issue[], position: (path: Array<string|number>) => {line:number,col:number}|null }}
 * @typedef {{ severity: 'error'|'warning', path: string, message: string, line: number|null, col: number|null }} Issue
 */
function parse(text) {
  const lineCounter = new YAML.LineCounter();
  const doc = YAML.parseDocument(String(text), { lineCounter, prettyErrors: false, uniqueKeys: true });
  const issues = [];

  for (const err of doc.errors) {
    const pos = Array.isArray(err.pos) ? lineCounter.linePos(err.pos[0]) : null;
    issues.push({
      severity: 'error',
      path: '',
      message: `YAML syntax: ${err.message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, '')}`,
      line: pos ? pos.line : null,
      col: pos ? pos.col : null,
    });
  }

  const position = (path) => {
    try {
      // Walk up until a node with a range exists (a missing key has no node of its own).
      for (let n = path.length; n >= 0; n -= 1) {
        const node = doc.getIn(path.slice(0, n), true);
        if (node && node.range) {
          const { line, col } = lineCounter.linePos(node.range[0]);
          return { line, col };
        }
      }
    } catch { /* fall through */ }
    return null;
  };

  const data = doc.errors.length ? null : doc.toJS();
  return { data, doc, issues, position };
}

module.exports = { parse };
