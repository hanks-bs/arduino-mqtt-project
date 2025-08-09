/*
 Reliability harness: simulates WS and HTTP traffic to verify ResourceMonitor metrics
 without requiring real MQTT/WS clients. It runs two sequential sessions (WS then HTTP),
 pushes synthetic counters, and prints aggregate summaries.
*/

import { ResourceMonitor, type SessionRecord } from '../services/ResourceMonitorService';

// Minimal fake Socket.IO to satisfy init() and avoid real emissions
const fakeIo: any = {
  emit: () => {},
  of: () => ({ sockets: { size: 0 } }),
};

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  // boot monitor (starts tick loop)
  ResourceMonitor.init(fakeIo as any);

  // ensure deterministic baseline
  ResourceMonitor.setLiveEmitEnabled(false);

  const samplesPerSecWs = 5; // every 200ms
  const wsPayloadBytes = 350; // approximate payload size

  const samplesPerSecHttp = 2; // every 500ms
  const httpPayloadBytes = 420; // approximate payload size incl. envelope

  const wsDurationSec = 10;
  const httpDurationSec = 10;

  console.log('[Harness] Starting WS session...');
  const ws = ResourceMonitor.startSession({ label: 'Harness WS', mode: 'ws' });
  const wsTimer = setInterval(() => {
    // simulate WS emission
    ResourceMonitor.onWsEmit(wsPayloadBytes);
    ResourceMonitor.setLastArduinoTimestamp(new Date().toISOString());
  }, 1000 / samplesPerSecWs);
  wsTimer.unref();
  await sleep(wsDurationSec * 1000);
  clearInterval(wsTimer);
  ResourceMonitor.finishSession(ws.id);
  console.log('[Harness] WS session finished');

  await sleep(1000); // small gap

  console.log('[Harness] Starting HTTP session...');
  const http = ResourceMonitor.startSession({ label: 'Harness HTTP', mode: 'polling', pollingIntervalMs: 1000 / samplesPerSecHttp });
  const httpTimer = setInterval(() => {
    // simulate HTTP response accounted by wrapper
    ResourceMonitor.onHttpResponse(httpPayloadBytes);
    ResourceMonitor.setLastArduinoTimestamp(new Date().toISOString());
  }, 1000 / samplesPerSecHttp);
  httpTimer.unref();
  await sleep(httpDurationSec * 1000);
  clearInterval(httpTimer);
  ResourceMonitor.finishSession(http.id);
  console.log('[Harness] HTTP session finished');

  // Gather aggregates
  const sessions = ResourceMonitor.listSessions().filter(s => ['Harness WS', 'Harness HTTP'].includes(s.config.label));
  const agg = sessions.map(s => summarize(s));
  console.log('\n[Harness] Summary (avg over samples)');
  for (const a of agg) {
    console.log(`- ${a.label} [${a.mode}] :: CPU% ${a.avgCpu.toFixed(1)}, RSS ${a.avgRss.toFixed(1)} MB, ELU ${a.avgElu.toFixed(2)}, p99 ${a.avgDelayP99.toFixed(1)} ms, rate ${a.avgRate.toFixed(2)}/s, B/s ${a.avgBytesRate.toFixed(0)}, jitter ${a.avgJitterMs.toFixed(1)} ms, fresh ${a.avgFreshnessMs.toFixed(0)} ms`);
  }

  process.exit(0);
}

function summarize(s: SessionRecord) {
  const n = s.samples.length || 1;
  const sum = s.samples.reduce(
    (acc, m) => {
      acc.cpu += m.cpu;
      acc.rss += m.rssMB;
      acc.elu += m.elu;
      acc.delay += m.elDelayP99Ms;
      acc.fresh += m.dataFreshnessMs;
      if (s.config.mode === 'polling') {
        acc.rate += m.httpReqRate;
        acc.bytes += m.httpBytesRate;
        acc.jitter += m.httpJitterMs;
      } else {
        acc.rate += m.wsMsgRate;
        acc.bytes += m.wsBytesRate;
        acc.jitter += m.wsJitterMs;
      }
      return acc;
    },
    { cpu: 0, rss: 0, elu: 0, delay: 0, rate: 0, bytes: 0, jitter: 0, fresh: 0 },
  );
  return {
    id: s.id,
    label: s.config.label,
    mode: s.config.mode,
    count: n,
    avgCpu: sum.cpu / n,
    avgRss: sum.rss / n,
    avgElu: sum.elu / n,
    avgDelayP99: sum.delay / n,
    avgRate: sum.rate / n,
    avgBytesRate: sum.bytes / n,
    avgJitterMs: sum.jitter / n,
    avgFreshnessMs: sum.fresh / n,
  };
}

run().catch(err => {
  console.error('[Harness] Error:', err);
  process.exit(1);
});
