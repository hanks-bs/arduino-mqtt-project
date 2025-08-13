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
  // WS emituje broadcast: Rate dotyczy liczby emisji (nie mnożymy przez liczbę klientów)
  // Przepływność B/s będzie skalowana przez liczbę klientów w onWsEmit.
  const effHz = hz;
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
    // zapisz liczbę klientów WS do konfiguracji sesji (używane w agregacjach)
    clientsWs: Math.max(0, Math.floor(cfg.clientsWs ?? 0)) || undefined,
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
  // Upewnij się, że synthetic HTTP użyje żądanego payloadu (spójność z etykietą)
  try {
    ResourceMonitor.noteArduinoPayloadSize(payloadBytes);
  } catch {}
  // W trybie standalone nie ma działającego serwera HTTP, więc korzystamy z syntetycznych ticków.
  // Jeśli liczba klientów nie została ustawiona (undefined), przyjmij 1, aby wymusić aktywność.
  // Jeżeli użytkownik jawnie poda 0, zachowujemy 0 (brak aktywności dla parowania scenariuszy z WS=0).
  const clients =
    cfg.clientsHttp == null ? 1 : Math.max(0, Math.floor(cfg.clientsHttp));
  const rec = ResourceMonitor.startSession({
    label,
    mode: 'polling',
    pollingIntervalMs: periodMs, // informational
    durationSec,
    warmupSec: cfg.warmupSec,
    cooldownSec: cfg.cooldownSec,
    loadCpuPct,
    loadWorkers,
    // Włączamy syntetyczne żądania: domyślnie co najmniej 1 klient
    clientsHttp: clients,
    internalHttpDriver: false,
    resetCounters: true,
  });
  // Rely solely on ResourceMonitor's synthetic HTTP driver (started by startSession when internalHttpDriver=false and clientsHttp>0)
  await sleep(durationSec * 1000 + 600);
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
  const jitterSeries = samples.map(m =>
    s.config.mode === 'polling' ? m.httpJitterMs : m.wsJitterMs,
  );
  const stalenessSeries = samples.map(m => m.dataFreshnessMs);
  const mean = (a: number[]) =>
    a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const variance = (a: number[], mu: number) =>
    a.length > 1
      ? a.reduce((acc, v) => acc + (v - mu) * (v - mu), 0) / (a.length - 1)
      : 0;
  const stddev = (a: number[]) => Math.sqrt(variance(a, mean(a)));
  const rateStd = stddev(rateSeries);
  const bytesStd = stddev(bytesSeries);
  const jitterStd = stddev(jitterSeries);
  const stalenessStd = stddev(stalenessSeries);
  // Standard CI (z odchylenia próbki)
  const ci95RateStd =
    1.96 * (rateSeries.length ? rateStd / Math.sqrt(rateSeries.length) : 0);
  const ci95BytesStd =
    1.96 * (bytesSeries.length ? bytesStd / Math.sqrt(bytesSeries.length) : 0);
  const ci95JitterStd =
    1.96 * (jitterSeries.length ? jitterStd / Math.sqrt(jitterSeries.length) : 0);
  const ci95StalenessStd =
    1.96 * (stalenessSeries.length ? stalenessStd / Math.sqrt(stalenessSeries.length) : 0);
  // Fallback Poissona dla rzadkich zdarzeń (stabilizuje CI przy bardzo małych średnich)
  const eventsApprox = Math.max(0, Math.round(totalMsgsApprox));
  const ci95RatePois =
    dtSum > 0 ? (1.96 * Math.sqrt(Math.max(1, eventsApprox))) / dtSum : 0;
  const ci95BytesPois = ci95RatePois * (avgPayload || 0);
  const usePoisson = avgRate < 0.5 || eventsApprox < 30;
  const ci95Rate = usePoisson ? ci95RatePois : ci95RateStd;
  const ci95Bytes = usePoisson ? ci95BytesPois : ci95BytesStd;
  const ci95Jitter = ci95JitterStd; // jitter nie jest procesem Poissona
  const ci95Staleness = ci95StalenessStd;
  const median = (a: number[]) => {
    if (!a.length) return 0;
    const sorted = a.slice().sort((x, y) => x - y);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const percentile = (a: number[], p: number) => {
    if (!a.length) return 0;
    const sorted = a.slice().sort((x, y) => x - y);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
    return sorted[idx];
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
  let rateMedian = median(rateSeries);
  let bytesMedian = median(bytesSeries);
  // Ulepszenie median: oblicz medianę z uśrednionych okien ~1 s, aby uniknąć 0 przy rzadkich zdarzeniach
  try {
    const makeWindowed = () => {
      const wRates: number[] = [];
      const wBytes: number[] = [];
      let accTime = 0;
      let accRate = 0;
      let accBytes = 0;
      for (const m of samples) {
        const dt = Math.max(0.001, (m.tickMs || 0) / 1000);
        const r = s.config.mode === 'polling' ? m.httpReqRate : m.wsMsgRate;
        const b = s.config.mode === 'polling' ? m.httpBytesRate : m.wsBytesRate;
        accTime += dt;
        accRate += r * dt;
        accBytes += b * dt;
        if (accTime >= 1) {
          const wR = accRate / accTime;
          const wB = accBytes / accTime;
          if (Number.isFinite(wR)) wRates.push(wR);
          if (Number.isFinite(wB)) wBytes.push(wB);
          accTime = 0;
          accRate = 0;
          accBytes = 0;
        }
      }
      // dołóż resztę, jeśli znacząca (>= 0.5 s)
      if (accTime >= 0.5) {
        const wR = accRate / accTime;
        const wB = accBytes / accTime;
        if (Number.isFinite(wR)) wRates.push(wR);
        if (Number.isFinite(wB)) wBytes.push(wB);
      }
      return { wRates, wBytes };
    };
    const { wRates, wBytes } = makeWindowed();
    if (wRates.length >= 1) rateMedian = median(wRates);
    if (wBytes.length >= 1) bytesMedian = median(wBytes);
  } catch {}
  // Fallbacki na przypadek rzadkich zdarzeń: jeśli mediana 0 przy średniej > 0, pokaż średnią
  if (rateMedian === 0 && avgRate > 0) rateMedian = avgRate;
  if (bytesMedian === 0 && avgBytesRate > 0) bytesMedian = avgBytesRate;
  const rateTrimmed = trimmedMean(rateSeries, 0.1);
  const bytesTrimmed = trimmedMean(bytesSeries, 0.1);
  const relCiRate = avgRate !== 0 ? ci95Rate / avgRate : 0;
  const relCiBytes = avgBytesRate !== 0 ? ci95Bytes / avgBytesRate : 0;
  // Per-client normalization
  const clientsWs =
    s.config.mode === 'ws'
      ? Math.max(0, Math.floor(s.config.clientsWs ?? 0))
      : 0;
  const clientsHttp =
    s.config.mode === 'polling'
      ? Math.max(0, Math.floor(s.config.clientsHttp ?? 0))
      : 0;
  const clients = s.config.mode === 'polling' ? clientsHttp : clientsWs;
  // For HTTP: total rate/bytes scale with clients, so per-client = total / N
  // For WS: rate per client equals emission rate; bytes per client = total / N (broadcast counted for all clients)
  // Per‑client normalization (client perspective):
  // - HTTP: total scales with N ⇒ per‑client = total / N
  // - WS: each client receives the same stream ⇒
  //        Rate/cli = Rate (independent of N),
  //        Bytes/cli = Rate × Payload (client receives full payload)
  const ratePerClient =
    s.config.mode === 'polling'
      ? clients > 0
        ? avgRate / clients
        : undefined
      : avgRate; // WS per‑client rate equals emission rate even for N=0
  const bytesRatePerClient =
    s.config.mode === 'polling'
      ? clients > 0
        ? avgBytesRate / clients
        : undefined
      : avgRate * (avgPayload || 0); // WS: per-client = Rate × Payload (klient dostaje pełny ładunek)
  const bytesRatePerClientServer =
    clients > 0 ? avgBytesRate / clients : undefined; // perspektywa serwera dla obu metod

  // Szacunek egressu (łączny koszt sieci z perspektywy serwera)
  const egressBytesRateEst =
    s.config.mode === 'ws'
      ? avgRate * (avgPayload || 0) * Math.max(0, clientsWs)
      : avgBytesRate;

  // E2E latencje (ms) wyliczone z telemetrii znaczników czasu
  const srcToIngest = samples
    .map(m =>
      Number.isFinite(m.sourceTsMs as any) && Number.isFinite(m.ingestTsMs as any)
        ? (m.ingestTsMs as number) - (m.sourceTsMs as number)
        : NaN,
    )
    .filter(v => Number.isFinite(v) && (v as number) >= 0) as number[];
  const ingestToEmit = samples
    .map(m =>
      Number.isFinite(m.ingestTsMs as any) && Number.isFinite(m.emitTsMs as any)
        ? (m.emitTsMs as number) - (m.ingestTsMs as number)
        : NaN,
    )
    .filter(v => Number.isFinite(v) && (v as number) >= 0) as number[];
  const srcToEmit = samples
    .map(m =>
      Number.isFinite(m.sourceTsMs as any) && Number.isFinite(m.emitTsMs as any)
        ? (m.emitTsMs as number) - (m.sourceTsMs as number)
        : NaN,
    )
    .filter(v => Number.isFinite(v) && (v as number) >= 0) as number[];
  const avgSrcToIngestMs = mean(srcToIngest);
  const avgIngestToEmitMs = mean(ingestToEmit);
  const avgSrcToEmitMs = mean(srcToEmit);
  const p95SrcToIngestMs = percentile(srcToIngest, 95);
  const p95IngestToEmitMs = percentile(ingestToEmit, 95);
  const p95SrcToEmitMs = percentile(srcToEmit, 95);
  const ci95SrcToIngestMs =
    1.96 * (srcToIngest.length ? stddev(srcToIngest) / Math.sqrt(srcToIngest.length) : 0);
  const ci95IngestToEmitMs =
    1.96 * (ingestToEmit.length ? stddev(ingestToEmit) / Math.sqrt(ingestToEmit.length) : 0);
  const ci95SrcToEmitMs =
    1.96 * (srcToEmit.length ? stddev(srcToEmit) / Math.sqrt(srcToEmit.length) : 0);
  return {
    id: s.id,
    label: s.config.label,
    repIndex: (s as any).repIndex || 1,
    repTotal: (s as any).repTotal || 1,
    mode: s.config.mode,
    clientsHttp: s.config.mode === 'polling' ? (s.config.clientsHttp ?? 0) : 0,
    clientsWs: s.config.mode === 'ws' ? (s.config.clientsWs ?? 0) : 0,
    clients,
    loadCpuPct: Math.max(0, Math.floor(s.config.loadCpuPct || 0)),
    count: n,
    nUsed: n,
    nTotal: s.samples.length,
    warmupSec: s.config.warmupSec || 0,
    cooldownSec: s.config.cooldownSec || 0,
    // sanity clamp to avoid negative artifacts from sampler
    avgCpu: Math.max(0, sum.cpu / n),
    avgRss: Math.max(0, sum.rss / n),
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
    ratePerClient,
    bytesRatePerClient,
  bytesRatePerClientServer,
  egressBytesRateEst,
  avgJitterMs: sum.jitter / n,
  jitterStd,
  ci95Jitter,
  avgFreshnessMs: sum.fresh / n,
  avgStalenessMs: sum.fresh / n,
  stalenessStd,
  ci95Staleness,
  avgSrcToIngestMs,
  p95SrcToIngestMs,
  ci95SrcToIngestMs,
  avgIngestToEmitMs,
  p95IngestToEmitMs,
  ci95IngestToEmitMs,
  avgSrcToEmitMs,
  p95SrcToEmitMs,
  ci95SrcToEmitMs,
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
      ratePerClient: number;
      bytesPerClient: number;
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
      ratePerClient: 0,
      bytesPerClient: 0,
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
    cur.ratePerClient += (s as any).ratePerClient ?? 0;
    cur.bytesPerClient += (s as any).bytesRatePerClient ?? 0;
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
    avgRatePerClient: r.ratePerClient / r.n,
    avgBytesPerClient: r.bytesPerClient / r.n,
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
      ratePerClient: number;
      bytesPerClient: number;
      jitter: number;
      cpu: number;
      rss: number;
      delayP99: number;
      fresh: number;
    }
  >();
  const parseClientsFromLabel = (label: string, key: 'cWs' | 'cHttp') => {
    const idx = label.indexOf(key + '=');
    if (idx === -1) return 0;
    const tail = label.slice(idx + key.length + 1);
    const m = tail.match(/^(\d+)/);
    return m ? Number(m[1]) : 0;
  };
  for (const s of summaries) {
    const explicit =
      s.mode === 'ws'
        ? Number((s as any).clientsWs ?? 0)
        : Number((s as any).clientsHttp ?? 0);
    const parsed =
      s.mode === 'ws'
        ? parseClientsFromLabel((s as any).label || s.label, 'cWs')
        : parseClientsFromLabel((s as any).label || s.label, 'cHttp');
    const clients =
      Number.isFinite(explicit) && explicit > 0 ? explicit : parsed;
    const key = `${s.mode}|${clients}`;
    const cur = acc.get(key) || {
      mode: s.mode,
      clients,
      n: 0,
      rate: 0,
      bytes: 0,
      payload: 0,
      ratePerClient: 0,
      bytesPerClient: 0,
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
    cur.ratePerClient += (s as any).ratePerClient ?? 0;
    cur.bytesPerClient += (s as any).bytesRatePerClient ?? 0;
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
    avgRatePerClient: r.ratePerClient / r.n,
    avgBytesPerClient: r.bytesPerClient / r.n,
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
    // Skala oczekiwanej częstości:
    // - HTTP: suma żądań ~ Hz × liczba klientów
    // - WS: broadcast; emisja jest jedna niezależnie od liczby klientów
    let scaledExpectedRate: number | undefined = expectedRateBase;
    if (expectedRateBase != null) {
      const clientsWs = Math.max(1, Number((s as any).clientsWs ?? 1));
      const clientsHttp = Math.max(0, Number((s as any).clientsHttp ?? 0));
      const clientsUsed = s.mode === 'polling' ? clientsHttp : 1;
      if (clientsUsed > 0) {
        scaledExpectedRate = expectedRateBase * clientsUsed;
        const low = scaledExpectedRate * (1 - tolRate);
        const high = scaledExpectedRate * (1 + tolRate);
        checks.push(
          `rate=${s.avgRate.toFixed(2)} in [${low.toFixed(2)}, ${high.toFixed(2)}] (c=${s.mode === 'polling' ? clientsHttp : clientsWs})`,
        );
        flags.rateOk = s.avgRate >= low && s.avgRate <= high;
      } else {
        // No clients for polling: do not set expectedRate to base to avoid misleading "1 Hz" in outputs
        scaledExpectedRate = undefined;
      }
    }
    if (expectedPayload != null) {
      const clientsHttp0 =
        Math.max(0, Number((s as any).clientsHttp ?? 0)) === 0;
      const noActivity =
        (s.avgRate || 0) === 0 || (s.mode === 'polling' && clientsHttp0);
      if (!noActivity) {
        const low = expectedPayload * (1 - tolPayload);
        const high = expectedPayload * (1 + tolPayload);
        checks.push(
          `bytesPerUnit=${s.bytesPerUnit.toFixed(1)} in [${low.toFixed(1)}, ${high.toFixed(1)}]`,
        );
        flags.payloadOk = s.bytesPerUnit >= low && s.bytesPerUnit <= high;
      }
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
  payloadHttp?: number; // HTTP-specific payload
  pair?: boolean; // pair WS/HTTP scenarios for the same parameters
};

export async function runMeasurements(opts: MeasureOpts = {}) {
  // Apply tick override before init
  if (opts.tickMs && Number.isFinite(opts.tickMs)) {
    (process.env as any).MONITOR_TICK_MS = String(opts.tickMs);
  }
  // Optional: disable or throttle pidusage sampling to reduce event-loop overhead on Windows
  const disablePid = (opts as any).disablePidusage as boolean | undefined;
  const cpuSampleMs = (opts as any).cpuSampleMs as number | undefined;
  if (disablePid) {
    (process.env as any).MONITOR_DISABLE_PIDUSAGE = '1';
  }
  if (cpuSampleMs && Number.isFinite(cpuSampleMs)) {
    (process.env as any).MONITOR_CPU_SAMPLE_MS = String(cpuSampleMs);
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
      // Zachowaj metadane powtórzenia przy sesji, by trafiły do summary.json i raportu
      (sess as any).repIndex = i + 1;
      (sess as any).repTotal = repeats;
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
  const flags = {
    fairPayload: fairPayloadFlag,
    sourceLimited: sourceLimitedFlag,
  };
  if (!fairPayloadFlag) {
    console.warn(
      '[Measure] Uwaga: payload WS ≠ HTTP; porównania mogą być nie fair',
    );
  }

  // Output directory
  const stickyOut = (process.env as any).MEASURE_OUTPUT_DIR as
    | string
    | undefined;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = stickyOut
    ? path.resolve(process.cwd(), stickyOut)
    : path.resolve(process.cwd(), 'benchmarks', ts);
  await fs.mkdirp(outDir);

  // Export CSV and JSON (agregacja w jednym folderze, jeśli MEASURE_OUTPUT_DIR ustawione)
  const csvPath = path.join(outDir, 'sessions.csv');
  const summaryPath = path.join(outDir, 'summary.json');
  // Append/Write sessions.csv
  if (await fs.pathExists(csvPath)) {
    // Append without header
    const tmpCsv = path.join(outDir, `tmp_sessions_${Date.now()}.csv`);
    exportCsv(sessions, tmpCsv);
    const content = await fs.readFile(tmpCsv, 'utf8');
    const lines = content.split(/\r?\n/);
    const toAppend = lines.slice(1).join('\n');
    await fs.appendFile(csvPath, '\n' + toAppend, 'utf8');
    await fs.remove(tmpCsv);
  } else {
    exportCsv(sessions, csvPath);
  }
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
  // Merge summary.json if exists
  let combinedEvaluated = evaluated as any[];
  if (await fs.pathExists(summaryPath)) {
    try {
      const prev = await fs.readJSON(summaryPath);
      if (Array.isArray(prev?.summaries)) {
        combinedEvaluated = [...prev.summaries, ...evaluated];
      }
    } catch {}
  }
  const combinedByLoad = aggregateByLoad(combinedEvaluated as any);
  const combinedByClients = aggregateByClients(combinedEvaluated as any);
  await fs.writeJSON(
    summaryPath,
    {
      summaries: combinedEvaluated,
      byLoad: combinedByLoad,
      byClients: combinedByClients,
      flags,
      runConfig,
      units: {
        rate: '/s',
        bytesRate: 'B/s',
        payload: 'B',
        jitter: 'ms',
        staleness: 'ms',
  latency: 'ms',
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
    'mode,loadCpuPct,avgRate,avgBytesRate,avgPayload,avgRatePerClient,avgBytesPerClient,avgJitterMs,avgCpu,avgRss,avgDelayP99,avgFreshnessMs',
  ];
  for (const r of byLoad) {
    byLoadCsv.push(
      [
        r.mode,
        r.loadCpuPct,
        r.avgRate.toFixed(3),
        r.avgBytesRate.toFixed(0),
        r.avgPayload.toFixed(1),
        (r as any).avgRatePerClient != null
          ? (r as any).avgRatePerClient.toFixed(3)
          : '',
        (r as any).avgBytesPerClient != null
          ? (r as any).avgBytesPerClient.toFixed(0)
          : '',
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
    'mode,clients,avgRate,avgBytesRate,avgPayload,avgRatePerClient,avgBytesPerClient,avgJitterMs,avgCpu,avgRss,avgDelayP99,avgFreshnessMs',
  ];
  for (const r of byClients) {
    byClientsCsv.push(
      [
        r.mode,
        r.clients,
        r.avgRate.toFixed(3),
        r.avgBytesRate.toFixed(0),
        r.avgPayload.toFixed(1),
        (r as any).avgRatePerClient != null
          ? (r as any).avgRatePerClient.toFixed(3)
          : '',
        (r as any).avgBytesPerClient != null
          ? (r as any).avgBytesPerClient.toFixed(0)
          : '',
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
    combinedEvaluated as any,
    {
      outDir,
      csvFile: 'sessions.csv',
      summaryFile: 'summary.json',
      durationSec,
    },
    combinedByLoad,
    combinedByClients,
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
  const disablePidArg = argv.includes('--disablePidusage');
  const cpuSampleArg = get('cpuSampleMs');
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
    // Extended flags (not documented in scripts):
    // --disablePidusage (boolean), --cpuSampleMs <ms>
    ...(disablePidArg ? { disablePidusage: true } : {}),
    ...(cpuSampleArg ? { cpuSampleMs: Number(cpuSampleArg) } : {}),
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
  const parseHz = (label: string): number => {
    const m = label.match(/@(\d+(?:\.\d+)?)Hz/);
    return m ? Number(m[1]) : Number.NaN;
  };
  const getClients = (s: any): number =>
    s.mode === 'ws' ? Number(s.clientsWs ?? 0) : Number(s.clientsHttp ?? 0);
  // Compute flags locally for readability
  const fairPayload = runConfig.wsPayload === runConfig.httpPayload;
  const ratios = evaluated
    .map(s => {
      const m = s.label.match(/@(\d+(?:\.\d+)?)Hz/);
      const base = m ? Number(m[1]) : undefined;
      const exp =
        s.expectedRate ??
        (Number.isFinite(base as any)
          ? s.mode === 'polling'
            ? (base as number) * Math.max(0, (s as any).clientsHttp ?? 0)
            : (base as number)
          : undefined);
      return exp && exp > 0 ? s.avgRate / exp : Number.NaN;
    })
    .filter(r => Number.isFinite(r)) as number[];
  const sourceLimited =
    ratios.length > 0 &&
    ratios.filter(r => r < 0.5).length / ratios.length >= 0.7;
  // Discover distinct client sets from fields or fallback to label
  const parseClientsFromLabel = (label: string, key: 'cWs' | 'cHttp') => {
    const idx = label.indexOf(key + '=');
    if (idx === -1) return 0;
    const tail = label.slice(idx + key.length + 1);
    const m = tail.match(/^(\d+)/);
    return m ? Number(m[1]) : 0;
  };
  const wsClientsSet = Array.from(
    new Set(
      evaluated
        .filter(s => s.mode === 'ws')
        .map(s => {
          const exp = Number((s as any).clientsWs ?? 0);
          if (Number.isFinite(exp) && exp >= 0) return exp;
          return parseClientsFromLabel((s as any).label || s.label, 'cWs');
        }),
    ),
  )
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b);
  const httpClientsSet = Array.from(
    new Set(
      evaluated
        .filter(s => s.mode === 'polling')
        .map(s => {
          const exp = Number((s as any).clientsHttp ?? 0);
          if (Number.isFinite(exp) && exp >= 0) return exp;
          return parseClientsFromLabel((s as any).label || s.label, 'cHttp');
        }),
    ),
  )
    .filter(n => Number.isFinite(n))
    .sort((a, b) => a - b);

  const rows = evaluated
    .slice()
    .sort((a, b) => {
      if (a.mode !== b.mode) return a.mode === 'ws' ? -1 : 1;
      const ha = parseHz(a.label);
      const hb = parseHz(b.label);
      if (Number.isFinite(ha) && Number.isFinite(hb) && ha !== hb)
        return (ha as number) - (hb as number);
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
      const rateCli = (s as any).ratePerClient;
      const bytesCli = (s as any).bytesRatePerClient;
      const clients =
        s.mode === 'ws'
          ? Number((s as any).clientsWs ?? 0)
          : Number((s as any).clientsHttp ?? 0);
      const egressEst = (() => {
        const avgRate = Number(s.avgRate);
        const payload = Number((s as any).avgPayload ?? 0);
        const avgBytesRate = Number(s.avgBytesRate);
        const N = Math.max(0, clients);
        if (s.mode === 'ws') {
          const v = avgRate * payload * N;
          return Number.isFinite(v) ? v : NaN;
        }
        return Number.isFinite(avgBytesRate) ? avgBytesRate : NaN;
      })();
      const rateCliStr = rateCli != null ? (rateCli as number).toFixed(2) : '—';
      const bytesCliStr =
        bytesCli != null ? (bytesCli as number).toFixed(0) : '—';
      return `| ${s.label} | ${s.mode} | ${s.avgRate.toFixed(2)} | ${rateCliStr} | ${s.avgBytesRate.toFixed(0)} | ${bytesCliStr} | ${Number.isFinite(egressEst) ? egressEst.toFixed(0) : '—'} | ${s.avgPayload.toFixed(0)} | ${s.avgJitterMs.toFixed(1)} | ${s.avgFreshnessMs.toFixed(0)} | ${s.avgDelayP99.toFixed(1)} | ${s.avgCpu.toFixed(1)} | ${s.avgRss.toFixed(1)} | ${nUsed}/${nTotal} | ${rateBadge} | ${payloadBadge} |`;
    })
    .join('\n');

  const table = `| Label | Mode | Rate [/s] | Rate/cli [/s] | Bytes/s | Bytes/cli [B/s] | Egress est. [B/s] | ~Payload [B] | Jitter [ms] | Staleness [ms] | ELU p99 [ms] | CPU [%] | RSS [MB] | n (used/total) | Rate OK | Payload OK |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--:|:--:|:--:|
${rows}`;
  const compactTable = (() => {
    const header = `| Label | Mode | Rate/cli [/s] | Bytes/cli [B/s] | Jitter [ms] | Staleness [ms] | CPU [%] | RSS [MB] |\n|---|---:|---:|---:|---:|---:|---:|---:|`;
    const lines = evaluated
      .map(s => {
        const clients =
          s.mode === 'ws'
            ? ((s as any).clientsWs ?? 0)
            : ((s as any).clientsHttp ?? 0);
        const rateCli = (s as any).ratePerClient;
        const bytesCli = (s as any).bytesRatePerClient;
        const rep =
          (s as any).repIndex && (s as any).repTotal
            ? ` [rep ${(s as any).repIndex}/${(s as any).repTotal}]`
            : '';
        const f = (n: any, d = 2) =>
          Number.isFinite(Number(n)) ? Number(n).toFixed(d) : '—';
        const stale = (s as any).avgStalenessMs ?? (s as any).avgFreshnessMs;
        return `| ${s.label}${rep} | ${s.mode} | ${f(rateCli, 2)} | ${f(bytesCli, 0)} | ${f(s.avgJitterMs, 1)} | ${f(stale, 0)} | ${f(s.avgCpu, 1)} | ${f(s.avgRss, 1)} |`;
      })
      .join('\n');
    return `${header}\n${lines}`;
  })();

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
      httpBytesRate/wsBytesRate — przepustowość [B/s] (WS: łączna dla wszystkich klientów)
      httpAvgBytesPerReq/wsAvgBytesPerMsg — średni ładunek [B]
      httpJitterMs/wsJitterMs — zmienność odstępów (stddev) [ms]
      tickMs — realny odstęp między próbkami mierzony monotonicznie [ms]
  dataFreshnessMs — Staleness (wiek danych): czas od ostatniego odczytu [ms]
  sourceTsMs/ingestTsMs/emitTsMs — znaczniki czasowe do wyliczeń E2E (źródło→ingest→emit)
  `;

  const dashboardMap = `
  - Częstość (Rate) — odpowiada wykresom częstości WS/HTTP w dashboardzie.
  - Bytes/s i ~Payload — odpowiada wykresom przepustowości i średniego rozmiaru ładunku.
  - Jitter — odpowiada wskaźnikowi stabilności sygnału (niższy lepszy).
  - Wiek danych — czas od ostatniego odczytu (niższy lepszy, WS zwykle świeższe niż HTTP).
`;

  const howToRead = `
 - n (użyte/łącznie) — liczba próbek wykorzystanych do średnich po odrzuceniu warmup/cooldown vs. całkowita.
  - Rate/cli i Bytes/cli — normalizacja per klient:
   - HTTP: Rate/cli = Rate / N, Bytes/cli = Bytes/s / N (N = liczba klientów).
   - WS: Rate/cli = Rate (broadcast, niezależnie od N), Bytes/cli = Rate × Payload (to, co realnie otrzymuje klient). W pełnej tabeli przy N>0 Bytes/cli bywa równy Bytes/s ÷ N (perspektywa serwera) — dlatego dodajemy kolumnę "Egress est.".
   - Gdy N=0 (HTTP: brak aktywności; WS: brak odbiorców), pola per‑client są puste (—).
  - Egress est. — szacowany łączny koszt sieci z perspektywy serwera:
    - WS: Rate × Payload × N (łączny egress serwera; mnożenie przez N).
    - HTTP: równe Bytes/s (zlicza sumarycznie po klientach).
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
 - Klienci WS (wykryte): [${wsClientsSet.join(', ')}]
 - Klienci HTTP (wykryte): [${httpClientsSet.join(', ')}]
 - Warmup/Cooldown [s]: ${runConfig.warmupSec || 0} / ${runConfig.cooldownSec || 0}
`;

  return `# Raport pomiarów — ${tsName}

Ten folder zawiera surowe próbki (CSV) oraz podsumowanie z wstępną oceną.

 - Plik CSV: ./${opts.csvFile}
 - Podsumowanie JSON: ./${opts.summaryFile}
 - Uśrednione wyniki wg obciążenia: ./by_load.csv
 - Uśrednione wyniki wg liczby klientów: ./by_clients.csv

## Podsumowanie (średnie)

### TL;DR — szybkie porównanie WS vs HTTP (per klient)

${(() => {
  const eligible = evaluated.filter(s => {
    const clients =
      s.mode === 'ws'
        ? Number((s as any).clientsWs ?? 0)
        : Number((s as any).clientsHttp ?? 0);
    const active = Number(s.avgRate) > 0 || Number(s.avgBytesRate) > 0;
    return active && clients > 0;
  });
  if (eligible.length < 2) return 'Brak porównywalnych scenariuszy.';
  const part = (mode: 'ws' | 'polling') =>
    eligible.filter(s => s.mode === mode);
  const avg = (a: number[]) =>
    a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
  const rateCli = (s: any) => {
    const n =
      s.mode === 'ws' ? Number(s.clientsWs ?? 0) : Number(s.clientsHttp ?? 0);
    const v = Number.isFinite(Number(s.ratePerClient))
      ? Number(s.ratePerClient)
      : Number(s.avgRate);
    return n > 0 ? v : NaN;
  };
  const ws = part('ws');
  const http = part('polling');
  const wsRate = avg(ws.map(rateCli));
  const httpRate = avg(http.map(rateCli));
  const wsJit = avg(ws.map((s: any) => Number(s.avgJitterMs)));
  const httpJit = avg(http.map((s: any) => Number(s.avgJitterMs)));
  const wsFresh = avg(ws.map((s: any) => Number(s.avgFreshnessMs)));
  const httpFresh = avg(http.map((s: any) => Number(s.avgFreshnessMs)));
  const wsCpu = avg(ws.map((s: any) => Number(s.avgCpu)));
  const httpCpu = avg(http.map((s: any) => Number(s.avgCpu)));
  const fmt = (n: number, f = 2) => (Number.isFinite(n) ? n.toFixed(f) : '—');
  const f1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '—');
  const f0 = (n: number) => (Number.isFinite(n) ? n.toFixed(0) : '—');
  return `- Rate/cli — WS ${fmt(wsRate)} /s vs HTTP ${fmt(httpRate)} /s; Jitter — WS ${f1(wsJit)} ms vs HTTP ${f1(httpJit)} ms; Staleness — WS ${f0(wsFresh)} ms vs HTTP ${f0(httpFresh)} ms; CPU — WS ${f1(wsCpu)}% vs HTTP ${f1(httpCpu)}%.\n- Uwaga: sprawdź 95% CI w sekcji Metrologia — gdy nakładają się, traktuj różnice jako niejednoznaczne.`;
})()}

${compactTable}

<details>
<summary>Szczegóły (pełna tabela)</summary>

${table}

</details>

Legenda: Rate OK / Payload OK — wstępna ocena względem oczekiwań (±50%).
Scenariusze bez aktywności lub z clients=0 są oznaczane symbolem „—” (check pominięty).

### Jak czytać tabelę (cheat‑sheet)

${howToRead}
Uwaga (WS — Bytes/cli): W pełnej tabeli Bytes/cli dla WS liczone jest jako emisja/N (perspektywa serwera). Rzeczywisty koszt sieci ≈ Rate × Payload na klienta oraz ≈ Bytes/s × N łącznie.

### Jak interpretować wyniki (protokół)

- Porównuj per klienta: Rate/cli (wyżej=lepiej), Jitter i Staleness (niżej=lepiej), CPU i RSS (niżej=lepiej).
- Sprawdź 95% CI w sekcji Metrologia: jeśli przedziały się nakładają, różnice mogą być nieistotne.
- Szybkie progi praktyczne:
  - Rate/cli: różnica ≥ 10–15% i poza 95% CI.
  - Jitter/Staleness: różnica ≥ 20% lub ≥ 50 ms przy wartościach ~setek ms.
  - CPU: < 3–5 pp często szum; > 5–7 pp — potencjalnie istotne.
  - RSS: < 10 MB zwykle pomijalne, chyba że stabilne w wielu scenariuszach.
- Spójność: uznaj różnicę za „realną”, gdy powtarza się w obu repach i w agregatach (wg obciążenia/klientów).
- Semantyka sieci: WS egress ≈ Rate × Payload × N; HTTP Bytes/s to suma po klientach.

## Jak czytać wyniki i powiązanie z dashboardem

${dashboardMap}

## Słownik kolumn CSV

${csvDict}

## Parametry i założenia

${params}

## Metrologia (95% CI)

Niepewność średnich (95% CI) dla kluczowych wielkości na sesję. Tick próbkowania ≈ ${runConfig.monitorTickMs} ms (sterowany przez \`MONITOR_TICK_MS\`).

| Label | n (used/total) | Rate [/s] | CI95 Rate | σ(rate) | Bytes/s | CI95 Bytes | σ(bytes) | Jitter [ms] | CI95 Jitter | Staleness [ms] | CI95 Staleness |
|---|:--:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${evaluated
  .map(s => {
    const nUsed = (s as any).nUsed ?? s.count;
    const nTotal = (s as any).nTotal ?? s.count;
    const ciRate = (s as any).ci95Rate ?? 0;
    const ciBytes = (s as any).ci95Bytes ?? 0;
    const rateStd = (s as any).rateStd ?? 0;
    const bytesStd = (s as any).bytesStd ?? 0;
    const ciJ = (s as any).ci95Jitter ?? 0;
    const ciSt = (s as any).ci95Staleness ?? 0;
    const avgJ = (s as any).avgJitterMs ?? 0;
    const avgSt = (s as any).avgStalenessMs ?? (s as any).avgFreshnessMs ?? 0;
    return `| ${s.label} | ${nUsed}/${nTotal} | ${s.avgRate.toFixed(2)} | ± ${ciRate.toFixed(2)} | ${rateStd.toFixed(2)} | ${s.avgBytesRate.toFixed(0)} | ± ${ciBytes.toFixed(0)} | ${bytesStd.toFixed(0)} | ${avgJ.toFixed(1)} | ± ${ciJ.toFixed(1)} | ${avgSt.toFixed(0)} | ± ${ciSt.toFixed(0)} |`;
  })
  .join('\n')}

## E2E latency (avg / p95) [ms]

| Label | Src→Ingest avg | Src→Ingest p95 | Ingest→Emit avg | Ingest→Emit p95 | Src→Emit avg | Src→Emit p95 |
|---|---:|---:|---:|---:|---:|---:|
${evaluated
  .map(s => {
    const f = (v: any, d = 1) => (Number.isFinite(Number(v)) ? Number(v).toFixed(d) : '—');
    return `| ${s.label} | ${f((s as any).avgSrcToIngestMs)} | ${f((s as any).p95SrcToIngestMs)} | ${f((s as any).avgIngestToEmitMs)} | ${f((s as any).p95IngestToEmitMs)} | ${f((s as any).avgSrcToEmitMs)} | ${f((s as any).p95SrcToEmitMs)} |`;
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
 - Flagi sesji: fairPayload=${fairPayload}, sourceLimited=${sourceLimited}
`;
}

function renderByLoadTables(rows: ReturnType<typeof aggregateByLoad>) {
  const fmt = (n: number, f = 1) => n.toFixed(f);
  const header = `| Obciążenie | Rate [/s] | Rate/cli [/s] | Bytes/s | Bytes/cli [B/s] | ~Payload [B] | Jitter [ms] | ELU p99 [ms] | CPU [%] | RSS [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|`;
  const render = (mode: 'ws' | 'polling') => {
    const modeRows = rows.filter(r => r.mode === mode);
    const lines = modeRows
      .map(
        r =>
          `| ${r.loadCpuPct}% | ${fmt(r.avgRate, 2)} | ${fmt((r as any).avgRatePerClient ?? 0, 2)} | ${fmt(r.avgBytesRate, 0)} | ${fmt((r as any).avgBytesPerClient ?? 0, 0)} | ${fmt(r.avgPayload, 0)} | ${fmt(r.avgJitterMs, 1)} | ${fmt(r.avgDelayP99, 1)} | ${fmt(r.avgCpu, 1)} | ${fmt(r.avgRss, 1)} |`,
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
  const header = `| Klienci | Rate [/s] | Rate/cli [/s] | Bytes/s | Bytes/cli [B/s] | Egress est. [B/s] | ~Payload [B] | Jitter [ms] | ELU p99 [ms] | CPU [%] | RSS [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|`;
  const render = (mode: 'ws' | 'polling') => {
    const modeRows = rows.filter(r => r.mode === mode);
    const lines = modeRows
      .map(
        r => {
          const N = Math.max(0, Number(r.clients ?? 0));
          const egress = mode === 'ws'
            ? Number(r.avgRate) * Number(r.avgPayload) * N
            : Number(r.avgBytesRate);
          return `| ${r.clients} | ${fmt(r.avgRate, 2)} | ${fmt((r as any).avgRatePerClient ?? 0, 2)} | ${fmt(r.avgBytesRate, 0)} | ${fmt((r as any).avgBytesPerClient ?? 0, 0)} | ${fmt(egress, 0)} | ${fmt(r.avgPayload, 0)} | ${fmt(r.avgJitterMs, 1)} | ${fmt(r.avgDelayP99, 1)} | ${fmt(r.avgCpu, 1)} | ${fmt(r.avgRss, 1)} |`;
        },
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
