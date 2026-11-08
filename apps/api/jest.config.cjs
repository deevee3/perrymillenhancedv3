/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json', diagnostics: false }]
  },
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  moduleNameMapper: {
    '^normalize-url$': '<rootDir>/src/__mocks__/normalizeUrlMock.cjs'
  },
  testMatch: ['**/?(*.)+(spec|test).ts']
};

module.exports = config;
