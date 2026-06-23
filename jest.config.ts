import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({ dir: './' })

const config: Config = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  // Tests share one Postgres DB and reset tables in beforeEach — run test files sequentially
  maxWorkers: 1,
  // Remote free-tier Postgres adds real network latency per query; the 5s
  // Jest default is too tight for clearDb()'s 5 sequential deleteMany() calls
  testTimeout: 30000,
  // Some test file leaves a handle open (Jest warns "did not exit"), which
  // otherwise leaves a zombie process holding a connection against Render's
  // low free-tier connection limit and starves the next test run. Force the
  // process to exit once tests finish running.
  forceExit: true,
}

export default createJestConfig(config)
