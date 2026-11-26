'use strict';

// Loads the ids of the projects the signed-in user is a member of into
// req.memberProjectIds (a Set), so checkProjectAccess can stay synchronous.
// Runs after optionalAuth/requireAuth. On a database error it fails closed:
// the user keeps access to the projects they own, and no member access.

function loadMemberships(deps = {}) {
  const getIds = deps.projectIdsForUser
    || ((userId) => require('./db').projectMembers.projectIdsForUser(userId));
  return async function memberships(req, _res, next) {
    req.memberProjectIds = new Set();
    if (!req.user?.id) return next();
    try {
      const ids = await getIds(req.user.id);
      req.memberProjectIds = new Set(ids.map(String));
    } catch (err) {
      console.warn('[memberships] lookup failed:', err.message);
    }
    return next();
  };
}

module.exports = { loadMemberships };
