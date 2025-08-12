/*
 Measurement Runner: executes multiple measurement sessions (e.g., two per method)
 and exports results to CSV + a JSON summary with preliminary evaluation.
 - Runs WS (controlled rate) and HTTP (simulated responses) sessions
 - Aggregates average metrics per session
 - Writes outputs to ./benchmarks/<timestamp>/{sessions.csv, summary.json}
*/

import fs from 'fs-extra';
import path from 'node:path';
import {
  ResourceMonitor,
  type SessionRecord,
} from '../services/ResourceMonitorService';

// Minimal fake Socket.IO to satisfy init() without real emissions
const fakeIo: any = {
  emit: () => {},
  of: () => ({ sockets: { size: 0 } }),
};

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

type RunCfg = {
  label: string;
  mode: 'ws' | 'polling';
  hz: number; // target frequency (msg/s or req/s)
  durationSec: number;
  payloadBytes: number; // assumed payload size in bytes
  loadCpuPct?: number; // optional background CPU load during session
  loadWorkers?: number; // optional number of load workers
  clientsHttp?: number; // number of synthetic HTTP pollers
  clientsWs?: number; // number of synthetic WS clients
  warmupSec?: number;
  cooldownSec?: number;
};

async function runWsControlled(cfg: RunCfg): Promise<SessionRecord> {
  const { label, hz, durationSec, payloadBytes, loadCpuPct, loadWorkers } = cfg;
  // Approximate N WS clients by increasing total emission rate proportionally
  const effHz = hz * Math.max(1, Math.floor(cfg.clientsWs ?? 1));
  const rec = ResourceMonitor.startSession({
    label,
    mode: 'ws',
    wsFixedRateHz: effHz,
    assumedPayloadBytes: payloadBytes,
    durationSec,
    warmupSec: cfg.warmupSec,
    cooldownSec: cfg.cooldownSec,
    loadCpuPct,
    loadWorkers,
    resetCounters: true,
  });
  // Wait for the duration + small buffer to ensure final tick
  await sleep(durationSec * 1000 + 600);
  ResourceMonitor.finishSession(rec.id);
  return ResourceMonitor.getSession(rec.id)!;
}

async function runHttpSimulated(cfg: RunCfg): Promise<SessionRecord> {
  const { label, hz, durationSec, payloadBytes, loadCpuPct, loadWorkers } = cfg;
  const periodMs = Math.max(50, Math.round(1000 / Math.max(0.001, hz)));
  const rec = ResourceMonitor.startSession({
    label,
    mode: 'polling',
    pollingIntervalMs: periodMs, // informational
    durationSec,
    warmupSec: cfg.warmupSec,
    cooldownSec: cfg.cooldownSec,
    loadCpuPct,
    loadWorkers,
    clientsHttp: Math.max(1, Math.floor(cfg.clientsHttp ?? 1)),
    internalHttpDriver: false,
    resetCounters: true,
  });
  // Simulate N parallel HTTP clients by spawning N timers
  const c = Math.max(1, Math.floor(cfg.clientsHttp ?? 1));
  const timers: NodeJS.Timeout[] = [];
  const doTick = () => {
    try {
      ResourceMonitor.onHttpResponse(payloadBytes);
      ResourceMonitor.setLastArduinoTimestamp(new Date().toISOString());
    } catch {}
  };
  for (let i = 0; i < c; i++) {
    const t = setInterval(doTick, periodMs);
    t.unref();
    timers.push(t);
  }
  await sleep(durationSec * 1000 + 600);
  for (const t of timers) clearInterval(t);
  ResourceMonitor.finishSession(rec.id);
  return ResourceMonitor.getSession(rec.id)!;
}

function summarizeSession(s: SessionRecord) {
  // Trim samples according to warmup/cooldown seconds (if provided)
  const warmupMs = Math.max(0, Math.floor((s.config.warmupSec || 0) * 1000));
  const cooldownMs = Math.max(
    0,
    Math.floor((s.config.cooldownSec || 0) * 1000),
  );
  const startAt = new Date(s.startedAt).getTime();
  const endAt = new Date(s.finishedAt || s.startedAt).getTime();
  const trimStart = startAt + warmupMs;
  const trimEnd = Math.max(trimStart, endAt - cooldownMs);
  const samples = s.samples.filter(sm => {
    const t = Date.parse(sm.ts);
    return Number.isFinite(t) && t >= trimStart && t <= trimEnd;
  });
  const n = samples.length || 1;
  // Aggregate metrics; compute rates as czasowo ważone i payload z całkowitych bajtów/zdarzeń
  const sum = samples.reduce(
    (acc, m) => {
      const dt = Math.max(0, (m.tickMs || 0) / 1000);
      acc.cpu += m.cpu;
      acc.rss += m.rssMB;
      acc.elu += m.elu;
      acc.p99 += m.elDelayP99Ms;
      acc.fresh += m.dataFreshnessMs;
      acc.dt += dt;
      if (s.config.mode === 'polling') {
        const rate = m.httpReqRate;
        const bytes = m.httpBytesRate;
        acc.rateTime += rate * dt;
        acc.bytesTime += bytes * dt;
        acc.jitter += m.httpJitterMs;
      } else {
        const rate = m.wsMsgRate;
        const bytes = m.wsBytesRate;
        acc.rateTime += rate * dt;
        acc.bytesTime += bytes * dt;
        acc.jitter += m.wsJitterMs;
      }
      return acc;
    },
    {
      cpu: 0,
      rss: 0,
      elu: 0,
      p99: 0,
      fresh: 0,
      jitter: 0,
      dt: 0,
      rateTime: 0,
      bytesTime: 0,
    } as {
      cpu: number;
      rss: number;
      elu: number;
      p99: number;
      fresh: number;
      jitter: number;
      dt: number;
      rateTime: number;
      bytesTime: number;
    },
  );
  const dtSum = Math.max(
    0.0001,
    sum.dt || (n * (samples[0]?.tickMs || 0)) / 1000,
  );
  const totalMsgsApprox = sum.rateTime; // bo rate [/s] * dt [s] => liczba zdarzeń
  const totalBytesApprox = sum.bytesTime; // bytesRate [B/s] * dt [s] => bajty
  const avgRate = totalMsgsApprox / dtSum;
  const avgBytesRate = totalBytesApprox / dtSum;
  const avgPayload =
    totalMsgsApprox > 0 ? totalBytesApprox / totalMsgsApprox : 0;
  const bytesPerUnit = avgPayload || avgBytesRate / Math.max(0.0001, avgRate);
  // Statistical measures (metrology)
  const rateSeries = samples.map(m =>
    s.config.mode === 'polling' ? m.httpReqRate : m.wsMsgRate,
  );
  const bytesSeries = samples.map(m =>
    s.config.mode === 'polling' ? m.httpBytesRate : m.wsBytesRate,
  );
  const mean = (a: number[]) =>
    a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const variance = (a: number[], mu: number) =>
    a.length > 1
      ? a.reduce((acc, v) => acc + (v - mu) * (v - mu), 0) / (a.length - 1)
      : 0;
  const stddev = (a: number[]) => Math.sqrt(variance(a, mean(a)));
  const rateStd = stddev(rateSeries);
  const bytesStd = stddev(bytesSeries);
  const ci95Rate =
    1.96 * (rateSeries.length ? rateStd / Math.sqrt(rateSeries.length) : 0);
  const ci95Bytes =
    1.96 * (bytesSeries.length ? bytesStd / Math.sqrt(bytesSeries.length) : 0);
  const median = (a: number[]) => {
    if (!a.length) return 0;
    const sorted = a.slice().sort((x, y) => x - y);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const trimmedMean = (a: number[], frac: number) => {
    if (!a.length) return 0;
    const sorted = a.slice().sort((x, y) => x - y);
    const k = Math.floor(sorted.length * frac);
    const trimmed = sorted.slice(k, sorted.length - k);
    return trimmed.length
      ? trimmed.reduce((x, y) => x + y, 0) / trimmed.length
      : mean(sorted);
  };
  const rateMedian = median(rateSeries);
  const bytesMedian = median(bytesSeries);
  const rateTrimmed = trimmedMean(rateSeries, 0.1);
  const bytesTrimmed = trimmedMean(bytesSeries, 0.1);
  const relCiRate = avgRate !== 0 ? ci95Rate / avgRate : 0;
  const relCiBytes = avgBytesRate !== 0 ? ci95Bytes / avgBytesRate : 0;
  return {
    id: s.id,
    label: s.config.label,
    mode: s.config.mode,
    clientsHttp: s.config.mode === 'polling' ? (s.config.clientsHttp ?? 0) : 0,
    clientsWs: s.config.mode === 'ws' ? (s.config.clientsWs ?? 0) : 0,
    loadCpuPct: Math.max(0, Math.floor(s.config.loadCpuPct || 0)),
    count: n,
    nUsed: n,
    nTotal: s.samples.length,
    warmupSec: s.config.warmupSec || 0,
    cooldownSec: s.config.cooldownSec || 0,
    avgCpu: sum.cpu / n,
    avgRss: sum.rss / n,
    avgElu: sum.elu / n,
    avgDelayP99: sum.p99 / n,
    avgRate,
    rateMedian,
    rateTrimmed,
    rateStd,
    ci95Rate,
    relCiRate,
    avgBytesRate,
    bytesMedian,
    bytesTrimmed,
    bytesStd,
    ci95Bytes,
    relCiBytes,
    avgPayload,
    bytesPerUnit,
    avgJitterMs: sum.jitter / n,
    avgFreshnessMs: sum.fresh / n,
  };
}

type Summary = ReturnType<typeof summarizeSession>;

function aggregateByLoad(summaries: Summary[]) {
  type Key = string;
  const acc = new Map<
    Key,
    {
      mode: 'ws' | 'polling';
      loadCpuPct: number;
      n: number;
      rate: number;
      bytes: number;
      payload: number;
      jitter: number;
      cpu: number;
      rss: number;
      delayP99: number;
      fresh: number;
    }
  >();
  for (const s of summaries) {
    const load = Math.max(0, Math.floor((s as any).loadCpuPct || 0));
    const key = `${s.mode}|${load}`;
    const cur = acc.get(key) || {
      mode: s.mode,
      loadCpuPct: load,
      n: 0,
      rate: 0,
      bytes: 0,
      payload: 0,
      jitter: 0,
      cpu: 0,
      rss: 0,
      delayP99: 0,
      fresh: 0,
    };
    cur.n += 1;
    cur.rate += s.avgRate;
    cur.bytes += s.avgBytesRate;
    cur.payload += s.avgPayload;
    cur.jitter += s.avgJitterMs;
    cur.cpu += s.avgCpu;
    cur.rss += s.avgRss;
    cur.delayP99 += s.avgDelayP99;
    cur.fresh += s.avgFreshnessMs;
    acc.set(key, cur);
  }
  const rows = Array.from(acc.values()).map(r => ({
    mode: r.mode,
    loadCpuPct: r.loadCpuPct,
    avgRate: r.rate / r.n,
    avgBytesRate: r.bytes / r.n,
    avgPayload: r.payload / r.n,
    avgJitterMs: r.jitter / r.n,
    avgCpu: r.cpu / r.n,
    avgRss: r.rss / r.n,
    avgDelayP99: r.delayP99 / r.n,
    avgFreshnessMs: r.fresh / r.n,
  }));
  // sort: mode (ws first), then load ascending
  rows.sort((a, b) =>
    a.mode === b.mode ? a.loadCpuPct - b.loadCpuPct : a.mode === 'ws' ? -1 : 1,
  );
  return rows;
}

function aggregateByClients(summaries: Summary[]) {
  type Key = string;
  const acc = new Map<
    Key,
    {
      mode: 'ws' | 'polling';
      clients: number; // clientsWs for ws, clientsHttp for polling
      n: number;
      rate: number;
      bytes: number;
      payload: number;
      jitter: number;
      cpu: number;
      rss: number;
      delayP99: number;
      fresh: number;
    }
  >();
  for (const s of summaries) {
    const clients =
      s.mode === 'ws'
        ? ((s as any).clientsWs ?? 0)
        : ((s as any).clientsHttp ?? 0);
    const key = `${s.mode}|${clients}`;
    const cur = acc.get(key) || {
      mode: s.mode,
      clients,
      n: 0,
      rate: 0,
      bytes: 0,
      payload: 0,
      jitter: 0,
      cpu: 0,
      rss: 0,
      delayP99: 0,
      fresh: 0,
    };
    cur.n += 1;
    cur.rate += s.avgRate;
    cur.bytes += s.avgBytesRate;
    cur.payload += s.avgPayload;
    cur.jitter += s.avgJitterMs;
    cur.cpu += s.avgCpu;
    cur.rss += s.avgRss;
    cur.delayP99 += s.avgDelayP99;
    cur.fresh += s.avgFreshnessMs;
    acc.set(key, cur);
  }
  const rows = Array.from(acc.values()).map(r => ({
    mode: r.mode,
    clients: r.clients,
    avgRate: r.rate / r.n,
    avgBytesRate: r.bytes / r.n,
    avgPayload: r.payload / r.n,
    avgJitterMs: r.jitter / r.n,
    avgCpu: r.cpu / r.n,
    avgRss: r.rss / r.n,
    avgDelayP99: r.delayP99 / r.n,
    avgFreshnessMs: r.fresh / r.n,
  }));
  rows.sort((a, b) =>
    a.mode === b.mode ? a.clients - b.clients : a.mode === 'ws' ? -1 : 1,
  );
  return rows;
}

function exportCsv(sessions: SessionRecord[], outFile: string) {
  const rows: string[] = [];
  const header = [
    'sessionId',
    'label',
    'mode',
    'startedAt',
    'finishedAt',
    'sampleIndex',
    'ts',
    'cpu',
    'rssMB',
    'heapUsedMB',
    'elu',
    'elDelayP99Ms',
    'httpReqRate',
    'wsMsgRate',
    'httpBytesRate',
    'wsBytesRate',
    'httpAvgBytesPerReq',
    'wsAvgBytesPerMsg',
    'httpJitterMs',
    'wsJitterMs',
    'tickMs',
    'dataFreshnessMs',
    'sourceTsMs',
    'ingestTsMs',
    'emitTsMs',
  ];
  rows.push(header.join(','));
  sessions.forEach(s => {
    s.samples.forEach((sample, idx) => {
      rows.push(
        [
          s.id,
          JSON.stringify(s.config.label),
          s.config.mode,
          s.startedAt,
          s.finishedAt || '',
          String(idx + 1),
          sample.ts,
          sample.cpu.toFixed(3),
          sample.rssMB.toFixed(3),
          sample.heapUsedMB.toFixed(3),
          sample.elu.toFixed(4),
          sample.elDelayP99Ms.toFixed(2),
          sample.httpReqRate.toFixed(3),
          sample.wsMsgRate.toFixed(3),
          sample.httpBytesRate.toFixed(3),
          sample.wsBytesRate.toFixed(3),
          sample.httpAvgBytesPerReq.toFixed(2),
          sample.wsAvgBytesPerMsg.toFixed(2),
          sample.httpJitterMs.toFixed(2),
          sample.wsJitterMs.toFixed(2),
          sample.tickMs.toFixed(0),
          sample.dataFreshnessMs.toFixed(0),
          sample.sourceTsMs != null ? String(sample.sourceTsMs) : '',
          sample.ingestTsMs != null ? String(sample.ingestTsMs) : '',
          sample.emitTsMs != null ? String(sample.emitTsMs) : '',
        ].join(','),
      );
    });
  });
  fs.writeFileSync(outFile, rows.join('\n'), 'utf8');
}

function evaluate(summaries: ReturnType<typeof summarizeSession>[]) {
  // Basic heuristics/thresholds for sanity checks
  const tolRate = 0.5; // ±50%
  const tolPayload = 0.5; // ±50%

  return summaries.map(s => {
    // Base expected rate from label, supports any number: WS@0.5Hz, WS@5Hz, etc.
    let expectedRateBase: number | undefined = undefined;
    const m = s.label.match(/@(\d+(?:\.\d+)?)Hz/);
    if (m) {
      const hz = Number(m[1]);
      if (Number.isFinite(hz) && hz > 0) expectedRateBase = hz;
    }
    const expectedPayload = s.label.includes('payload=')
      ? Number(s.label.split('payload=')[1].split('B')[0])
      : undefined;

    const checks: string[] = [];
    const flags: { rateOk?: boolean; payloadOk?: boolean } = {};
    // Scale expected rate by number of synthetic clients (if any)
    let scaledExpectedRate: number | undefined = expectedRateBase;
    if (expectedRateBase != null) {
      const clients =
        s.mode === 'ws'
          ? Math.max(1, Number((s as any).clientsWs ?? 1))
          : Math.max(1, Number((s as any).clientsHttp ?? 1));
      scaledExpectedRate = expectedRateBase * clients;
      const low = scaledExpectedRate * (1 - tolRate);
      const high = scaledExpectedRate * (1 + tolRate);
      checks.push(
        `rate=${s.avgRate.toFixed(2)} in [${low.toFixed(2)}, ${high.toFixed(2)}] (c=${clients})`,
      );
      flags.rateOk = s.avgRate >= low && s.avgRate <= high;
    }
    if (expectedPayload != null) {
      const low = expectedPayload * (1 - tolPayload);
      const high = expectedPayload * (1 + tolPayload);
      checks.push(
        `bytesPerUnit=${s.bytesPerUnit.toFixed(1)} in [${low.toFixed(1)}, ${high.toFixed(1)}]`,
      );
      flags.payloadOk = s.bytesPerUnit >= low && s.bytesPerUnit <= high;
    }
    return {
      ...s,
      checks,
      ...flags,
      expectedRate: scaledExpectedRate,
      expectedPayload,
      tolRate,
      tolPayload,
      achievedRel:
        scaledExpectedRate && scaledExpectedRate > 0
          ? s.avgRate / scaledExpectedRate
          : undefined,
    } as const;
  });
}

type MeasureOpts = {
  modes?: Array<'ws' | 'polling'>;
  hzSet?: number[];
  loadSet?: number[];
  durationSec?: number;
  tickMs?: number; // sets MONITOR_TICK_MS dynamically when provided
  clientsHttp?: number;
  clientsWs?: number;
  clientsHttpSet?: number[];
  clientsWsSet?: number[];
  workers?: number; // liczba wątków generatora obciążenia CPU
  warmupSec?: number;
  cooldownSec?: number;
  repeats?: number; // number of repetitions per scenario (>=1)
  payload?: number; // shared payload for WS/HTTP
  payloadWs?: number; // WS-specific payload
  payloadWs?: number; // WS-specific payload
  payloadHttp?: number; // HTTP-specific payload
  pair?: boolean; // paruj scenariusze WS/HTTP dla tych samych parametrów
};

export async function runMeasurements(opts: MeasureOpts = {}) {
  // Apply tick override before init
  if (opts.tickMs && Number.isFinite(opts.tickMs)) {
    (process.env as any).MONITOR_TICK_MS = String(opts.tickMs);
  }
  // Init monitor
  ResourceMonitor.init(fakeIo as any);
  ResourceMonitor.setLiveEmitEnabled(false);

  // Define runs: two per method
  const durationSec = Number(
    opts.durationSec ?? process.env.MEASURE_DURATION_SEC ?? '6',
  );
  const basePayload = Number(
    opts.payload ?? process.env.MEASURE_PAYLOAD ?? '360',
  );
  const wsPayload = Number(
    opts.payloadWs ?? process.env.MEASURE_PAYLOAD_WS ?? basePayload,
  );
  const httpPayload = Number(
    opts.payloadHttp ?? process.env.MEASURE_PAYLOAD_HTTP ?? basePayload,
  );
  const warmupSec = Number(
    opts.warmupSec ?? process.env.MEASURE_WARMUP_SEC ?? '0',
  );
  const cooldownSec = Number(
    opts.cooldownSec ?? process.env.MEASURE_COOLDOWN_SEC ?? '0',
  );
  // Optional background CPU load (env-driven)
  const LOAD_PCT = Number(process.env.MEASURE_LOAD_PCT || '0');
  const LOAD_WORKERS = Number(process.env.MEASURE_LOAD_WORKERS || '1');
  const CLI_WORKERS = Math.max(1, Number(opts.workers ?? LOAD_WORKERS));
  // Multiple loads: comma-separated list (e.g., "0,25,50")
  const LOAD_SET =
    opts.loadSet ??
    (process.env.MEASURE_LOAD_SET || '')
      .split(',')
      .map(s => Number(s.trim()))
      .filter(n => Number.isFinite(n));
  const loadLevels = LOAD_SET.length ? LOAD_SET : [LOAD_PCT || 0];
  // Synthetic clients
  // Clients: support single value or comma-separated set
  const CLIENTS_HTTP_SINGLE = Math.max(
    0,
    Number(opts.clientsHttp ?? process.env.MEASURE_CLIENTS_HTTP ?? '0'),
  );
  const CLIENTS_WS_SINGLE = Math.max(
    0,
    Number(opts.clientsWs ?? process.env.MEASURE_CLIENTS_WS ?? '0'),
  );
  const CH_SET = (
    opts.clientsHttpSet && opts.clientsHttpSet.length
      ? opts.clientsHttpSet
      : String(process.env.MEASURE_CLIENTS_HTTP_SET || '')
          .split(',')
          .map(s => Number(s.trim()))
          .filter(n => Number.isFinite(n))
  ).map(n => Math.max(0, Math.floor(n)));
  const CW_SET = (
    opts.clientsWsSet && opts.clientsWsSet.length
      ? opts.clientsWsSet
      : String(process.env.MEASURE_CLIENTS_WS_SET || '')
          .split(',')
          .map(s => Number(s.trim()))
          .filter(n => Number.isFinite(n))
  ).map(n => Math.max(0, Math.floor(n)));
  const pairRuns = Boolean(
    opts.pair ?? Number(process.env.MEASURE_PAIR || '0'),
  );
  const runs: RunCfg[] = [];
  // Filter by modes (e.g., MEASURE_MODES="ws,polling") and HZ set (e.g., "1,2")
  const MODES = (
    opts.modes ??
    ((process.env.MEASURE_MODES || 'ws,polling')
      .split(',')
      .map(s => s.trim()) as Array<'ws' | 'polling'>)
  ).filter(s => s === 'ws' || s === 'polling');
  const HZ_SET = (
    opts.hzSet ??
    (process.env.MEASURE_HZ_SET || '1,2').split(',').map(s => Number(s.trim()))
  ).filter(n => Number.isFinite(n) && n > 0);
  for (const lp of loadLevels) {
    const loadLabel = lp ? ` + load=${lp}%` : '';
    const wsClientsList = CW_SET.length ? CW_SET : [CLIENTS_WS_SINGLE];
    const httpClientsList = CH_SET.length ? CH_SET : [CLIENTS_HTTP_SINGLE];
    if (pairRuns) {
      for (const hz of HZ_SET) {
        const clientUnion = Array.from(
          new Set([...wsClientsList, ...httpClientsList]),
        );
        for (const c of clientUnion) {
          if (MODES.includes('ws') && wsClientsList.includes(c)) {
            runs.push({
              label: `WS@${hz}Hz payload=${wsPayload}B${loadLabel}${c ? ` cWs=${c}` : ''}`,
              mode: 'ws',
              hz,
              durationSec,
              payloadBytes: wsPayload,
              loadCpuPct: lp || undefined,
              loadWorkers: lp ? CLI_WORKERS : undefined,
              clientsWs: c || undefined,
              warmupSec: warmupSec || undefined,
              cooldownSec: cooldownSec || undefined,
            });
          }
          if (MODES.includes('polling') && httpClientsList.includes(c)) {
            runs.push({
              label: `HTTP@${hz}Hz payload=${httpPayload}B${loadLabel}${c ? ` cHttp=${c}` : ''}`,
              mode: 'polling',
              hz,
              durationSec,
              payloadBytes: httpPayload,
              loadCpuPct: lp || undefined,
              loadWorkers: lp ? CLI_WORKERS : undefined,
              clientsHttp: c || undefined,
              warmupSec: warmupSec || undefined,
              cooldownSec: cooldownSec || undefined,
            });
          }
        }
      }
    } else {
      if (MODES.includes('ws')) {
        for (const hz of HZ_SET) {
          for (const cWs of wsClientsList) {
            runs.push({
              label: `WS@${hz}Hz payload=${wsPayload}B${loadLabel}${cWs ? ` cWs=${cWs}` : ''}`,
              mode: 'ws',
              hz,
              durationSec,
              payloadBytes: wsPayload,
              loadCpuPct: lp || undefined,
              loadWorkers: lp ? CLI_WORKERS : undefined,
              clientsWs: cWs || undefined,
              warmupSec: warmupSec || undefined,
              cooldownSec: cooldownSec || undefined,
            });
          }
        }
      }
      if (MODES.includes('polling')) {
        for (const hz of HZ_SET) {
          for (const cHttp of httpClientsList) {
            runs.push({
              label: `HTTP@${hz}Hz payload=${httpPayload}B${loadLabel}${cHttp ? ` cHttp=${cHttp}` : ''}`,
              mode: 'polling',
              hz,
              durationSec,
              payloadBytes: httpPayload,
              loadCpuPct: lp || undefined,
              loadWorkers: lp ? CLI_WORKERS : undefined,
              clientsHttp: cHttp || undefined,
              warmupSec: warmupSec || undefined,
              cooldownSec: cooldownSec || undefined,
            });
          }
        }
      }
    }
  }

  const sessions: SessionRecord[] = [];
  const repeats = Math.max(
    1,
    Number(opts.repeats ?? process.env.MEASURE_REPEATS ?? '1'),
  );
  for (const r of runs) {
    console.log(`[Measure] Starting ${r.label} ...`);
    for (let i = 0; i < repeats; i++) {
      const sess =
        r.mode === 'ws' ? await runWsControlled(r) : await runHttpSimulated(r);
      console.log(
        `[Measure] Finished ${r.label} [rep ${i + 1}/${repeats}] (samples=${sess.samples.length})`,
      );
      sessions.push(sess);
      await sleep(300); // small separation between reps
    }
    await sleep(500); // separation between scenarios
  }

  // Summaries and evaluation
  const summaries = sessions.map(summarizeSession);
  const evaluated = evaluate(summaries);
  const byLoad = aggregateByLoad(evaluated as any);
  const byClients = aggregateByClients(evaluated as any);

  const fairPayloadFlag = wsPayload === httpPayload;
  const ratios = evaluated
    .map(s =>
      s.expectedRate && s.expectedRate > 0
        ? s.avgRate / s.expectedRate
        : Number.NaN,
    )
    .filter(r => Number.isFinite(r)) as number[];
  const sourceLimitedFlag =
    ratios.length > 0 &&
    ratios.filter(r => r < 0.5).length / ratios.length >= 0.7;
  const flags = { fairPayload: fairPayloadFlag, sourceLimited: sourceLimitedFlag };
  if (!fairPayloadFlag) {
    console.warn('[Measure] Uwaga: payload WS ≠ HTTP; porównania mogą być nie fair');
  }

  // Output directory
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(process.cwd(), 'benchmarks', ts);
  await fs.mkdirp(outDir);

  // Export CSV and JSON
  const csvPath = path.join(outDir, 'sessions.csv');
  const summaryPath = path.join(outDir, 'summary.json');
  exportCsv(sessions, csvPath);
  const runConfig = {
    modes: MODES,
    hzSet: HZ_SET,
    loadSet: loadLevels,
    durationSec,
    monitorTickMs: Number(process.env.MONITOR_TICK_MS || '1000'),
    clientsHttp: CH_SET.length ? CH_SET[0] : CLIENTS_HTTP_SINGLE,
    clientsWs: CW_SET.length ? CW_SET[0] : CLIENTS_WS_SINGLE,
    wsPayload,
    httpPayload,
    warmupSec,
    cooldownSec,
    repeats,
    pair: pairRuns,
  };
  await fs.writeJSON(
    summaryPath,
    {
      summaries: evaluated,
      byLoad,
      byClients,
      flags,
      runConfig,
      units: {
        rate: '/s',
        bytesRate: 'B/s',
        payload: 'B',
        jitter: 'ms',
        staleness: 'ms',
        tick: 'ms',
        elDelayP99: 'ms',
        cpu: '%',
        rss: 'MB',
      },
    },
    { spaces: 2 },
  );

  // Export by-load CSV
  const byLoadCsv = [
    'mode,loadCpuPct,avgRate,avgBytesRate,avgPayload,avgJitterMs,avgCpu,avgRss,avgDelayP99,avgFreshnessMs',
  ];
  for (const r of byLoad) {
    byLoadCsv.push(
      [
        r.mode,
        r.loadCpuPct,
        r.avgRate.toFixed(3),
        r.avgBytesRate.toFixed(0),
        r.avgPayload.toFixed(1),
        r.avgJitterMs.toFixed(1),
        r.avgCpu.toFixed(1),
        r.avgRss.toFixed(1),
        r.avgDelayP99.toFixed(1),
        r.avgFreshnessMs.toFixed(0),
      ].join(','),
    );
  }
  const byLoadPath = path.join(outDir, 'by_load.csv');
  await fs.writeFile(byLoadPath, byLoadCsv.join('\n'), 'utf8');

  // Export by-clients CSV
  const byClientsCsv = [
    'mode,clients,avgRate,avgBytesRate,avgPayload,avgJitterMs,avgCpu,avgRss,avgDelayP99,avgFreshnessMs',
  ];
  for (const r of byClients) {
    byClientsCsv.push(
      [
        r.mode,
        r.clients,
        r.avgRate.toFixed(3),
        r.avgBytesRate.toFixed(0),
        r.avgPayload.toFixed(1),
        r.avgJitterMs.toFixed(1),
        r.avgCpu.toFixed(1),
        r.avgRss.toFixed(1),
        r.avgDelayP99.toFixed(1),
        r.avgFreshnessMs.toFixed(0),
      ].join(','),
    );
  }
  const byClientsPath = path.join(outDir, 'by_clients.csv');
  await fs.writeFile(byClientsPath, byClientsCsv.join('\n'), 'utf8');

  // Generate README.md with documentation and preliminary evaluation
  const readmePath = path.join(outDir, 'README.md');
  const readme = renderReadme(
    evaluated,
    {
      outDir,
      csvFile: 'sessions.csv',
      summaryFile: 'summary.json',
      durationSec,
    },
    byLoad,
    byClients,
    runConfig,
  );
  await fs.writeFile(readmePath, readme, 'utf8');

  // Console summary
  console.log('\n[Measure] Summary');
  for (const s of evaluated) {
    console.log(
      `- ${s.label} [${s.mode}] :: rate ${s.avgRate.toFixed(2)}/s, B/s ${s.avgBytesRate.toFixed(0)}, payload≈${s.avgPayload.toFixed(1)}, jitter ${s.avgJitterMs.toFixed(1)} ms, fresh ${s.avgFreshnessMs.toFixed(0)} ms | checks: ${s.checks.join('; ')}`,
    );
  }

  // Clean up timers/workers to avoid leaks in tests/CI
  ResourceMonitor.shutdown();
  return { outDir, evaluated, flags } as const;
}
// Execute as CLI when run directly
if (require.main === module) {
  // Minimal CLI args parsing to avoid PowerShell env quirks.
  // Usage examples:
  //   yarn measure -- --modes ws,polling --hz 1,2 --load 0,25,50 --dur 3 --tick 200
  const argv = process.argv.slice(2);
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const modesArg = get('modes');
  const hzArg = get('hz');
  const loadArg = get('load');
  const durArg = get('dur');
  const tickArg = get('tick');
  const cHttpArg = get('clientsHttp');
  const cWsArg = get('clientsWs');
  const warmArg = get('warmup');
  const coolArg = get('cooldown');
  const workersArg = get('workers');
  const repeatsArg = get('repeats');
  const payloadArg = get('payload');
  const payloadWsArg = get('payloadWs');
  const payloadHttpArg = get('payloadHttp');
  const pairFlag = argv.includes('--pair');

  const cliOpts: MeasureOpts = {
    modes: modesArg
      ? (modesArg.split(',').map(s => s.trim()) as Array<'ws' | 'polling'>)
      : undefined,
    hzSet: hzArg
      ? hzArg
          .split(',')
          .map(s => Number(s.trim()))
          .filter(n => Number.isFinite(n) && n > 0)
      : undefined,
    loadSet: loadArg
      ? loadArg
          .split(',')
          .map(s => Number(s.trim()))
          .filter(n => Number.isFinite(n))
      : undefined,
    durationSec: durArg ? Number(durArg) : undefined,
    tickMs: tickArg ? Number(tickArg) : undefined,
    clientsHttp:
      cHttpArg && !cHttpArg.includes(',') ? Number(cHttpArg) : undefined,
    clientsWs: cWsArg && !cWsArg.includes(',') ? Number(cWsArg) : undefined,
    clientsHttpSet:
      cHttpArg && cHttpArg.includes(',')
        ? cHttpArg
            .split(',')
            .map(s => Number(s.trim()))
            .filter(n => Number.isFinite(n))
        : undefined,
    clientsWsSet:
      cWsArg && cWsArg.includes(',')
        ? cWsArg
            .split(',')
            .map(s => Number(s.trim()))
            .filter(n => Number.isFinite(n))
        : undefined,
    workers: workersArg ? Number(workersArg) : undefined,
    warmupSec: warmArg ? Number(warmArg) : undefined,
    cooldownSec: coolArg ? Number(coolArg) : undefined,
    repeats: repeatsArg ? Number(repeatsArg) : undefined,
    payload: payloadArg ? Number(payloadArg) : undefined,
    payloadWs: payloadWsArg ? Number(payloadWsArg) : undefined,
    payloadHttp: payloadHttpArg ? Number(payloadHttpArg) : undefined,
    pair: pairFlag,
  };

  runMeasurements(cliOpts)
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[Measure] Error:', err);
      process.exit(1);
    });
}

function renderReadme(
  evaluated: ReturnType<typeof evaluate>,
  opts: {
    outDir: string;
    csvFile: string;
    summaryFile: string;
    durationSec: number;
  },
  byLoad: ReturnType<typeof aggregateByLoad>,
  byClients: ReturnType<typeof aggregateByClients>,
  runConfig: {
    modes: Array<'ws' | 'polling'>;
    hzSet: number[];
    loadSet: number[];
    durationSec: number;
    monitorTickMs: number;
    clientsHttp: number;
    clientsWs: number;
    wsPayload: number;
    httpPayload: number;
    warmupSec: number;
    cooldownSec: number;
  },
) {
  const tsName = path.basename(opts.outDir);
  // Sort rows for deterministic, readable order
  const parseHz = (label: string): number => {
    const m = label.match(/@(\d+(?:\.\d+)?)Hz/);
    return m ? Number(m[1]) : Number.NaN;
  };
  const getClients = (s: any): number =>
    s.mode === 'ws' ? Number(s.clientsWs ?? 0) : Number(s.clientsHttp ?? 0);
  const rows = evaluated
    .slice()
    .sort((a, b) => {
      if (a.mode !== b.mode) return a.mode === 'ws' ? -1 : 1;
      const ha = parseHz(a.label);
      const hb = parseHz(b.label);
      if (Number.isFinite(ha) && Number.isFinite(hb) && ha !== hb)
        return ha - hb;
      const la = Number((a as any).loadCpuPct ?? 0);
      const lb = Number((b as any).loadCpuPct ?? 0);
      if (la !== lb) return la - lb;
      const ca = getClients(a as any);
      const cb = getClients(b as any);
      if (ca !== cb) return ca - cb;
      return String(a.label).localeCompare(String(b.label));
    })
    .map(s => {
      const rateOk = s.expectedRate != null ? (s as any).rateOk : undefined;
      const payloadOk =
        s.expectedPayload != null ? (s as any).payloadOk : undefined;
      const rateBadge = rateOk === undefined ? '—' : rateOk ? '✅' : '❌';
      const payloadBadge =
        payloadOk === undefined ? '—' : payloadOk ? '✅' : '❌';
      const nUsed = (s as any).nUsed ?? s.count;
      const nTotal = (s as any).nTotal ?? s.count;
      return `| ${s.label} | ${s.mode} | ${s.avgRate.toFixed(2)} | ${s.avgBytesRate.toFixed(0)} | ${s.avgPayload.toFixed(0)} | ${s.avgJitterMs.toFixed(1)} | ${s.avgFreshnessMs.toFixed(0)} | ${s.avgDelayP99.toFixed(1)} | ${s.avgCpu.toFixed(1)} | ${s.avgRss.toFixed(1)} | ${nUsed}/${nTotal} | ${rateBadge} | ${payloadBadge} |`;
    })
    .join('\n');

  const table = `| Label | Mode | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | Staleness [ms] | ELU p99 [ms] | CPU [%] | RSS [MB] | n (used/total) | Rate OK | Payload OK |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--:|:--:|:--:|
${rows}`;

  const csvDict = `
      sessionId — identyfikator sesji
      label — etykieta (zawiera Hz i payload użyte do oczekiwań)
      Staleness [ms] — wiek danych: czas od ostatniego odczytu (niżej = świeższe; WS zwykle świeższe niż HTTP).
      startedAt/finishedAt — znaczniki czasu
      sampleIndex/ts — indeks i czas próbki
      cpu — obciążenie procesu Node [%]
      rssMB/heapUsedMB — pamięć (RSS, sterta)
      elu — Event Loop Utilization (0..1)
      elDelayP99Ms — opóźnienie pętli zdarzeń (p99) [ms]
      httpReqRate/wsMsgRate — częstość żądań/wiadomości [/s]
      httpBytesRate/wsBytesRate — przepustowość [B/s]
      httpAvgBytesPerReq/wsAvgBytesPerMsg — średni ładunek [B]
      httpJitterMs/wsJitterMs — zmienność odstępów (stddev) [ms]
      tickMs — realny odstęp między próbkami mierzony monotonicznie [ms]
      dataFreshnessMs — Staleness (wiek danych): czas od ostatniego odczytu [ms]
  `;

  const dashboardMap = `
  - Częstość (Rate) — odpowiada wykresom częstości WS/HTTP w dashboardzie.
  - Bytes/s i ~Payload — odpowiada wykresom przepustowości i średniego rozmiaru ładunku.
  - Jitter — odpowiada wskaźnikowi stabilności sygnału (niższy lepszy).
  - Wiek danych — czas od ostatniego odczytu (niższy lepszy, WS zwykle świeższy niż HTTP).
`;

  const howToRead = `
 - n (użyte/łącznie) — liczba próbek wykorzystanych do średnich po odrzuceniu warmup/cooldown vs. całkowita.
`;

  const params = `
 - Czas pojedynczej sesji: ~${opts.durationSec}s (+bufor). Warmup=${runConfig.warmupSec || 0}s, Cooldown=${runConfig.cooldownSec || 0}s (próbki w tych oknach nie wchodzą do średnich).
 - Obciążenie CPU (opcjonalne): ustaw przez env MEASURE_LOAD_PCT (0..100) i MEASURE_LOAD_WORKERS (domyślnie 1). Jeśli >0, włączany jest lekki generator obciążenia (worker_threads) na czas sesji.
 - Wiele obciążeń: MEASURE_LOAD_SET (np. "0,25,50") uruchomi komplet przebiegów dla każdego poziomu.
 - Liczba klientów: MEASURE_CLIENTS_HTTP (polling) oraz MEASURE_CLIENTS_WS (WebSocket) — syntetyczni klienci uruchamiani wewnętrznie.
  - Trimming: --warmup [s], --cooldown [s] (lub MEASURE_WARMUP_SEC, MEASURE_COOLDOWN_SEC) — pozwala odrzucić próbki rozgrzewki/wyciszania przy agregacji.

Przyjęte ustawienia tego runu:
 - Metody: ${runConfig.modes.join(', ')}
 - Częstotliwości [Hz]: ${runConfig.hzSet.join(', ')}
 - Obciążenia CPU [%]: ${runConfig.loadSet.join(', ')}
 - Czas sesji [s]: ${runConfig.durationSec}
 - MONITOR_TICK_MS: ${runConfig.monitorTickMs} (okres próbkowania monitora; domyślnie 1000 ms w aplikacji, w badaniach zwykle 200–250 ms)
 - Payloady: WS=${runConfig.wsPayload}B, HTTP=${runConfig.httpPayload}B
 - Klienci: clientsHttp=${runConfig.clientsHttp}, clientsWs=${runConfig.clientsWs}
 - Warmup/Cooldown [s]: ${runConfig.warmupSec || 0} / ${runConfig.cooldownSec || 0}
`;

  return `# Raport pomiarów — ${tsName}

Ten folder zawiera surowe próbki (CSV) oraz podsumowanie z wstępną oceną.

 - Plik CSV: ./${opts.csvFile}
 - Podsumowanie JSON: ./${opts.summaryFile}
 - Uśrednione wyniki wg obciążenia: ./by_load.csv
 - Uśrednione wyniki wg liczby klientów: ./by_clients.csv

## Podsumowanie (średnie)

${table}

Legenda: Rate OK / Payload OK — wstępna ocena względem oczekiwań (±50%).

## Jak czytać wyniki i powiązanie z dashboardem

${dashboardMap}

## Słownik kolumn CSV

${csvDict}

## Parametry i założenia

${params}

## Metrologia (95% CI)

Niepewność średnich (95% CI) dla kluczowych wielkości na sesję. Tick próbkowania ≈ ${runConfig.monitorTickMs} ms (sterowany przez \`MONITOR_TICK_MS\`).

| Label | n (used/total) | Rate [/s] | CI95 Rate | σ(rate) | Bytes/s | CI95 Bytes | σ(bytes) |
|---|:--:|---:|---:|---:|---:|---:|---:|
${evaluated
  .map(s => {
    const nUsed = (s as any).nUsed ?? s.count;
    const nTotal = (s as any).nTotal ?? s.count;
    const ciRate = (s as any).ci95Rate ?? 0;
    const ciBytes = (s as any).ci95Bytes ?? 0;
    const rateStd = (s as any).rateStd ?? 0;
    const bytesStd = (s as any).bytesStd ?? 0;
    return `| ${s.label} | ${nUsed}/${nTotal} | ${s.avgRate.toFixed(2)} | ± ${ciRate.toFixed(2)} | ${rateStd.toFixed(2)} | ${s.avgBytesRate.toFixed(0)} | ± ${ciBytes.toFixed(0)} | ${bytesStd.toFixed(0)} |`;
  })
  .join('\n')}

## Porównanie wg obciążenia (przegląd)

Poniżej zestawiono średnie metryki zagregowane per metoda i poziom obciążenia CPU. Dają szybki pogląd, jak WS i HTTP skaluje się wraz z obciążeniem tła.

${renderByLoadTables(byLoad)}

## Porównanie wg liczby klientów (przegląd)

Poniżej zestawiono średnie metryki zagregowane per metoda i liczba klientów syntetycznych.

${renderByClientsTables(byClients)}

## Wnioski (syntetyczne)

${evaluated.map(s => `- ${s.label}: ${s.checks.join('; ')}`).join('\n')}

## Kontrola jakości i wiarygodność

- Sesje są izolowane: resetCounters=true (liczniki) oraz reset rolling (jitter, EL delay, ELU baseline) na starcie.
- Agregacja uwzględnia trimming warmup/cooldown (jeśli ustawione), co stabilizuje średnie.
- Podajemy n (użyte/łącznie), 95% CI i tickMs, by pokazać niepewność estymacji i odstępy próbkowania.
`;
}

function renderByLoadTables(rows: ReturnType<typeof aggregateByLoad>) {
  const fmt = (n: number, f = 1) => n.toFixed(f);
  const header = `| Obciążenie | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | ELU p99 [ms] | CPU [%] | RSS [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|`;
  const render = (mode: 'ws' | 'polling') => {
    const modeRows = rows.filter(r => r.mode === mode);
    const lines = modeRows
      .map(
        r =>
          `| ${r.loadCpuPct}% | ${fmt(r.avgRate, 2)} | ${fmt(r.avgBytesRate, 0)} | ${fmt(r.avgPayload, 0)} | ${fmt(r.avgJitterMs, 1)} | ${fmt(r.avgDelayP99, 1)} | ${fmt(r.avgCpu, 1)} | ${fmt(r.avgRss, 1)} |`,
      )
      .join('\n');
    const title = mode === 'ws' ? 'WebSocket' : 'HTTP polling';
    return `### ${title}

${header}
${lines}
`;
  };
  return `${render('ws')}
${render('polling')}`;
}

function renderByClientsTables(rows: ReturnType<typeof aggregateByClients>) {
  const fmt = (n: number, f = 1) => n.toFixed(f);
  const header = `| Klienci | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | ELU p99 [ms] | CPU [%] | RSS [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|`;
  const render = (mode: 'ws' | 'polling') => {
    const modeRows = rows.filter(r => r.mode === mode);
    const lines = modeRows
      .map(
        r =>
          `| ${r.clients} | ${fmt(r.avgRate, 2)} | ${fmt(r.avgBytesRate, 0)} | ${fmt(r.avgPayload, 0)} | ${fmt(r.avgJitterMs, 1)} | ${fmt(r.avgDelayP99, 1)} | ${fmt(r.avgCpu, 1)} | ${fmt(r.avgRss, 1)} |`,
      )
      .join('\n');
    const title = mode === 'ws' ? 'WebSocket' : 'HTTP polling';
    return `### ${title}

${header}
${lines}
`;
  };
  return `${render('ws')}
${render('polling')}`;
}
