const messages = require('./messages');

// Unexpected errors (database, bugs) are logged on the server; the player gets
// the general message instead of the raw English error text.
// eslint-disable-next-line jsdoc/require-jsdoc
function serverError(err) {
  // eslint-disable-next-line no-console
  console.error(err);
  return { error: messages.SERVER_ERROR };
}

module.exports = { serverError };
