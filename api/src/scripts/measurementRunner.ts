/*
 Measurement Runner: executes multiple measurement sessions (e.g., two per method)
 and exports results to CSV + a JSON summary with preliminary evaluation.
 - Runs WS (controlled rate) and HTTP (simulated responses) sessions
 - Aggregates average metrics per session
 - Writes outputs to ./benchmarks/<timestamp>/{sessions.csv, summary.json}
*/

import path from 'node:path';
import fs from 'fs-extra';
import { ResourceMonitor, type SessionRecord } from '../services/ResourceMonitorService';

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
};

async function runWsControlled(cfg: RunCfg): Promise<SessionRecord> {
  const { label, hz, durationSec, payloadBytes } = cfg;
  const rec = ResourceMonitor.startSession({
    label,
    mode: 'ws',
    wsFixedRateHz: hz,
    assumedPayloadBytes: payloadBytes,
    durationSec,
  });
  // Wait for the duration + small buffer to ensure final tick
  await sleep(durationSec * 1000 + 600);
  ResourceMonitor.finishSession(rec.id);
  return ResourceMonitor.getSession(rec.id)!;
}

async function runHttpSimulated(cfg: RunCfg): Promise<SessionRecord> {
  const { label, hz, durationSec, payloadBytes } = cfg;
  const periodMs = Math.max(50, Math.round(1000 / Math.max(0.001, hz)));
  const rec = ResourceMonitor.startSession({
    label,
    mode: 'polling',
    pollingIntervalMs: periodMs, // informational
    durationSec,
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
    { cpu: 0, rss: 0, elu: 0, p99: 0, fresh: 0, rate: 0, bytes: 0, payload: 0, jitter: 0 },
  );
  const avgRate = sum.rate / n;
  const avgBytesRate = sum.bytes / n;
  const avgPayload = sum.payload / n;
  const bytesPerUnit = avgBytesRate / Math.max(0.0001, avgRate);
  return {
    id: s.id,
    label: s.config.label,
    mode: s.config.mode,
    count: n,
    avgCpu: sum.cpu / n,
    avgRss: sum.rss / n,
    avgElu: sum.elu / n,
    avgDelayP99: sum.p99 / n,
    avgRate,
    avgBytesRate,
    avgPayload,
    bytesPerUnit,
    avgJitterMs: sum.jitter / n,
    avgFreshnessMs: sum.fresh / n,
  };
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
    const expectedRate = s.label.includes('@1Hz') ? 1 : s.label.includes('@2Hz') ? 2 : undefined;
    const expectedPayload = s.label.includes('payload=')
      ? Number(s.label.split('payload=')[1].split('B')[0])
      : undefined;

    const checks: string[] = [];
    const flags: { rateOk?: boolean; payloadOk?: boolean } = {};
    if (expectedRate) {
      const low = expectedRate * (1 - tolRate);
      const high = expectedRate * (1 + tolRate);
      checks.push(`rate=${s.avgRate.toFixed(2)} in [${low.toFixed(2)}, ${high.toFixed(2)}]`);
      flags.rateOk = s.avgRate >= low && s.avgRate <= high;
    }
    if (expectedPayload) {
      const low = expectedPayload * (1 - tolPayload);
      const high = expectedPayload * (1 + tolPayload);
      checks.push(`bytesPerUnit=${s.bytesPerUnit.toFixed(1)} in [${low.toFixed(1)}, ${high.toFixed(1)}]`);
      flags.payloadOk = s.bytesPerUnit >= low && s.bytesPerUnit <= high;
    }
    return { ...s, checks, ...flags, expectedRate, expectedPayload, tolRate, tolPayload } as const;
  });
}

async function main() {
  // Init monitor
  ResourceMonitor.init(fakeIo as any);
  ResourceMonitor.setLiveEmitEnabled(false);

  // Define runs: two per method
  const durationSec = 6;
  const wsPayload = 360;
  const httpPayload = 420;
  const runs: RunCfg[] = [
    { label: 'WS@1Hz payload=360B', mode: 'ws', hz: 1, durationSec, payloadBytes: wsPayload },
    { label: 'WS@2Hz payload=360B', mode: 'ws', hz: 2, durationSec, payloadBytes: wsPayload },
    { label: 'HTTP@1Hz payload=420B', mode: 'polling', hz: 1, durationSec, payloadBytes: httpPayload },
    { label: 'HTTP@2Hz payload=420B', mode: 'polling', hz: 2, durationSec, payloadBytes: httpPayload },
  ];

  const sessions: SessionRecord[] = [];
  for (const r of runs) {
    console.log(`[Measure] Starting ${r.label} ...`);
    const sess = r.mode === 'ws' ? await runWsControlled(r) : await runHttpSimulated(r);
    console.log(`[Measure] Finished ${r.label} (samples=${sess.samples.length})`);
    sessions.push(sess);
    await sleep(500); // small separation
  }

  // Summaries and evaluation
  const summaries = sessions.map(summarizeSession);
  const evaluated = evaluate(summaries);

  // Output directory
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(process.cwd(), 'benchmarks', ts);
  await fs.mkdirp(outDir);

  // Export CSV and JSON
  const csvPath = path.join(outDir, 'sessions.csv');
  const summaryPath = path.join(outDir, 'summary.json');
  exportCsv(sessions, csvPath);
  await fs.writeJSON(summaryPath, { summaries: evaluated }, { spaces: 2 });

  // Generate README.md with documentation and preliminary evaluation
  const readmePath = path.join(outDir, 'README.md');
  const readme = renderReadme(evaluated, {
    outDir,
    csvFile: 'sessions.csv',
    summaryFile: 'summary.json',
    durationSec,
  });
  await fs.writeFile(readmePath, readme, 'utf8');

  // Console summary
  console.log('\n[Measure] Summary');
  for (const s of evaluated) {
    console.log(
      `- ${s.label} [${s.mode}] :: rate ${s.avgRate.toFixed(2)}/s, B/s ${s.avgBytesRate.toFixed(0)}, payload≈${s.avgPayload.toFixed(1)}, jitter ${s.avgJitterMs.toFixed(1)} ms, fresh ${s.avgFreshnessMs.toFixed(0)} ms | checks: ${s.checks.join('; ')}`,
    );
  }

  process.exit(0);
}

main().catch(err => {
  console.error('[Measure] Error:', err);
  process.exit(1);
});

function renderReadme(
  evaluated: ReturnType<typeof evaluate>,
  opts: { outDir: string; csvFile: string; summaryFile: string; durationSec: number },
) {
  const tsName = path.basename(opts.outDir);
  const rows = evaluated
    .map(s => {
      const rateOk = s.expectedRate != null ? (s as any).rateOk : undefined;
      const payloadOk = s.expectedPayload != null ? (s as any).payloadOk : undefined;
      const rateBadge = rateOk === undefined ? '—' : rateOk ? '✅' : '❌';
      const payloadBadge = payloadOk === undefined ? '—' : payloadOk ? '✅' : '❌';
      return `| ${s.label} | ${s.mode} | ${s.avgRate.toFixed(2)} | ${s.avgBytesRate.toFixed(0)} | ${s.avgPayload.toFixed(0)} | ${s.avgJitterMs.toFixed(1)} | ${s.avgFreshnessMs.toFixed(0)} | ${s.avgDelayP99.toFixed(1)} | ${s.avgCpu.toFixed(1)} | ${s.avgRss.toFixed(1)} | ${rateBadge} | ${payloadBadge} |`;
    })
    .join('\n');

  const table = `| Label | Mode | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | Świeżość [ms] | EL p99 [ms] | CPU [%] | RSS [MB] | Rate OK | Payload OK |
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
- EL p99 — opóźnienie pętli zdarzeń (korelacja z responsywnością backendu).
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
`;

  return `# Raport pomiarów — ${tsName}

Ten folder zawiera surowe próbki (CSV) oraz podsumowanie z wstępną oceną.

- Plik CSV: ./${opts.csvFile}
- Podsumowanie JSON: ./${opts.summaryFile}

## Podsumowanie (średnie)

${table}

Legenda: Rate OK / Payload OK — wstępna ocena względem oczekiwań (±50%).

## Jak czytać wyniki i powiązanie z dashboardem

${dashboardMap}

## Słownik kolumn CSV

${csvDict}

## Parametry i założenia

${params}

## Uwagi i wnioski wstępne

${evaluated.map(s => `- ${s.label}: ${s.checks.join('; ')}`).join('\n')}
`;
}
