'use strict';

// The matcher lives in @takeoff/cli, so the PR check and the Claude Code hook
// put a file in the same areas.
const { globMatches, matchesAny, touchedAreas, uncheckablePatterns, MAX_PATTERN_LENGTH } = require('@takeoff/cli/lib/globs');

module.exports = { globMatches, matchesAny, touchedAreas, uncheckablePatterns, MAX_PATTERN_LENGTH };
