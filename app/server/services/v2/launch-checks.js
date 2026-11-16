'use strict';

// Turns the capability-detector results saved on a project
// (`analysis_data.gaps`) into the launch checks the project page shows.
//
// Only what the detectors can see is reported: sign-in, who sees what, saved
// data, going live, keys and settings, error handling and tests. Payments,
// privacy, email and abuse protection have no detector yet, so they are
// listed in `notChecked` instead of being guessed at.
//
// The wording uses the app's own nouns when the product map has them ("Each
// walker only sees their own bookings") and plain wording when it doesn't.
//
// Statuses use the product's three words: cleared, holding, grounded.

const { pluralize } = require('./app-words');

const CONFIDENT = 0.7;

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

function join(list) {
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

// The app's own nouns, with plain fallbacks when there are none.
function vocab(words) {
  const people = Array.isArray(words?.people) ? words.people : [];
  const things = Array.isArray(words?.things) ? words.things : [];
  return {
    // "dog owners and walkers", or "people"
    everyone: people.length ? join(people.map(pluralize)) : 'people',
    // "walker", or "person"
    one: people[0] || 'person',
    // "bookings and walks", or null
    things: things.length ? join(things) : null,
  };
}

function present(gap) {
  return Boolean(gap && gap.exists);
}

function confident(gap) {
  return present(gap) && (gap.confidence ?? 1) >= CONFIDENT;
}

const CHECKS = [
  {
    key: 'auth',
    id: 'signin',
    label: 'Sign-in',
    need: (v) => `${cap(v.everyone)} can sign in and out.`,
    judge(gap, v) {
      if (!present(gap)) {
        return ['grounded', `There is no way for ${v.everyone} to sign in. Everyone who opens the app is treated the same.`];
      }
      if (Array.isArray(gap.issues) && gap.issues.length > 0) {
        return ['holding', 'Sign-in is set up, but it has problems that could let the wrong person in.'];
      }
      if (!confident(gap)) return ['holding', 'Some of sign-in looks set up, but it may be incomplete.'];
      return ['cleared', `Sign-in is set up for ${v.everyone}.`];
    },
  },
  {
    key: 'permissions',
    id: 'permissions',
    label: 'Who sees what',
    need: (v) => `Each ${v.one} only sees and changes their own ${v.things ?? 'things'}.`,
    judge(gap, v) {
      const own = v.things ?? 'things';
      if (!present(gap)) {
        return ['grounded', `Nothing limits what a signed-in ${v.one} can open. They may see other people’s ${own}.`];
      }
      if (!confident(gap) || gap.hasRoles === false) {
        return ['holding', `Some limits exist, but they may not cover every ${v.one}’s ${own}.`];
      }
      return ['cleared', `There are limits on who can see and change ${v.things ?? 'what'}.`];
    },
  },
  {
    key: 'database',
    id: 'data',
    label: 'Saved data',
    need: (v) =>
      v.things
        ? `${cap(v.things)} are saved and still there after a restart.`
        : 'What people enter is saved and is still there after a restart.',
    judge(gap, v) {
      const them = v.things ? { subj: cap(v.things), are: 'are', lost: 'them' } : { subj: 'What people enter', are: 'is', lost: 'it' };
      if (!present(gap)) return ['grounded', `${them.subj} ${them.are}n’t saved between visits. A restart would lose ${them.lost}.`];
      if (!confident(gap) || (gap.hasSchema === false && gap.hasMigrations === false)) {
        return ['holding', `${them.subj} ${them.are} saved, but how they’re laid out isn’t kept in the project, so a new setup may not match.`];
      }
      return ['cleared', `${them.subj} ${them.are} saved in a database.`];
    },
  },
  {
    key: 'deployment',
    id: 'live',
    label: 'Going live',
    need: () => 'The app has a place to run.',
    judge(gap) {
      if (!present(gap)) return ['grounded', 'There’s no setup for putting this online yet.'];
      if (!confident(gap)) return ['holding', 'Part of the setup for going live is there, but it looks incomplete.'];
      return ['cleared', 'There’s a setup for putting this online.'];
    },
  },
  {
    key: 'envConfig',
    id: 'secrets',
    label: 'Keys and settings',
    need: () => 'Passwords and keys live outside the code, and a new setup knows what to fill in.',
    judge(gap) {
      if (!present(gap)) return ['grounded', 'Settings and keys aren’t kept apart from the code.'];
      const missing = Array.isArray(gap.missingVars) ? gap.missingVars.length : 0;
      if (missing > 0) {
        return ['holding', `${missing} setting${missing === 1 ? ' is' : 's are'} used but not listed anywhere, so a new setup would break.`];
      }
      if (gap.hasExample === false) return ['holding', 'Settings are kept apart, but there’s no example of what to fill in.'];
      return ['cleared', 'Settings are kept apart from the code, with an example to copy.'];
    },
  },
  {
    key: 'errorHandling',
    id: 'errors',
    label: 'When something breaks',
    need: (v) => `${cap(v.everyone)} see a clear message when something goes wrong, not a blank page.`,
    judge(gap, v) {
      if (!present(gap)) return ['grounded', `Nothing catches errors. A problem could show ${v.everyone} a blank page.`];
      if (!confident(gap) || gap.hasGlobalHandler === false) {
        return ['holding', 'Some errors are caught, but not all of them.'];
      }
      return ['cleared', 'Errors are caught and handled.'];
    },
  },
  {
    key: 'testing',
    id: 'tests',
    label: 'Tests',
    need: () => 'The main steps are covered by tests.',
    judge(gap) {
      if (!present(gap)) return ['grounded', 'There are no tests, so a change can break something without you knowing.'];
      if (!confident(gap)) return ['holding', 'There are some tests, but few.'];
      return ['cleared', 'The project has tests.'];
    },
  },
];

// Things a launch needs that no detector looks at yet.
const NOT_CHECKED = ['Payments', 'Privacy', 'Email', 'Abuse protection'];

/**
 * @param detectorGaps `analysis_data.gaps` from the project row
 * @param words `{people, things}` from buildAppWords, optional
 */
function buildLaunchChecks(detectorGaps, words) {
  const gaps = detectorGaps && typeof detectorGaps === 'object' ? detectorGaps : {};
  // Nothing saved yet means the scan hasn't run, not that everything is missing.
  if (Object.keys(gaps).length === 0) return { checks: [], notChecked: NOT_CHECKED };

  const v = vocab(words);
  const checks = CHECKS.map((c) => {
    const [status, explanation] = c.judge(gaps[c.key], v);
    return { id: c.id, label: c.label, need: c.need(v), status, explanation };
  });
  return { checks, notChecked: NOT_CHECKED };
}

module.exports = { buildLaunchChecks, NOT_CHECKED };
