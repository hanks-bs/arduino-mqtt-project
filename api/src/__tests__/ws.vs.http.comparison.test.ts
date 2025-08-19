// Test both WS and HTTP scenarios with measurementRunner
import fs from 'fs-extra';
import path from 'node:path';
import { runMeasurements } from '../scripts/measurementRunner';

// Mock pidusage
jest.mock('pidusage', () => {
  return {
    __esModule: true,
    default: (pid: number) =>
      Promise.resolve({ cpu: 10, memory: 120 * 1024 * 1024, pid }),
  };
});

describe('WS vs HTTP measurement comparison', () => {
  const prevEnv = { ...process.env } as NodeJS.ProcessEnv;

  beforeAll(() => {
    // Fast sampling and short sessions for testing
    process.env.MONITOR_TICK_MS = '250';
    process.env.MEASURE_DURATION_SEC = '3';
    // Test both WS and HTTP modes
    process.env.MEASURE_MODES = 'ws,polling';
    process.env.MEASURE_HZ_SET = '1';
    // Test with a small number of clients for comparison
    process.env.MEASURE_CLIENTS_HTTP = '1';
    process.env.MEASURE_CLIENTS_WS = '1';
    process.env.MEASURE_LOAD_SET = '0';
    process.env.MEASURE_REPEATS = '1';
  });

  afterAll(() => {
    process.env = prevEnv;
  });

  it('produces comparable per-client metrics for WS and HTTP', async () => {
    const { outDir, evaluated } = await runMeasurements();
    expect(Array.isArray(evaluated)).toBe(true);
    
    // Find WS and HTTP results
    const wsResult = evaluated.find(s => s.mode === 'ws');
    const httpResult = evaluated.find(s => s.mode === 'polling');
    
    expect(wsResult).toBeDefined();
    expect(httpResult).toBeDefined();
    
    if (!wsResult || !httpResult) {
      throw new Error('Missing WS or HTTP results');
    }
    
    console.log('WS Results:', {
      label: wsResult.label,
      avgRate: wsResult.avgRate,
      avgBytesRate: wsResult.avgBytesRate,
      ratePerClient: (wsResult as any).ratePerClient,
      bytesPerClient: (wsResult as any).bytesRatePerClient,
      avgPayload: wsResult.avgPayload,
      clients: (wsResult as any).clientsWs,
    });
    
    console.log('HTTP Results:', {
      label: httpResult.label,
      avgRate: httpResult.avgRate,
      avgBytesRate: httpResult.avgBytesRate,
      ratePerClient: (httpResult as any).ratePerClient,
      bytesPerClient: (httpResult as any).bytesRatePerClient,
      avgPayload: httpResult.avgPayload,
      clients: (httpResult as any).clientsHttp,
    });
    
    // Both should have similar per-client rates (around 1 Hz)
    const wsRatePerClient = (wsResult as any).ratePerClient;
    const httpRatePerClient = (httpResult as any).ratePerClient;
    
    expect(wsRatePerClient).toBeGreaterThan(0.5);
    expect(wsRatePerClient).toBeLessThan(2.0);
    expect(httpRatePerClient).toBeGreaterThan(0.5);
    expect(httpRatePerClient).toBeLessThan(2.0);
    
    // Per-client rates should be reasonably close (within 50%)
    const rateDiff = Math.abs(wsRatePerClient - httpRatePerClient);
    const rateAvg = (wsRatePerClient + httpRatePerClient) / 2;
    const relativeError = rateDiff / rateAvg;
    
    console.log(`Rate per client - WS: ${wsRatePerClient}, HTTP: ${httpRatePerClient}, relative error: ${(relativeError * 100).toFixed(1)}%`);
    
    expect(relativeError).toBeLessThan(0.5); // Less than 50% difference
    
    // Byte rates should also be comparable
    const wsBytesPerClient = (wsResult as any).bytesRatePerClient;
    const httpBytesPerClient = (httpResult as any).bytesRatePerClient;
    
    expect(wsBytesPerClient).toBeGreaterThan(100); // Some reasonable bytes
    expect(httpBytesPerClient).toBeGreaterThan(100);
    
    const bytesDiff = Math.abs(wsBytesPerClient - httpBytesPerClient);
    const bytesAvg = (wsBytesPerClient + httpBytesPerClient) / 2;
    const bytesRelativeError = bytesDiff / bytesAvg;
    
    console.log(`Bytes per client - WS: ${wsBytesPerClient}, HTTP: ${httpBytesPerClient}, relative error: ${(bytesRelativeError * 100).toFixed(1)}%`);
    
    expect(bytesRelativeError).toBeLessThan(0.3); // Less than 30% difference
    
  }, 30000);
});