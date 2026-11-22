// Runs once after all tests.
const { removeTestDb } = require('./testDb');

module.exports = async () => {
  removeTestDb();
};
