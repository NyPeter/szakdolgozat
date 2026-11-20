const db = require('../models');
const msg = require('./messages');

// A token only proves who the user was when they logged in. This looks up the
// account as it is now: deleted accounts and suspended users are turned away.
// Returns { user } or { status, message }.
// eslint-disable-next-line jsdoc/require-jsdoc
async function loadCurrentUser(id) {
  const user = await db.User.findByPk(id);
  if (!user) return { status: 401, message: msg.UNAUTHORIZED };
  if (user.suspendedUntil && new Date(user.suspendedUntil) > new Date()) {
    return { status: 403, message: msg.ACCOUNT_SUSPENDED(user.suspendedUntil) };
  }
  return { user };
}

module.exports = { loadCurrentUser };
