'use strict';

// Turns the capability-detector results saved on a project
// (`analysis_data.gaps`) into the launch checks the project page shows.
//
// Only what the detectors can see is reported: sign-in, who sees what, saved
// data, going live, keys and settings, error handling and tests. Payments,
// privacy, email and abuse protection have no detector yet, so they are
// listed in `notChecked` instead of being guessed at.
//
// Statuses use the product's three words: cleared, holding, grounded.

const CONFIDENT = 0.7;

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
    need: 'People can sign in and out.',
    judge(gap) {
      if (!present(gap)) {
        return ['grounded', 'There is no way to sign in. Anyone who opens the app is treated the same.'];
      }
      if (Array.isArray(gap.issues) && gap.issues.length > 0) {
        return ['holding', 'Sign-in is set up, but it has problems that could let the wrong person in.'];
      }
      if (!confident(gap)) return ['holding', 'Some of sign-in looks set up, but it may be incomplete.'];
      return ['cleared', 'Sign-in is set up.'];
    },
  },
  {
    key: 'permissions',
    id: 'permissions',
    label: 'Who sees what',
    need: 'People only see and change what is theirs.',
    judge(gap) {
      if (!present(gap)) {
        return ['grounded', 'Nothing limits what a signed-in person can open. They may see other people’s things.'];
      }
      if (!confident(gap) || gap.hasRoles === false) {
        return ['holding', 'Some limits on who sees what exist, but they may not cover everything.'];
      }
      return ['cleared', 'There are limits on who can see and change what.'];
    },
  },
  {
    key: 'database',
    id: 'data',
    label: 'Saved data',
    need: 'What people enter is saved and is still there after a restart.',
    judge(gap) {
      if (!present(gap)) return ['grounded', 'Nothing is saved between visits. A restart would lose it.'];
      if (!confident(gap) || (gap.hasSchema === false && gap.hasMigrations === false)) {
        return ['holding', 'Data is saved, but the layout of it isn’t kept in the project, so a new setup may not match.'];
      }
      return ['cleared', 'Data is saved in a database.'];
    },
  },
  {
    key: 'deployment',
    id: 'live',
    label: 'Going live',
    need: 'The app has a place to run.',
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
    need: 'Passwords and keys live outside the code, and a new setup knows what to fill in.',
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
    need: 'People see a clear message when something goes wrong, not a blank page.',
    judge(gap) {
      if (!present(gap)) return ['grounded', 'Nothing catches errors. A problem could show people a blank page.'];
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
    need: 'The main steps are covered by tests.',
    judge(gap) {
      if (!present(gap)) return ['grounded', 'There are no tests, so a change can break something without you knowing.'];
      if (!confident(gap)) return ['holding', 'There are some tests, but few.'];
      return ['cleared', 'The project has tests.'];
    },
  },
];

// Things a launch needs that no detector looks at yet.
const NOT_CHECKED = ['Payments', 'Privacy', 'Email', 'Abuse protection'];

function buildLaunchChecks(detectorGaps) {
  const gaps = detectorGaps && typeof detectorGaps === 'object' ? detectorGaps : {};
  // Nothing saved yet means the scan hasn't run, not that everything is missing.
  if (Object.keys(gaps).length === 0) return { checks: [], notChecked: NOT_CHECKED };

  const checks = CHECKS.map((c) => {
    const [status, explanation] = c.judge(gaps[c.key]);
    return { id: c.id, label: c.label, need: c.need, status, explanation };
  });
  return { checks, notChecked: NOT_CHECKED };
}

module.exports = { buildLaunchChecks, NOT_CHECKED };
