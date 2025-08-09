import { jest } from '@jest/globals';

// Helper to build a fake Socket.IO server minimal interface
function makeFakeIo() {
  return {
    emit: (_event: string, _data: any) => {},
    of: (_ns?: string) => ({ sockets: { size: 0 } }),
  } as any;
}

describe('ResourceMonitorService integration', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('auto-enables WS emissions during WS session and restores previous state', async () => {
    // Disable live emit via env, import fresh module so ctor reads env
    process.env.LIVE_REALTIME_ENABLED = '0';
    // Mock pidusage to avoid OS calls in tests
    jest.doMock('pidusage', () => ({
      __esModule: true,
      default: jest.fn(async () => ({ cpu: 3, memory: 150 * 1024 * 1024 })),
    }));
    const { ResourceMonitor } = await import('../services/ResourceMonitorService');
    ResourceMonitor.init(makeFakeIo());

    try {
      expect(ResourceMonitor.isLiveEmitEnabled()).toBe(false);

      const rec = ResourceMonitor.startSession({
        label: 'test-ws-auto-enable',
        mode: 'ws',
        wsFixedRateHz: 1,
        durationSec: 1,
      });
      expect(rec).toBeTruthy();
      // Emission should be force-enabled for the duration of WS session
      expect(ResourceMonitor.isLiveEmitEnabled()).toBe(true);

      // Finish and ensure restoration
      ResourceMonitor.finishSession(rec.id);
      expect(ResourceMonitor.isLiveEmitEnabled()).toBe(false);
    } finally {
      // Cleanup
      ResourceMonitor.shutdown();
      ResourceMonitor.resetSessions();
    }
  });

  it('controlled WS driver produces consistent rate and bytes', async () => {
    // Faster monitor tick for tests
    process.env.MONITOR_TICK_MS = '250';
    // Mock pidusage to avoid OS calls in tests
    jest.doMock('pidusage', () => ({
      __esModule: true,
      default: jest.fn(async () => ({ cpu: 4, memory: 180 * 1024 * 1024 })),
    }));
    const { ResourceMonitor } = await import('../services/ResourceMonitorService');
    ResourceMonitor.init(makeFakeIo());
    try {
      // Start a short controlled WS session
      const payload = 200;
      const hz = 4; // 4 messages per second
      const durSec = 2; // ~2s
      const rec = ResourceMonitor.startSession({
        label: 'test-ws-controlled',
        mode: 'ws',
        wsFixedRateHz: hz,
        assumedPayloadBytes: payload,
        durationSec: durSec,
      });

      // Wait real time to allow driver and monitor ticks to run
      await new Promise(res => setTimeout(res, (durSec * 1000) + 600));

      // Ensure session finished
      ResourceMonitor.finishSession(rec.id);
      const fin = ResourceMonitor.getSession(rec.id);
      expect(fin).toBeTruthy();
      expect(fin!.samples.length).toBeGreaterThan(0);

      // Compute averages over collected samples
      const isWs = fin!.config.mode === 'ws';
      const avg = fin!.samples.reduce(
        (acc, m) => {
          acc.rate += isWs ? m.wsMsgRate : m.httpReqRate;
          acc.bytes += isWs ? m.wsBytesRate : m.httpBytesRate;
          acc.payloadAvg += isWs ? m.wsAvgBytesPerMsg : m.httpAvgBytesPerReq;
          return acc;
        },
        { rate: 0, bytes: 0, payloadAvg: 0 }
      );
      avg.rate /= fin!.samples.length;
      avg.bytes /= fin!.samples.length;
      avg.payloadAvg /= fin!.samples.length;

      // Expect approximate relationships
      expect(avg.rate).toBeGreaterThan(hz * 0.5);
      expect(avg.rate).toBeLessThan(hz * 1.5);
      // bytes ~= rate * payload
      const bytesPerUnit = avg.bytes / Math.max(0.0001, avg.rate);
      expect(bytesPerUnit).toBeGreaterThan(payload * 0.5);
      expect(bytesPerUnit).toBeLessThan(payload * 1.5);
      // direct avg payload should also be close
      expect(avg.payloadAvg).toBeGreaterThan(payload * 0.5);
      expect(avg.payloadAvg).toBeLessThan(payload * 1.5);
    } finally {
      ResourceMonitor.shutdown();
      ResourceMonitor.resetSessions();
    }
  });
});
