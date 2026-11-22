// Runs once before all tests: a fresh test database built by the real migrations.
const { execSync } = require('child_process');
const { backendDir, removeTestDb } = require('./testDb');

module.exports = async () => {
  removeTestDb();
  execSync('npx sequelize-cli db:migrate', {
    cwd: backendDir,
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: 'pipe',
  });
};
