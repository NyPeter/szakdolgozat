// The SQLite file of the "test" config, removed before and after a test run.
const fs = require('fs');
const path = require('path');
const config = require('../../config/config.json');

const backendDir = path.join(__dirname, '..', '..');
const storage = path.join(backendDir, config.test.storage);

// Never let the tests touch another database file.
if (path.basename(storage) !== 'test_database.sqlite') {
  throw new Error(`Refusing to use ${storage} as the test database`);
}

// eslint-disable-next-line jsdoc/require-jsdoc
function removeTestDb() {
  ['', '-shm', '-wal', '-journal'].forEach((suffix) => {
    fs.rmSync(storage + suffix, { force: true });
  });
}

module.exports = { backendDir, storage, removeTestDb };
