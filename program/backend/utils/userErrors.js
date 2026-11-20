const msg = require('./messages');

// Turns a Sequelize error raised while creating or updating a User into an
// HTTP status and a message from the catalogue.
// eslint-disable-next-line jsdoc/require-jsdoc
function describeUserError(err) {
  const field = err.errors?.[0]?.path;

  if (err.name === 'SequelizeUniqueConstraintError') {
    return { status: 409, message: field === 'email' ? msg.EMAIL_TAKEN : msg.NAME_TAKEN };
  }

  if (err.name === 'SequelizeValidationError') {
    if (field === 'email') return { status: 400, message: msg.INVALID_EMAIL };
    if (field === 'password') return { status: 400, message: msg.PASSWORD_TOO_SHORT };
    return { status: 400, message: msg.INVALID_DATA };
  }

  // eslint-disable-next-line no-console
  console.error(err);
  return { status: 500, message: msg.SERVER_ERROR };
}

module.exports = { describeUserError };
