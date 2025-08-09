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
};

async function runWsControlled(cfg: RunCfg): Promise<SessionRecord> {
  const { label, hz, durationSec, payloadBytes, loadCpuPct, loadWorkers } = cfg;
  const rec = ResourceMonitor.startSession({
    label,
    mode: 'ws',
    wsFixedRateHz: hz,
    assumedPayloadBytes: payloadBytes,
    durationSec,
    loadCpuPct,
    loadWorkers,
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
    loadCpuPct,
    loadWorkers,
  });
  const timer = setInterval(() => {
    try {
      ResourceMonitor.onHttpResponse(payloadBytes);
      ResourceMonitor.setLastArduinoTimestamp(new Date().toISOString());
    } catch {}
  }, periodMs);
  timer.unref();
  await sleep(durationSec * 1000 + 600);
  clearInterval(timer);
  ResourceMonitor.finishSession(rec.id);
  return ResourceMonitor.getSession(rec.id)!;
}

function summarizeSession(s: SessionRecord) {
  const n = s.samples.length || 1;
  const sum = s.samples.reduce(
    (acc, m) => {
      acc.cpu += m.cpu;
      acc.rss += m.rssMB;
      acc.elu += m.elu;
      acc.p99 += m.elDelayP99Ms;
      acc.fresh += m.dataFreshnessMs;
      if (s.config.mode === 'polling') {
        acc.rate += m.httpReqRate;
        acc.bytes += m.httpBytesRate;
        acc.payload += m.httpAvgBytesPerReq;
        acc.jitter += m.httpJitterMs;
      } else {
        acc.rate += m.wsMsgRate;
        acc.bytes += m.wsBytesRate;
        acc.payload += m.wsAvgBytesPerMsg;
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
      rate: 0,
      bytes: 0,
      payload: 0,
      jitter: 0,
    },
  );
  const avgRate = sum.rate / n;
  const avgBytesRate = sum.bytes / n;
  const avgPayload = sum.payload / n;
  const bytesPerUnit = avgBytesRate / Math.max(0.0001, avgRate);
  // Statistical measures (metrology)
  const rateSeries = s.samples.map(m =>
    s.config.mode === 'polling' ? m.httpReqRate : m.wsMsgRate,
  );
  const bytesSeries = s.samples.map(m =>
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
  return {
    id: s.id,
    label: s.config.label,
    mode: s.config.mode,
    loadCpuPct: Math.max(0, Math.floor(s.config.loadCpuPct || 0)),
    count: n,
    avgCpu: sum.cpu / n,
    avgRss: sum.rss / n,
    avgElu: sum.elu / n,
    avgDelayP99: sum.p99 / n,
    avgRate,
    rateStd,
    ci95Rate,
    avgBytesRate,
    bytesStd,
    ci95Bytes,
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
    'dataFreshnessMs',
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
          sample.dataFreshnessMs.toFixed(0),
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
    const expectedRate = s.label.includes('@1Hz')
      ? 1
      : s.label.includes('@2Hz')
        ? 2
        : undefined;
    const expectedPayload = s.label.includes('payload=')
      ? Number(s.label.split('payload=')[1].split('B')[0])
      : undefined;

    const checks: string[] = [];
    const flags: { rateOk?: boolean; payloadOk?: boolean } = {};
    if (expectedRate) {
      const low = expectedRate * (1 - tolRate);
      const high = expectedRate * (1 + tolRate);
      checks.push(
        `rate=${s.avgRate.toFixed(2)} in [${low.toFixed(2)}, ${high.toFixed(2)}]`,
      );
      flags.rateOk = s.avgRate >= low && s.avgRate <= high;
    }
    if (expectedPayload) {
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
      expectedRate,
      expectedPayload,
      tolRate,
      tolPayload,
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
  const wsPayload = 360;
  const httpPayload = 420;
  // Optional background CPU load (env-driven)
  const LOAD_PCT = Number(process.env.MEASURE_LOAD_PCT || '0');
  const LOAD_WORKERS = Number(process.env.MEASURE_LOAD_WORKERS || '1');
  // Multiple loads: comma-separated list (e.g., "0,25,50")
  const LOAD_SET =
    opts.loadSet ??
    (process.env.MEASURE_LOAD_SET || '')
      .split(',')
      .map(s => Number(s.trim()))
      .filter(n => Number.isFinite(n));
  const loadLevels = LOAD_SET.length ? LOAD_SET : [LOAD_PCT || 0];
  // Synthetic clients
  const CLIENTS_HTTP = Math.max(
    0,
    Number(opts.clientsHttp ?? process.env.MEASURE_CLIENTS_HTTP ?? '0'),
  );
  const CLIENTS_WS = Math.max(
    0,
    Number(opts.clientsWs ?? process.env.MEASURE_CLIENTS_WS ?? '0'),
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
    // WS
    if (MODES.includes('ws')) {
      for (const hz of HZ_SET) {
        runs.push({
          label: `WS@${hz}Hz payload=360B${loadLabel}${CLIENTS_WS ? ` cWs=${CLIENTS_WS}` : ''}`,
          mode: 'ws',
          hz,
          durationSec,
          payloadBytes: wsPayload,
          loadCpuPct: lp || undefined,
          loadWorkers: lp ? LOAD_WORKERS : undefined,
          clientsWs: CLIENTS_WS || undefined,
        });
      }
    }
    // HTTP
    if (MODES.includes('polling')) {
      for (const hz of HZ_SET) {
        runs.push({
          label: `HTTP@${hz}Hz payload=420B${loadLabel}${CLIENTS_HTTP ? ` cHttp=${CLIENTS_HTTP}` : ''}`,
          mode: 'polling',
          hz,
          durationSec,
          payloadBytes: httpPayload,
          loadCpuPct: lp || undefined,
          loadWorkers: lp ? LOAD_WORKERS : undefined,
          clientsHttp: CLIENTS_HTTP || undefined,
        });
      }
    }
  }

  const sessions: SessionRecord[] = [];
  for (const r of runs) {
    console.log(`[Measure] Starting ${r.label} ...`);
    const sess =
      r.mode === 'ws' ? await runWsControlled(r) : await runHttpSimulated(r);
    console.log(
      `[Measure] Finished ${r.label} (samples=${sess.samples.length})`,
    );
    sessions.push(sess);
    await sleep(500); // small separation
  }

  // Summaries and evaluation
  const summaries = sessions.map(summarizeSession);
  const evaluated = evaluate(summaries);
  const byLoad = aggregateByLoad(evaluated as any);

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
    clientsHttp: CLIENTS_HTTP,
    clientsWs: CLIENTS_WS,
    wsPayload,
    httpPayload,
  };
  await fs.writeJSON(
    summaryPath,
    {
      summaries: evaluated,
      byLoad,
      runConfig,
      units: {
        rate: '/s',
        bytesRate: 'B/s',
        payload: 'B',
        jitter: 'ms',
        freshness: 'ms',
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
  return { outDir, evaluated } as const;
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
    clientsHttp: cHttpArg ? Number(cHttpArg) : undefined,
    clientsWs: cWsArg ? Number(cWsArg) : undefined,
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
  },
) {
  const tsName = path.basename(opts.outDir);
  const rows = evaluated
    .map(s => {
      const rateOk = s.expectedRate != null ? (s as any).rateOk : undefined;
      const payloadOk =
        s.expectedPayload != null ? (s as any).payloadOk : undefined;
      const rateBadge = rateOk === undefined ? '—' : rateOk ? '✅' : '❌';
      const payloadBadge =
        payloadOk === undefined ? '—' : payloadOk ? '✅' : '❌';
      return `| ${s.label} | ${s.mode} | ${s.avgRate.toFixed(2)} | ${s.avgBytesRate.toFixed(0)} | ${s.avgPayload.toFixed(0)} | ${s.avgJitterMs.toFixed(1)} | ${s.avgFreshnessMs.toFixed(0)} | ${s.avgDelayP99.toFixed(1)} | ${s.avgCpu.toFixed(1)} | ${s.avgRss.toFixed(1)} | ${rateBadge} | ${payloadBadge} |`;
    })
    .join('\n');

  const table = `| Label | Mode | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | Świeżość [ms] | ELU p99 [ms] | CPU [%] | RSS [MB] | Rate OK | Payload OK |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--:|:--:|
${rows}`;

  const csvDict = `
- sessionId — identyfikator sesji
- label — etykieta (zawiera Hz i payload użyte do oczekiwań)
- mode — 'ws' lub 'polling'
- startedAt/finishedAt — znaczniki czasu
- sampleIndex/ts — indeks i czas próbki
- cpu — obciążenie procesu Node [%]
- rssMB/heapUsedMB — pamięć (RSS, sterta)
- elu — Event Loop Utilization (0..1)
- elDelayP99Ms — opóźnienie pętli zdarzeń (p99) [ms]
- httpReqRate/wsMsgRate — częstość żądań/wiadomości [/s]
- httpBytesRate/wsBytesRate — przepustowość [B/s]
- httpAvgBytesPerReq/wsAvgBytesPerMsg — średni ładunek [B]
- httpJitterMs/wsJitterMs — zmienność odstępów (stddev) [ms]
- dataFreshnessMs — świeżość danych (czas od ostatniego pomiaru) [ms]
`;

  const dashboardMap = `
- Częstość (Rate) — odpowiada wykresom częstości WS/HTTP w dashboardzie.
- Bytes/s i ~Payload — odpowiada wykresom przepustowości i średniego rozmiaru ładunku.
- Jitter — odpowiada wskaźnikowi stabilności sygnału (niższy lepszy).
- Świeżość danych — czas od ostatniego odczytu (niższy lepszy, WS zwykle świeższy niż HTTP).
- ELU p99 — 99. percentyl opóźnienia pętli zdarzeń (skorelowany z responsywnością backendu).
- CPU/RSS — metryki systemowe w panelu zasobów.
`;

  const howToRead = `
- Rate OK — czy średnia częstość mieści się w tolerancji oczekiwanej wartości (±50%).
- Payload OK — czy bytesPerUnit ≈ zakładany payload (±50%).
- Tolerancje można zaostrzyć w skrypcie measurementRunner.ts (sekcja evaluate).
`;

  const params = `
- Czas pojedynczej sesji: ~${opts.durationSec}s (+bufor).
- WS: sterownik o stałej częstotliwości (wsFixedRateHz).
- HTTP: symulacja odpowiedzi (onHttpResponse) z określonym payloadem.
- Emisje na żywo: wyłączone na czas pomiarów (izolacja), kontrola przez ResourceMonitor.
 - Obciążenie CPU (opcjonalne): ustaw przez env MEASURE_LOAD_PCT (0..100) i MEASURE_LOAD_WORKERS (domyślnie 1). Jeśli >0, włączany jest lekki generator obciążenia (worker_threads) na czas sesji.
 - Wiele obciążeń: MEASURE_LOAD_SET (np. "0,25,50") uruchomi komplet przebiegów dla każdego poziomu.
 - Liczba klientów: MEASURE_CLIENTS_HTTP (polling) oraz MEASURE_CLIENTS_WS (WebSocket) — syntetyczni klienci uruchamiani wewnętrznie.

Przyjęte ustawienia tego runu:
- Metody: ${runConfig.modes.join(', ')}
- Częstotliwości [Hz]: ${runConfig.hzSet.join(', ')}
- Obciążenia CPU [%]: ${runConfig.loadSet.join(', ')}
- Czas sesji [s]: ${runConfig.durationSec}
- MONITOR_TICK_MS: ${runConfig.monitorTickMs}
- Payloady: WS=${runConfig.wsPayload}B, HTTP=${runConfig.httpPayload}B
- Klienci: clientsHttp=${runConfig.clientsHttp}, clientsWs=${runConfig.clientsWs}
`;

  return `# Raport pomiarów — ${tsName}

Ten folder zawiera surowe próbki (CSV) oraz podsumowanie z wstępną oceną.

- Plik CSV: ./${opts.csvFile}
- Podsumowanie JSON: ./${opts.summaryFile}
 - Agregaty wg obciążenia: ./by_load.csv

## Podsumowanie (średnie)

${table}

Legenda: Rate OK / Payload OK — wstępna ocena względem oczekiwań (±50%).

## Jak czytać wyniki i powiązanie z dashboardem

${dashboardMap}

## Słownik kolumn CSV

${csvDict}

## Parametry i założenia

${params}

## Metrologia (statystyki)

Poniżej przedstawiono niepewność średnich (95% CI) dla kluczowych wielkości w każdej sesji, wyliczoną z próbek (tick ≈ ${process.env.MONITOR_TICK_MS || '1000'} ms):

${evaluated
  .map(
    s =>
      `- ${s.label} — n=${s.count}, Rate=${s.avgRate.toFixed(2)} ± ${(s as any).ci95Rate?.toFixed(2) ?? '0.00'} /s (σ=${(s as any).rateStd?.toFixed(2) ?? '0.00'}), Bytes/s=${s.avgBytesRate.toFixed(0)} ± ${(s as any).ci95Bytes?.toFixed(0) ?? '0'} (σ=${(s as any).bytesStd?.toFixed(0) ?? '0'})`,
  )
  .join('\n')}

## Porównanie wg obciążenia (przegląd)

Poniżej zestawiono średnie metryki zagregowane per metoda i poziom obciążenia CPU. Dają szybki pogląd, jak WS i HTTP skaluje się wraz z obciążeniem tła.

${renderByLoadTables(byLoad)}

## Uwagi i wnioski wstępne

${evaluated.map(s => `- ${s.label}: ${s.checks.join('; ')}`).join('\n')}
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
