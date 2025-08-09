import { jest } from '@jest/globals';
import ioClient from 'socket.io-client';
import request from 'supertest';

// Use a real HTTP server from our app and a real socket.io client to validate WS path

describe('E2E WebSocket metrics emission', () => {
  const ORIGINAL_ENV = process.env as NodeJS.ProcessEnv;
  let server: any;
  let baseUrl: string;

  beforeAll(async () => {
    process.env = { ...ORIGINAL_ENV, LIVE_REALTIME_ENABLED: '0' }; // start with WS disabled to test auto-enable in session
    // Mock pidusage to avoid platform coupling
    jest.doMock('pidusage', () => ({
      __esModule: true,
      default: jest.fn(async () => ({ cpu: 1.5, memory: 120 * 1024 * 1024 })),
    }));
    const srv = (await import('../server')).default;
    server = srv;
    // We need the actual port to connect; start listening on ephemeral port
    await new Promise<void>(resolve => {
      (server as any).listen(0, () => resolve());
    });
    const address = (server as any).address();
    const port = typeof address === 'object' ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(done => {
    try { (server as any).close?.(); } catch {}
    process.env = ORIGINAL_ENV;
    done();
  });

  it('emits metrics over WS and respects auto-enable during WS session', async () => {
    // First, connect WS client; since LIVE_REALTIME_ENABLED=0, we do not expect metrics until a WS session is started
    const client = ioClient(baseUrl, { transports: ['websocket'], forceNew: true, reconnection: false });

    const received: any[] = [];
    client.on('metrics', (msg: any) => received.push(msg));

    // Wait a short while to ensure no emissions when disabled
    await new Promise(res => setTimeout(res, 600));
    expect(received.length).toBe(0);

    // Start a WS session which should force-enable live emissions
    const startRes = await request(server)
      .post('/api/monitor/start')
      .send({ label: 'e2e-ws', mode: 'ws', wsFixedRateHz: 2, durationSec: 1 });
    expect(startRes.status).toBe(201);

    // Now we should get some metrics events
    await new Promise(res => setTimeout(res, 1200));
    expect(received.length).toBeGreaterThan(0);

    client.close();
  });
});
