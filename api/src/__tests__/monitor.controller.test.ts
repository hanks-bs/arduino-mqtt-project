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
      startSession: jest.fn((cfg: any) => ({ id: '1', config: cfg })),
      finishSession: jest.fn((id: string) => (id === '1' ? { id } : undefined)),
      resetSessions: jest.fn(() => 3),
      getSession: jest.fn((id: string) => (id === '1' ? { id } : undefined)),
      listSessions: jest.fn(() => [{ id: '1' }]),
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

  it('POST /api/monitor/start requires label and mode', async () => {
    const bad = await request(server).post('/api/monitor/start').send({});
    expect(bad.status).toBe(400);

    const ok = await request(server)
      .post('/api/monitor/start')
      .send({ label: 'x', mode: 'ws' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.id).toBe('1');
  });

  it('POST /api/monitor/stop validates id and 404 on missing', async () => {
    const bad = await request(server).post('/api/monitor/stop').send({});
    expect(bad.status).toBe(400);

    const nf = await request(server)
      .post('/api/monitor/stop')
      .send({ id: 'nope' });
    expect(nf.status).toBe(404);

    const ok = await request(server)
      .post('/api/monitor/stop')
      .send({ id: '1' });
    expect(ok.status).toBe(200);
  });

  it('GET /api/monitor/sessions and /:id work', async () => {
    const list = await request(server).get('/api/monitor/sessions');
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);

    const one = await request(server).get('/api/monitor/sessions/1');
    expect(one.status).toBe(200);

    const nf = await request(server).get('/api/monitor/sessions/2');
    expect(nf.status).toBe(404);
  });

  it('POST /api/monitor/reset clears sessions', async () => {
    const res = await request(server).post('/api/monitor/reset');
    expect(res.status).toBe(200);
    expect(res.body.data.cleared).toBe(3);
  });
});
