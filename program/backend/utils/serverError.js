const messages = require('./messages');

/**
 * Unexpected errors (database, bugs) are logged on the server; the player gets
 * the general message instead of the raw English error text.
 *
 * @param {Error} err - The caught error.
 * @returns {object} Socket callback answer: `{ error }`.
 */
function serverError(err) {
  console.error(err);
  return { error: messages.SERVER_ERROR };
}

module.exports = { serverError };
