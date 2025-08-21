import { jest } from '@jest/globals';

// Mock ResourceMonitor methods used by controller
jest.mock('../services/ResourceMonitorService', () => {
  return {
    __esModule: true,
    ResourceMonitor: {
      init: jest.fn(),
      sampleNow: jest.fn(async () => ({ ok: true })),
      isLiveEmitEnabled: jest.fn(() => true),
      setLiveEmitEnabled: jest.fn(),
      // session APIs usunięte z kontrolera – mock pozostawiony pusty
    },
  };
});

import request from 'supertest';
import server from '../server';

describe('MonitorController routes', () => {
  afterAll(done => {
    // Close underlying HTTP server to avoid open handles in Jest
    try {
      (server as any).close?.();
    } catch {}
    done();
  });

  it('GET /api/monitor/live returns metrics snapshot', async () => {
    const res = await request(server).get('/api/monitor/live');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeTruthy();
  });

  it('GET /api/monitor/live-emit returns status', async () => {
    const res = await request(server).get('/api/monitor/live-emit');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.enabled).toBe(true);
  });

  it('POST /api/monitor/live-emit validates payload', async () => {
    const bad = await request(server).post('/api/monitor/live-emit').send({});
    expect(bad.status).toBe(400);

    const ok = await request(server)
      .post('/api/monitor/live-emit')
      .send({ enabled: false });
    expect(ok.status).toBe(200);
    expect(ok.body.success).toBe(true);
  });

  // Usunięto testy endpointów sesyjnych (start/stop/list/reset)
});
