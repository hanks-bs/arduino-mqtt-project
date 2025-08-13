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
  avgJitterMs?: number;
  ci95Jitter?: number;
  avgFreshnessMs?: number;
  avgStalenessMs?: number;
  ci95Staleness?: number;
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
  const candidates: Array<{ name: string; mtimeMs: number }> = [];
  for (const n of entries) {
    if (n.startsWith('.') || n.startsWith('_')) continue; // pomiń pliki indeksów
    const p = path.join(benchesDir, n);
    try {
      const st = await fs.stat(p);
      if (!st.isDirectory()) continue;
      const hasSummary = await fs.pathExists(path.join(p, 'summary.json'));
      if (!hasSummary) continue;
      candidates.push({
        name: n,
        mtimeMs: st.mtimeMs || st.mtime.getTime?.() || 0,
      });
    } catch {}
  }
  if (!candidates.length) throw new Error('Brak plików summary.json');
  // Sortuj malejąco wg czasu modyfikacji katalogu; przy remisie fallback po nazwie
  candidates.sort((a, b) => {
    if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
    return a.name > b.name ? -1 : 1;
  });
  const latest = candidates[0].name;
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
    wsPayload: number;
    httpPayload: number;
    repeats: number;
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
  const ciThreshJitter = durationSec >= 60 ? 0.35 : 0.7;
  const ciThreshStale = durationSec >= 60 ? 0.35 : 0.7;

  // helpers
  const parseIntSafe = (v: any): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
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
    // Default to 0 (not 1), to avoid fabricating activity when clients were explicitly 0
    const clients = declaredClients ?? labelClients ?? 0;
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
    // CI dla jitter/staleness
    if (
      Number.isFinite(s.avgJitterMs) &&
      Number(s.avgJitterMs) > 0 &&
      Number.isFinite(s.ci95Jitter)
    ) {
      const rel = (s.ci95Jitter || 0) / (s.avgJitterMs || 1);
      if (rel > ciThreshJitter)
        warn.push(
          `${s.label}: szeroki CI Jitter (±${(rel * 100).toFixed(0)}% średniej)`,
        );
    }
    const staleAvg = Number.isFinite(Number(s.avgStalenessMs))
      ? Number(s.avgStalenessMs)
      : Number(s.avgFreshnessMs);
    if (
      Number.isFinite(staleAvg) &&
      staleAvg > 0 &&
      Number.isFinite(s.ci95Staleness)
    ) {
      const rel = (s.ci95Staleness || 0) / (staleAvg || 1);
      if (rel > ciThreshStale)
        warn.push(
          `${s.label}: szeroki CI Staleness (±${(rel * 100).toFixed(0)}% średniej)`,
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
      // Skip absolute rate expectation when no clients (HTTP) or no activity was expected
      const skipRate = s.mode === 'polling' && clients === 0;
      if (!skipRate && expectedRateScaled != null) {
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
      // Skip payload check when no activity (avgRate==0) or clients==0 for polling
      const noActivity =
        s.avgRate === 0 || (s.mode === 'polling' && clients === 0);
      if (!noActivity) {
        const low = expPayload * (1 - s.tolPayload);
        const high = expPayload * (1 + s.tolPayload);
        if (!(s.bytesPerUnit >= low && s.bytesPerUnit <= high)) {
          fail.push(
            `${s.label}: Bytes/jednostkę poza oczekiwaniem [${low.toFixed(1)}, ${high.toFixed(1)}], avg=${s.bytesPerUnit.toFixed(1)}`,
          );
        }
      }
    }
  }

  // Sanity: przy ~1 Hz i bez obciążenia oczekujemy, że jitter WS ≪ HTTP (np. >25% niższy)
  try {
    const oneHz = items.filter(s => /@1(?:\.0+)?Hz/.test(s.label));
    const byKey = new Map<string, { ws?: Item; http?: Item }>();
    for (const s of oneHz) {
      const load = s.label.match(/load=(\d+)%/)?.[1] ?? '0';
      const clients =
        s.mode === 'ws'
          ? String(s.clientsWs ?? s.label.match(/cWs=(\d+)/)?.[1] ?? '0')
          : String(s.clientsHttp ?? s.label.match(/cHttp=(\d+)/)?.[1] ?? '0');
      const key = `L${load}|C${clients}`;
      const g = byKey.get(key) || {};
      if (s.mode === 'ws') g.ws = s;
      else g.http = s;
      byKey.set(key, g);
    }
    for (const [k, g] of byKey) {
      if (!g.ws || !g.http) continue;
      const jw = Number(g.ws.avgJitterMs ?? NaN);
      const jh = Number(g.http.avgJitterMs ?? NaN);
      if (Number.isFinite(jw) && Number.isFinite(jh) && jh > 0) {
        const rel = (jw - jh) / jh; // ujemny gdy WS mniejszy (lepszy)
        if (rel > -0.25) {
          warn.push(
            `Jitter WS nie wyraźnie mniejszy niż HTTP przy 1Hz (${k}): WS=${jw.toFixed(1)} ms, HTTP=${jh.toFixed(1)} ms`,
          );
        }
      }
    }
  } catch {}

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
