import { jest } from '@jest/globals';
import request from 'supertest';

describe('CSV export of sessions', () => {
  const ORIGINAL_ENV = process.env as NodeJS.ProcessEnv;
  let server: any;

  beforeAll(async () => {
    process.env = { ...ORIGINAL_ENV };
    // Mock pidusage for stability
    jest.doMock('pidusage', () => ({
      __esModule: true,
      default: jest.fn(async () => ({ cpu: 2, memory: 140 * 1024 * 1024 })),
    }));
    server = (await import('../server')).default;
    await new Promise<void>(resolve => {
      (server as any).listen(0, () => resolve());
    });
  });

  afterAll(done => {
    try { (server as any).close?.(); } catch {}
    process.env = ORIGINAL_ENV;
    done();
  });

  it('returns CSV with expected header and numeric fields', async () => {
    // start a tiny WS session to generate at least one sample
    const start = await request(server)
      .post('/api/monitor/start')
      .send({ label: 'csv', mode: 'ws', wsFixedRateHz: 2, durationSec: 1 });
    expect(start.status).toBe(201);

    // wait ~1.2s to collect a tick
    await new Promise(res => setTimeout(res, 1200));

    const res = await request(server).get('/api/monitor/sessions/export/csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);

    const text: string = (res as any).text;
    const lines = text.split(/\r?\n/);
    expect(lines.length).toBeGreaterThan(1);
    const header = lines[0].split(',');
    expect(header.slice(0, 5)).toEqual([
      'sessionId',
      'label',
      'mode',
      'startedAt',
      'finishedAt',
    ]);

    // First data row should have numeric entries in known positions
    const firstData = lines[1]?.split(',');
    expect(firstData?.length).toBeGreaterThan(10);
    // sampleIndex
    expect(Number.isFinite(Number(firstData![5]))).toBe(true);
    // cpu
    expect(Number.isFinite(Number(firstData![7]))).toBe(true);
    // wsMsgRate or httpReqRate exist; we just check the field by position (wsMsgRate at index 14)
    expect(Number.isFinite(Number(firstData![14]))).toBe(true);
  });
});
