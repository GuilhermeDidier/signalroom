/**
 * e2e + unit tests. They run against the real local Postgres/Redis, but in an
 * isolated schema (`signalroom_test`, see test/global-setup.ts) so a test run
 * never touches the dev data in `public`.
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.spec.ts', '<rootDir>/src/**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  globalSetup: '<rootDir>/test/global-setup.ts',
  setupFiles: ['<rootDir>/test/env.ts'],
  testTimeout: 30000,
  // Specs share one database schema: run them serially.
  maxWorkers: 1,
};
