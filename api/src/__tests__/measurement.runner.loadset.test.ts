/**
 * Smoke test: measurementRunner iterates across MEASURE_LOAD_SET
 * The test runs a shortened measurement with disabled live emit and
 * asserts that summary.json contains labels with load= markers for all levels.
 */
import fs from 'fs-extra';
import path from 'node:path';

// Import the runner directly
import { runMeasurements } from '../scripts/measurementRunner';
// Mock pidusage to prevent Windows WMI issues and teardown races
jest.mock('pidusage', () => {
  return {
    __esModule: true,
    default: (pid: number) =>
      Promise.resolve({ cpu: 10, memory: 120 * 1024 * 1024, pid }),
  };
});

describe('measurementRunner multi-load set', () => {
  const prevEnv = { ...process.env } as NodeJS.ProcessEnv;

  beforeAll(() => {
    // Fast sampling and short sessions to keep CI quick
    process.env.MONITOR_TICK_MS = '150';
    process.env.MEASURE_DURATION_SEC = '2';
    // Only WS@1Hz to minimize runtime
    process.env.MEASURE_MODES = 'ws';
    process.env.MEASURE_HZ_SET = '1';
    // Verify multiple load levels
    process.env.MEASURE_LOAD_SET = '0,25,50';
    // Zero synthetic clients to keep it light
    process.env.MEASURE_CLIENTS_HTTP = '0';
    process.env.MEASURE_CLIENTS_WS = '0';
  });

  afterAll(() => {
    process.env = prevEnv;
  });

  it('produces labeled summaries for each load level', async () => {
    const { outDir, evaluated } = await runMeasurements();
    expect(Array.isArray(evaluated)).toBe(true);
    // Collect labels from returned evaluation and summary.json on disk
    const labels = evaluated.map(s => s.label);
    const summaryPath = path.join(outDir, 'summary.json');
    expect(await fs.pathExists(summaryPath)).toBe(true);
    const summary = await fs.readJSON(summaryPath);
    const fileLabels: string[] = (summary.summaries || []).map(
      (s: any) => s.label,
    );
    const allLabels = new Set<string>([...labels, ...fileLabels]);
    // For lp=0 we don't add a suffix; just ensure both non-zero load labels exist
    expect([...allLabels].some(l => /\+ load=25%/.test(l))).toBe(true);
    expect([...allLabels].some(l => /\+ load=50%/.test(l))).toBe(true);
  }, 20000);
});
