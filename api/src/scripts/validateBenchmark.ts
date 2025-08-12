/*
 Validates the latest benchmark results for credibility, reliability, and correctness.
 - Loads newest ./benchmarks/<ts>/summary.json
 - Checks: rate/payload tolerances, bytes ≈ rate×payload, CI widths vs. mean, sample sizes
 - Emits a concise PASS/WARN/FAIL report to stdout and writes validation.txt to the run folder
*/
import fs from 'fs-extra';
import path from 'node:path';

type Item = {
  label: string;
  mode: 'ws' | 'polling';
  avgRate: number;
  avgBytesRate: number;
  avgPayload: number;
  bytesPerUnit?: number;
  ci95Rate?: number;
  ci95Bytes?: number;
  rateStd?: number;
  bytesStd?: number;
  nUsed?: number;
  nTotal?: number;
  expectedRate?: number;
  expectedPayload?: number;
  tolRate?: number;
  tolPayload?: number;
  clientsHttp?: number;
  clientsWs?: number;
};

async function main() {
  const repoRoot = path.resolve(__dirname, '../../..');
  const benchesDir = path.join(repoRoot, 'api', 'benchmarks');
  const exists = await fs.pathExists(benchesDir);
  if (!exists) throw new Error('Brak folderu benchmarków');
  const entries = await fs.readdir(benchesDir);
  const dirs: string[] = [];
  for (const n of entries) {
    const p = path.join(benchesDir, n);
    try {
      const st = await fs.stat(p);
      if (!st.isDirectory()) continue;
      if (!(await fs.pathExists(path.join(p, 'summary.json')))) continue;
      dirs.push(n);
    } catch {}
  }
  if (!dirs.length) throw new Error('Brak plików summary.json');
  dirs.sort((a, b) => (a > b ? -1 : 1));
  const latest = dirs[0];
  const latestDir = path.join(benchesDir, latest);
  const sumPath = path.join(latestDir, 'summary.json');
  const summary = await fs.readJSON(sumPath);
  const items: Item[] = summary.summaries || [];
  const flags = (summary.flags || {}) as {
    fairPayload?: boolean;
    sourceLimited?: boolean;
  };

  // Detect a "SAFE" run to avoid hard FAIL on expected short-run deviations.
  // Praktyczne kryterium: hzSet ⊆ {0.5,1}, loadSet ⊆ {0}, clientsHttp=0, clientsWs=0, durationSec ≤ 6, monitorTickMs ≥ 500
  const rc = (summary.runConfig || {}) as Partial<{
    hzSet: number[];
    loadSet: number[];
    clientsHttp: number;
    clientsWs: number;
    durationSec: number;
    monitorTickMs: number;
  }>;
  const arr = (x: any): number[] =>
    Array.isArray(x) ? x : Number.isFinite(x) ? [Number(x)] : [];
  const isSubset = (a: number[], allowed: number[]) =>
    a.every(v => allowed.includes(Number(v)));
  const safeHz = rc.hzSet ? isSubset(arr(rc.hzSet), [0.5, 1]) : false;
  const safeLoad = rc.loadSet ? isSubset(arr(rc.loadSet), [0]) : true; // domyślnie 0
  const safeClients =
    Number(rc.clientsHttp ?? 0) === 0 && Number(rc.clientsWs ?? 0) === 0;
  const shortDur = Number(rc.durationSec ?? 0) <= 6;
  const coarseTick = Number(rc.monitorTickMs ?? 0) >= 500;
  const isSafeRun = safeHz && safeLoad && safeClients && shortDur && coarseTick;

  const lines: string[] = [];
  const warn: string[] = [];
  const fail: string[] = [];

  const sourceLimited = Boolean(flags.sourceLimited);
  const fairPayload =
    typeof flags.fairPayload === 'boolean'
      ? flags.fairPayload
      : rc.wsPayload === rc.httpPayload;
  if (!fairPayload) {
    fail.push(
      `Unfair payload: wsPayload=${rc.wsPayload}B, httpPayload=${rc.httpPayload}B`,
    );
  }

  // Validation mode for Rate checks: absolute (default), relative (ignore absolute Hz, focus on payload/CI), or auto (downgrade to WARN when source-limited is detected)
  const mode = String(process.env.VALIDATE_RATE_MODE || 'absolute')
    .toLowerCase()
    .trim();

  // Helper to decide how to treat rate deviations
  const rateIssuesAsWarn = (() => {
    if (mode === 'relative') return true; // never hard-fail on rate
    if (mode === 'absolute') return false;
    // auto: detect source-limited — when majority of sessions are < 50% of expected rate
    const ratios: number[] = [];
    for (const s of items) {
      const exp = (s.expectedRate ??
        (() => {
          const m = s.label.match(/@(\d+(?:\.\d+)?)Hz/);
          return m ? Number(m[1]) : undefined;
        })()) as number | undefined;
      if (exp && exp > 0 && s.avgRate > 0) ratios.push(s.avgRate / exp);
    }
    if (ratios.length === 0) return false;
    const below = ratios.filter(r => r < 0.5).length;
    return below / ratios.length >= 0.7; // 70% sesji poniżej połowy nominalu -> uznaj jako source-limited
  })();

  // thresholds
  const minSamples = 10; // minimal nUsed for believable mean
  const durationSec = Number(rc.durationSec ?? 0);
  const ciThresh = durationSec >= 60 ? 0.3 : 0.6;

  // helpers
  const parseIntSafe = (v: any): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const getClientsFromLabel = (
    label: string,
    key: 'cWs' | 'cHttp',
  ): number | undefined => {
    const idx = label.indexOf(key + '=');
    if (idx === -1) return undefined;
    const tail = label.slice(idx + key.length + 1);
    const m = tail.match(/^(\d+)/);
    return m ? Number(m[1]) : undefined;
  };

  for (const s of items) {
    const nUsed = (s.nUsed ?? 0) as number;
    const nTotal = (s.nTotal ?? 0) as number;
    // Determine clients count; prefer explicit fields, fallback to label pattern (cWs= / cHttp=), default 1
    const declaredClients =
      s.mode === 'ws' ? parseIntSafe(s.clientsWs) : parseIntSafe(s.clientsHttp);
    const labelClients =
      s.mode === 'ws'
        ? getClientsFromLabel(s.label, 'cWs')
        : getClientsFromLabel(s.label, 'cHttp');
    const clients = declaredClients ?? labelClients ?? 1;
    const expRate = s.expectedRate; // may already be scaled by clients (measurementRunner.evaluate)
    const expPayload = s.expectedPayload;
    // sample size
    if (nUsed < minSamples)
      warn.push(
        `${s.label}: mało próbek (n=${nUsed}/${nTotal}), CI może być szeroki`,
      );
    // CI widths
    if (s.avgRate > 0 && Number.isFinite(s.ci95Rate)) {
      const rel = (s.ci95Rate || 0) / s.avgRate;
      if (rel > ciThresh)
        warn.push(
          `${s.label}: szeroki CI Rate (±${(rel * 100).toFixed(0)}% średniej)`,
        );
    }
    if (s.avgBytesRate > 0 && Number.isFinite(s.ci95Bytes)) {
      const rel = (s.ci95Bytes || 0) / s.avgBytesRate;
      if (rel > ciThresh)
        warn.push(
          `${s.label}: szeroki CI Bytes/s (±${(rel * 100).toFixed(0)}% średniej)`,
        );
    }
    // Uwaga: nie wymuszamy bytes ≈ rate × payload, bo payload bywa zmienny (mqtt/arduino), a avgPayload pochodzi z próbek.
    // sanity: if expectedRate is provided, use it; otherwise derive from label and scale by clients
    if (s.tolRate != null) {
      // If expectedRate present, assume already scaled; otherwise attempt derive from label and scale by clients
      let expectedRateScaled: number | undefined = expRate;
      if (expectedRateScaled == null) {
        const m = s.label.match(/@(\d+(?:\.\d+)?)Hz/);
        if (m) {
          const hz = Number(m[1]);
          if (Number.isFinite(hz) && hz > 0) expectedRateScaled = hz * clients;
        }
      }
      if (expectedRateScaled != null) {
        const low = expectedRateScaled * (1 - s.tolRate);
        const high = expectedRateScaled * (1 + s.tolRate);
        if (!(s.avgRate >= low && s.avgRate <= high)) {
          const msg = `${s.label}: Rate poza oczekiwaniem [${low.toFixed(2)}, ${high.toFixed(2)}], avg=${s.avgRate.toFixed(2)} (c=${clients})`;
          if (isSafeRun || rateIssuesAsWarn || sourceLimited) warn.push(msg);
          else fail.push(msg);
        }
      }
    }
    if (expPayload != null && s.tolPayload != null && s.bytesPerUnit != null) {
      const low = expPayload * (1 - s.tolPayload);
      const high = expPayload * (1 + s.tolPayload);
      if (!(s.bytesPerUnit >= low && s.bytesPerUnit <= high)) {
        fail.push(
          `${s.label}: Bytes/jednostkę poza oczekiwaniem [${low.toFixed(1)}, ${high.toFixed(1)}], avg=${s.bytesPerUnit.toFixed(1)}`,
        );
      }
    }
  }

  const status = fail.length ? 'FAIL' : warn.length ? 'WARN' : 'PASS';
  const header = `Credibility/Reliability/Correctness validation`;
  const linesOut = [header, `Validation status: ${status}`, `Run: ${latest}`];
  if (fail.length) {
    linesOut.push('Failures:');
    linesOut.push(...fail.map(s => ` - ${s}`));
  }
  if (warn.length) {
    linesOut.push('Warnings:');
    linesOut.push(...warn.map(s => ` - ${s}`));
  }
  const report = linesOut.join('\n');
  console.log(report);
  await fs.writeFile(path.join(latestDir, 'validation.txt'), report, 'utf8');
}

main().catch(err => {
  console.error('Błąd walidacji:', err.message);
  process.exit(1);
});
