// src/__tests__/app.test.ts

import { jest } from '@jest/globals';

// Mock function for Express' listen method
const mockListen = jest.fn();

// Mocking the config module to return specific values for MODE and PORT
jest.mock('../config/config', () => ({
  MODE: 'development',
  PORT: 4000,
}));

// Mocking the Express server module
jest.mock('../server', () => ({
  __esModule: true,
  default: {
    listen: mockListen,
  },
}));

// Spying on console methods to verify log messages
const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
const consoleErrorSpy = jest
  .spyOn(console, 'error')
  .mockImplementation(() => {});

// Importing the main function after the mocks are set
import { main } from '../app';

describe('Express Server (no external logger)', () => {
  beforeEach(() => {
    // Clear mock calls before each test to start fresh
    jest.clearAllMocks();
  });

  it('should start the server on port 4000 in development mode', async () => {
    // Invoke the main function, which uses the mocked config and server
    await main();

    // Check if the listen method was called once with correct arguments
    expect(mockListen).toHaveBeenCalledTimes(1);
    expect(mockListen).toHaveBeenCalledWith(4000, expect.any(Function));

    // Manually invoke the callback to simulate server startup
    const listenCallback = mockListen.mock.calls[0][1] as () => void;
    listenCallback();

    // Verify console.log was called with the correct message
    expect(consoleLogSpy).toHaveBeenCalledWith('Now listening on port 4000');
  });

  it('should use port 3000 if PORT is not set', async () => {
    // Reset modules and mocks to apply new mocks for this test
    jest.resetModules();
    jest.clearAllMocks();

    // Mock config with an undefined PORT
    jest.mock('../config/config', () => ({
      MODE: 'production',
      PORT: undefined,
    }));

    // Mock a new server with a different listen function
    const mockListenDefault = jest.fn();
    jest.mock('../server', () => ({
      __esModule: true,
      default: {
        listen: mockListenDefault,
      },
    }));

    // Spy on console methods again after reset
    const consoleLogSpyDefault = jest
      .spyOn(console, 'log')
      .mockImplementation(() => {});
    const consoleErrorSpyDefault = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    // Import the main function again with updated mocks
    const { main: mainDefault } = await import('../app');
    await mainDefault();

    // The server should listen on the default port (3000)
    expect(mockListenDefault).toHaveBeenCalledWith(3000, expect.any(Function));

    // Invoke the callback to verify logging
    const listenCallbackDefault = mockListenDefault.mock
      .calls[0][1] as () => void;
    listenCallbackDefault();

    // Check if console.log was called with the correct message
    expect(consoleLogSpyDefault).toHaveBeenCalledWith(
      'Now listening on port 3000',
    );
    expect(consoleErrorSpyDefault).not.toHaveBeenCalled();
  });

  it('should log an error if the server fails to start', async () => {
    // Reset modules to mock a failing scenario
    jest.resetModules();
    jest.clearAllMocks();

    // Mock config with a certain PORT
    jest.mock('../config/config', () => ({
      MODE: 'production',
      PORT: 5000,
    }));

    // Mock the server to throw an error when listen is invoked
    const mockListenFail = jest.fn().mockImplementation(() => {
      throw new Error('Failed to start server');
    });
    jest.mock('../server', () => ({
      __esModule: true,
      default: {
        listen: mockListenFail,
      },
    }));

    // Spy on console methods again
    const consoleLogSpyFail = jest
      .spyOn(console, 'log')
      .mockImplementation(() => {});
    const consoleErrorSpyFail = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    // Import the main function for this failing scenario
    const { main: mainFail } = await import('../app');
    await mainFail();

    // The server tries to listen on port 5000
    expect(mockListenFail).toHaveBeenCalledWith(5000, expect.any(Function));

    // Check if console.error was called with the appropriate error
    expect(consoleErrorSpyFail).toHaveBeenCalledWith(
      new Error('Failed to start server'),
    );
    expect(consoleLogSpyFail).not.toHaveBeenCalled();
  });
});
