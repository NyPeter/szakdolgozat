// Runs before every test file, before any project module is loaded.
process.env.NODE_ENV = 'test'; // models use database/test_database.sqlite
process.env.LEAVE_GRACE_MS = '300'; // the 10 s reload grace period, shortened
