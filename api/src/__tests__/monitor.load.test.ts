// src/__tests__/monitor.load.test.ts
import { jest } from '@jest/globals';

// Fake minimal Socket.IO instance for ResourceMonitor
function makeFakeIo() {
  return {
    emit: () => {},
    of: () => ({ sockets: { size: 0 } }),
  } as any;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('ResourceMonitor sessions under load', () => {
  let ResourceMonitor: (typeof import('App/services/ResourceMonitorService'))['ResourceMonitor'];

  beforeAll(async () => {
    // Speed up and stabilize metrics
    process.env.MONITOR_TICK_MS = '200';
    // Mock pidusage to avoid OS dependency and hangs
    jest.doMock('pidusage', () => ({
      __esModule: true,
      default: jest.fn(async () => ({ cpu: 5, memory: 200 * 1024 * 1024 })),
    }));
    const mod = await import('App/services/ResourceMonitorService');
    ResourceMonitor = mod.ResourceMonitor;
    ResourceMonitor.init(makeFakeIo());
    ResourceMonitor.setLiveEmitEnabled(false);
  });

  afterEach(() => {
    try {
      ResourceMonitor.finishSession((ResourceMonitor as any).activeSessionId);
    } catch {}
    try {
      ResourceMonitor.shutdown();
      ResourceMonitor.resetSessions();
    } catch {}
  });

  it('runs a WS controlled session with CPU load and collects samples', async () => {
    const rec = ResourceMonitor.startSession({
      label: 'test-ws-load',
      mode: 'ws',
      wsFixedRateHz: 2,
      assumedPayloadBytes: 300,
      durationSec: 2,
      loadCpuPct: 10,
      loadWorkers: 1,
    });

    const samples: any[] = [];
    for (let i = 0; i < 6; i++) {
      samples.push(await ResourceMonitor.sampleNow());
      await sleep(200);
    }
    ResourceMonitor.finishSession(rec.id);

    const avgWsRate =
      samples.reduce((a, m) => a + m.wsMsgRate, 0) /
      Math.max(1, samples.length);
    expect(avgWsRate).toBeGreaterThan(0.2);
    const avgWsBytes =
      samples.reduce((a, m) => a + m.wsBytesRate, 0) /
      Math.max(1, samples.length);
    expect(avgWsBytes).toBeGreaterThan(0);
  }, 20000);

  it('records HTTP metrics when simulated via onHttpResponse (with background load)', async () => {
    const periodMs = 200; // ~5 Hz target
    const payloadBytes = 420;
    const rec = ResourceMonitor.startSession({
      label: 'test-http-load',
      mode: 'polling',
      pollingIntervalMs: periodMs,
      durationSec: 2,
      loadCpuPct: 5,
      loadWorkers: 1,
    });

    const t = setInterval(() => {
      try {
        ResourceMonitor.onHttpResponse(payloadBytes);
        ResourceMonitor.setLastArduinoTimestamp(new Date().toISOString());
      } catch {}
    }, periodMs);
    t.unref();

    const samples: any[] = [];
    for (let i = 0; i < 6; i++) {
      samples.push(await ResourceMonitor.sampleNow());
      await sleep(200);
    }
    clearInterval(t);
    ResourceMonitor.finishSession(rec.id);

    const avgHttpRate =
      samples.reduce((a, m) => a + m.httpReqRate, 0) /
      Math.max(1, samples.length);
    expect(avgHttpRate).toBeGreaterThan(0.5);
    const avgHttpBytes =
      samples.reduce((a, m) => a + m.httpBytesRate, 0) /
      Math.max(1, samples.length);
    expect(avgHttpBytes).toBeGreaterThan(0);
  }, 20000);
});
