import { jest } from '@jest/globals';

function makeFakeIo() {
  return {
    emit: (_e: string, _d: any) => {},
    of: () => ({ sockets: { size: 0 } }),
  } as any;
}

describe('ResourceMonitorService integration - HTTP simulated', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('HTTP simulated traffic yields consistent rate and bytes', async () => {
    // This test can run concurrently with long-running benchmark tests; allow more time.
    jest.setTimeout(15000);
    // Mock pidusage to avoid OS dependency
    jest.doMock('pidusage', () => ({
      __esModule: true,
      default: jest.fn(async () => ({ cpu: 5, memory: 200 * 1024 * 1024 })),
    }));
    process.env.MONITOR_TICK_MS = '250';
    const { ResourceMonitor } = await import(
      '../services/ResourceMonitorService'
    );
    ResourceMonitor.init(makeFakeIo());

    try {
      // Simulate HTTP responses at ~2 Hz for ~2s
      const payload = 500;
      const hz = 2;
      const period = Math.round(1000 / hz);
      const start = Date.now();
      const durationMs = 2000;

      const timer = setInterval(() => {
        ResourceMonitor.onHttpResponse(payload);
        ResourceMonitor.setLastArduinoTimestamp(new Date().toISOString());
      }, period);
      timer.unref();

      // Wait a bit for the traffic to start
      await new Promise(res => setTimeout(res, 1000));

      // Sample a few metrics WHILE traffic is happening
      const samples = [] as any[];
      for (let i = 0; i < 5; i++) {
        samples.push(await ResourceMonitor.sampleNow());
        await new Promise(res => setTimeout(res, 250));
      }
      
      clearInterval(timer);

      const avgRate =
        samples.reduce((a, m) => a + m.httpReqRate, 0) / samples.length;
      const avgBytes =
        samples.reduce((a, m) => a + m.httpBytesRate, 0) / samples.length;
      const bytesPerReq = avgBytes / Math.max(0.0001, avgRate);

      // allow equality on a slightly lower bound to reduce flakiness on CI/timers
      expect(avgRate).toBeGreaterThanOrEqual(hz * 0.35);
      expect(avgRate).toBeLessThan(hz * 1.8);
      expect(bytesPerReq).toBeGreaterThan(payload * 0.5);
      expect(bytesPerReq).toBeLessThan(payload * 1.5);
    } finally {
      ResourceMonitor.shutdown();
      ResourceMonitor.resetSessions();
    }
  });
});
