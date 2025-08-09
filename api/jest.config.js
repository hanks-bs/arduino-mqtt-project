// jest.config.js
const { pathsToModuleNameMapper } = require('ts-jest');
const { compilerOptions } = require('./tsconfig.json');

module.exports = {
  roots: ['<rootDir>'],
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 20000,
  testMatch: ['<rootDir>/src/__tests__/**/*.(spec|test).ts?(x)'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/jest.setup.ts'],
  moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, {
    prefix: '<rootDir>/',
  }),
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: ['/node_modules/', '/jest.config.js', '/dist/'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
    '^.+\\.js$': 'babel-jest',
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  verbose: true,
};
