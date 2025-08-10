/*
 Updates docs/ASPEKT_BADAWCZY.md AUTO-RESULTS section with latest benchmark summary.
 Looks for newest folder in api/benchmarks/, reads summary.json, generates a table and notes.
*/
import fs from 'fs-extra';
import path from 'node:path';

async function main() {
  const repoRoot = path.resolve(__dirname, '../../..');
  const benchesDir = path.join(repoRoot, 'api', 'benchmarks');
  const researchPath = path.join(repoRoot, 'docs', 'ASPEKT_BADAWCZY.md');

  const exists = await fs.pathExists(benchesDir);
  if (!exists) throw new Error(`Brak folderu benchmarków: ${benchesDir}`);

  const entries = await fs.readdir(benchesDir);
  const candidates: string[] = [];
  for (const n of entries) {
    if (n.startsWith('.') || n.startsWith('_')) continue; // pomiń pliki indeksów
    const p = path.join(benchesDir, n);
    try {
      const st = await fs.stat(p);
      if (!st.isDirectory()) continue;
      const hasSummary = await fs.pathExists(path.join(p, 'summary.json'));
      if (!hasSummary) continue;
      candidates.push(n);
    } catch {}
  }
  if (candidates.length === 0)
    throw new Error('Brak katalogów wyników w api/benchmarks');
  // Nazwy mają postać ISO timestamp, sortowanie malejące po nazwie działa stabilnie
  const sorted = candidates.sort((a, b) => (a > b ? -1 : 1));
  const latest = sorted[0];
  const latestDir = path.join(benchesDir, latest);
  const summaryPath = path.join(latestDir, 'summary.json');
  const csvPath = path.join(latestDir, 'sessions.csv');
  const readmePath = path.join(latestDir, 'README.md');

  const summary = await fs.readJSON(summaryPath);
  const itemsRaw = (summary.summaries || []) as Array<any>;
  // Sort items: mode (ws first), then Hz (from label), then loadCpuPct, then clients
  const parseHz = (label: string): number => {
    const m = label?.match(/@(\d+(?:\.\d+)?)Hz/);
    return m ? Number(m[1]) : Number.NaN;
  };
  const getClients = (s: any): number =>
    s.mode === 'ws' ? Number(s.clientsWs ?? 0) : Number(s.clientsHttp ?? 0);
  const items = itemsRaw.slice().sort((a, b) => {
    if (a.mode !== b.mode) return a.mode === 'ws' ? -1 : 1;
    const ha = parseHz(a.label);
    const hb = parseHz(b.label);
    if (Number.isFinite(ha) && Number.isFinite(hb) && ha !== hb) return ha - hb;
    const la = Number(a.loadCpuPct ?? 0);
    const lb = Number(b.loadCpuPct ?? 0);
    if (la !== lb) return la - lb;
    const ca = getClients(a);
    const cb = getClients(b);
    if (ca !== cb) return ca - cb;
    return String(a.label).localeCompare(String(b.label));
  });
  const runCfg = summary.runConfig as
    | undefined
    | {
        modes: string[];
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
      };
  const byLoad: Array<any> = (summary.byLoad || []) as Array<any>;
  const byClients: Array<any> = (summary.byClients || []) as Array<any>;

  // Detect SAFE run for contextual note
  const isSafeRun = (() => {
    try {
      const hzSet = Array.isArray(runCfg?.hzSet)
        ? (runCfg!.hzSet as number[])
        : [];
      const loadSet = Array.isArray(runCfg?.loadSet)
        ? (runCfg!.loadSet as number[])
        : [];
      const clientsHttp = Number(runCfg?.clientsHttp ?? 0);
      const clientsWs = Number(runCfg?.clientsWs ?? 0);
      const durationSec = Number(runCfg?.durationSec ?? 0);
      const monitorTickMs = Number(runCfg?.monitorTickMs ?? 0);
      const hzOk = hzSet.length > 0 && hzSet.every((h: number) => h === 0.5 || h === 1);
      const loadOk = loadSet.every((l: number) => l === 0);
      const clientsOk = clientsHttp === 0 && clientsWs === 0;
      const durOk = durationSec <= 6;
      const tickOk = monitorTickMs >= 500;
      return hzOk && loadOk && clientsOk && durOk && tickOk;
    } catch {
      return false;
    }
  })();

  // Build table header aligned with generated rows (includes nUsed/nTotal)
  const header = `| Label | Mode | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | Staleness [ms] | ELU p99 [ms] | CPU [%] | RSS [MB] | n (used/total) | Rate OK | Payload OK |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--:|:--:|:--:|`;
  const rows = items
    .map(s => {
      const rateOk = s.rateOk === undefined ? '—' : s.rateOk ? '✅' : '❌';
      const payloadOk =
        s.payloadOk === undefined ? '—' : s.payloadOk ? '✅' : '❌';
      const nUsed = (s.nUsed ?? s.count) as number;
      const nTotal = (s.nTotal ?? s.count) as number;
      return `| ${s.label} | ${s.mode} | ${s.avgRate.toFixed(2)} | ${s.avgBytesRate.toFixed(0)} | ${s.avgPayload.toFixed(0)} | ${s.avgJitterMs.toFixed(1)} | ${s.avgFreshnessMs.toFixed(0)} | ${s.avgDelayP99.toFixed(1)} | ${s.avgCpu.toFixed(1)} | ${s.avgRss.toFixed(1)} | ${nUsed}/${nTotal} | ${rateOk} | ${payloadOk} |`;
    })
    .join('\n');

  const notes = items
    .map(
      s =>
        `- ${s.label}: ${s.checks?.join('; ') || ''} ${s.warmupSec || 0 || s.cooldownSec || 0 ? `(trim: warmup=${s.warmupSec || 0}s, cooldown=${s.cooldownSec || 0}s)` : ''}`,
    )
    .join('\n');

  const block = `Ostatni run: ${latest}

Pliki: [sessions.csv](../api/benchmarks/${latest}/sessions.csv), [summary.json](../api/benchmarks/${latest}/summary.json), [README](../api/benchmarks/${latest}/README.md)

Uwaga: tabele uporządkowane wg: Mode (WS, HTTP) → Hz → Obciążenie → Klienci.
${isSafeRun ? '\nUwaga (SAFE): krótki przebieg 0.5–1 Hz bez obciążenia; walidacja odchyleń Rate oznaczana jako WARN (nie FAIL), by unikać fałszywych negatywów przy małym n.' : ''}

${header}
${rows}

${renderRunConfig(runCfg)}

${renderByLoadSection(byLoad)}

${renderByClientsSection(byClients)}

${renderMetrology(items)}
${renderMetrologyGuide()}

${renderConclusions(items)}
${renderConclusionsVisual(byLoad, byClients)}
${renderConclusionsSummary(items)}
`;

  const md = await fs.readFile(researchPath, 'utf8');
  const start = '<!-- AUTO-RESULTS:BEGIN -->';
  const end = '<!-- AUTO-RESULTS:END -->';
  const sIdx = md.indexOf(start);
  const eIdx = md.indexOf(end);
  if (sIdx === -1 || eIdx === -1) {
    throw new Error(
      'Nie znaleziono znaczników AUTO-RESULTS w ASPEKT_BADAWCZY.md',
    );
  }
  const before = md.slice(0, sIdx + start.length);
  const after = md.slice(eIdx);
  const updated = `${before}\n\n${block}\n${after}`;
  await fs.writeFile(researchPath, updated, 'utf8');
  console.log('Zaktualizowano docs/ASPEKT_BADAWCZY.md wynikami z', latest);
}

main().catch(err => {
  console.error('Błąd aktualizacji dokumentu badawczego:', err.message);
  process.exit(1);
});

function renderRunConfig(cfg?: any): string {
  if (!cfg) return '';
  const modes = Array.isArray(cfg.modes)
    ? cfg.modes.join(', ')
    : String(cfg.modes ?? '—');
  const hz = Array.isArray(cfg.hzSet)
    ? cfg.hzSet.join(', ')
    : String(cfg.hzSet ?? '—');
  const load = Array.isArray(cfg.loadSet)
    ? cfg.loadSet.join(', ')
    : String(cfg.loadSet ?? '—');
  return `

Parametry przyjęte w ostatnim runie:
- Metody: ${modes}
- Częstotliwości [Hz]: ${hz}
- Obciążenia CPU [%]: ${load}
- Czas sesji [s]: ${cfg.durationSec}
- MONITOR_TICK_MS: ${cfg.monitorTickMs}
- Payloady: WS=${cfg.wsPayload}B, HTTP=${cfg.httpPayload}B
- Klienci: clientsHttp=${cfg.clientsHttp}, clientsWs=${cfg.clientsWs}
- Warmup/Cooldown [s]: ${cfg.warmupSec || 0} / ${cfg.cooldownSec || 0}
`;
}

function renderByLoadSection(byLoad: Array<any>): string {
  if (!byLoad || byLoad.length === 0) return '';
  const ws = byLoad.filter(r => r.mode === 'ws');
  const http = byLoad.filter(r => r.mode === 'polling');
  const header = `| Obciążenie | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | ELU p99 [ms] | CPU [%] | RSS [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|`;
  const mk = (rows: any[]) =>
    rows
      .sort((a, b) => (a.loadCpuPct ?? 0) - (b.loadCpuPct ?? 0))
      .map(
        r =>
          `| ${r.loadCpuPct ?? 0}% | ${nf(r.avgRate, 2)} | ${nf(r.avgBytesRate, 0)} | ${nf(r.avgPayload, 0)} | ${nf(r.avgJitterMs, 1)} | ${nf(r.avgDelayP99, 1)} | ${nf(r.avgCpu, 1)} | ${nf(r.avgRss, 1)} |`,
      )
      .join('\n');
  const wsTbl = ws.length
    ? `### Porównanie wg obciążenia — WebSocket\n\n${header}\n${mk(ws)}\n\n`
    : '';
  const httpTbl = http.length
    ? `### Porównanie wg obciążenia — HTTP polling\n\n${header}\n${mk(http)}\n\n`
    : '';
  return `\n\n## Uśrednione wyniki wg obciążenia\n\nUwaga: "Obciążenie" oznacza sztuczne obciążenie CPU procesu podczas sesji (generator w worker_threads).\n\n${wsTbl}${httpTbl}`;
}

function nf(n: any, frac = 1): string {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(frac) : '—';
}

function renderMetrology(items: Array<any>): string {
  if (!items || items.length === 0) return '';
  const header = `| Label | n (used/total) | Rate [/s] | CI95 Rate | σ(rate) | Bytes/s | CI95 Bytes | σ(bytes) |
|---|:--:|---:|---:|---:|---:|---:|---:|`;
  const rows = items
    .map(s => {
      const nUsed = (s.nUsed ?? s.count) as number;
      const nTotal = (s.nTotal ?? s.count) as number;
      const ciRate = Number(s.ci95Rate ?? 0);
      const ciBytes = Number(s.ci95Bytes ?? 0);
      const rateStd = Number(s.rateStd ?? 0);
      const bytesStd = Number(s.bytesStd ?? 0);
      return `| ${s.label} | ${nUsed}/${nTotal} | ${nf(s.avgRate, 2)} | ± ${nf(ciRate, 2)} | ${nf(rateStd, 2)} | ${nf(s.avgBytesRate, 0)} | ± ${nf(ciBytes, 0)} | ${nf(bytesStd, 0)} |`;
    })
    .join('\n');

  return `\n\n## Metrologia (95% CI) — ostatni run\n\nNiepewność średnich estymowana z próbek (tick ~ ${process.env.MONITOR_TICK_MS || '1000'} ms).\n\n${header}\n${rows}\n`;
}

function renderByClientsSection(byClients: Array<any>): string {
  if (!byClients || byClients.length === 0) return '';
  const ws = byClients.filter(r => r.mode === 'ws');
  const http = byClients.filter(r => r.mode === 'polling');
  const header = `| Klienci | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | ELU p99 [ms] | CPU [%] | RSS [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|`;
  const mk = (rows: any[]) =>
    rows
      .sort((a, b) => (a.clients ?? 0) - (b.clients ?? 0))
      .map(
        r =>
          `| ${r.clients ?? 0} | ${nf(r.avgRate, 2)} | ${nf(r.avgBytesRate, 0)} | ${nf(r.avgPayload, 0)} | ${nf(r.avgJitterMs, 1)} | ${nf(r.avgDelayP99, 1)} | ${nf(r.avgCpu, 1)} | ${nf(r.avgRss, 1)} |`,
      )
      .join('\n');
  const wsTbl = ws.length
    ? `### Zestawienie wg liczby klientów — WebSocket\n\n${header}\n${mk(ws)}\n\n`
    : '';
  const httpTbl = http.length
    ? `### Zestawienie wg liczby klientów — HTTP polling\n\n${header}\n${mk(http)}\n\n`
    : '';
  return `\n\n## Uśrednione wyniki wg liczby klientów\n\nUwaga: "Liczba klientów" to liczba równoległych syntetycznych klientów generowanych wewnętrznie na czas sesji (HTTP: liczbę timerów; WS: efektywną sumaryczną częstość).\n\n${wsTbl}${httpTbl}`;
}

function renderConclusions(items: Array<any>): string {
  if (!items || items.length === 0) return '';
  const bullets = items
    .map(
      s =>
        `- ${s.label}: ${s.checks?.join('; ') || ''} ${
          s.warmupSec || 0 || s.cooldownSec || 0
            ? `(trim: warmup=${s.warmupSec || 0}s, cooldown=${s.cooldownSec || 0}s)`
            : ''
        }`,
    )
    .join('\n');
  return `\n\n## Wnioski (syntetyczne)\n\n${bullets}\n`;
}

function renderMetrologyGuide(): string {
  return `\n\n### Metrologia — jak czytać i co oznaczają wyniki\n\n- n (used/total): liczba próbek wykorzystanych w średnich po trimowaniu vs. całkowita. Zalecane n(used) ≥ 10.\n- Rate [/s] i CI95 Rate: średnia częstość i 95% przedział ufności (mniejszy CI → stabilniejsze wyniki).\n  - Heurystyka: CI95/średnia < 30% uznajemy za stabilne dla krótkich przebiegów.\n- σ(rate): odchylenie standardowe — informuje o zmienności częstości między próbkami.\n- Bytes/s i CI95 Bytes: przepływność i jej niepewność. Dla stałego payloadu oczekujemy Bytes/s ≈ Rate × Payload.\n- Tick ~ ms: okres próbkowania monitoringu; zbyt duży tick zmniejsza rozdzielczość czasową, zbyt mały — może zwiększać jitter pomiaru.\n- Wpływ warmup/cooldown: odcięcie początkowych/końcowych odcinków stabilizuje średnie i zwęża CI.\n- Minimalne kryteria wiarygodności (propozycja):\n  - n(used) ≥ 10, CI95/średnia (Rate) < 30%, CI95/średnia (Bytes/s) < 30%.\n  - Relacja Bytes≈Rate×Payload: błąd względny < 30% dla przebiegów kontrolowanych.\n`;
}

// Visual comparison helpers
function bestMark(
  val: number,
  better: 'low' | 'high',
  others: number[],
): string {
  const list = [val, ...others].filter(x => Number.isFinite(x));
  if (list.length <= 1) return '';
  const min = Math.min(...list);
  const max = Math.max(...list);
  if (better === 'low' && val === min) return '**';
  if (better === 'high' && val === max) return '**';
  return '';
}

function renderWsHttpComparisonRows(
  rows: Array<any>,
  keyLabel: string,
): string {
  // rows expected: mix of ws and polling with comparable keys: loadCpuPct or clients
  // Group by key value
  const groups = new Map<number, { ws?: any; http?: any }>();
  for (const r of rows) {
    const key = (keyLabel === 'Obciążenie' ? r.loadCpuPct : r.clients) ?? 0;
    const g = groups.get(key) || {};
    if (r.mode === 'ws') g.ws = r;
    else if (r.mode === 'polling') g.http = r;
    groups.set(key, g);
  }
  const keys = Array.from(groups.keys()).sort((a, b) => a - b);
  const lines: string[] = [];
  for (const k of keys) {
    const g = groups.get(k)!;
    const ws = g.ws;
    const http = g.http;
    const rateWs = Number(ws?.avgRate ?? NaN);
    const rateHttp = Number(http?.avgRate ?? NaN);
    const bRateWs = bestMark(rateWs, 'high', [rateHttp]);
    const bRateHttp = bestMark(rateHttp, 'high', [rateWs]);

    const jitWs = Number(ws?.avgJitterMs ?? NaN);
    const jitHttp = Number(http?.avgJitterMs ?? NaN);
    const bJitWs = bestMark(jitWs, 'low', [jitHttp]);
    const bJitHttp = bestMark(jitHttp, 'low', [jitWs]);

    const staleWs = Number(ws?.avgFreshnessMs ?? NaN);
    const staleHttp = Number(http?.avgFreshnessMs ?? NaN);
    const bStaleWs = bestMark(staleWs, 'low', [staleHttp]);
    const bStaleHttp = bestMark(staleHttp, 'low', [staleWs]);

    const cpuWs = Number(ws?.avgCpu ?? NaN);
    const cpuHttp = Number(http?.avgCpu ?? NaN);
    const bCpuWs = bestMark(cpuWs, 'low', [cpuHttp]);
    const bCpuHttp = bestMark(cpuHttp, 'low', [cpuWs]);

    const rssWs = Number(ws?.avgRss ?? NaN);
    const rssHttp = Number(http?.avgRss ?? NaN);
    const bRssWs = bestMark(rssWs, 'low', [rssHttp]);
    const bRssHttp = bestMark(rssHttp, 'low', [rssWs]);

    const elpWs = Number(ws?.avgDelayP99 ?? NaN);
    const elpHttp = Number(http?.avgDelayP99 ?? NaN);
    const bElpWs = bestMark(elpWs, 'low', [elpHttp]);
    const bElpHttp = bestMark(elpHttp, 'low', [elpWs]);

    const fmt = (n: number, f = 2) => (Number.isFinite(n) ? n.toFixed(f) : '—');
    lines.push(
      `| ${k} | ${bRateWs}${fmt(rateWs)}${bRateWs} | ${bRateHttp}${fmt(rateHttp)}${bRateHttp} | ${bJitWs}${fmt(jitWs, 1)}${bJitWs} | ${bJitHttp}${fmt(jitHttp, 1)}${bJitHttp} | ${bStaleWs}${fmt(staleWs, 0)}${bStaleWs} | ${bStaleHttp}${fmt(staleHttp, 0)}${bStaleHttp} | ${bElpWs}${fmt(elpWs, 1)}${bElpWs} | ${bElpHttp}${fmt(elpHttp, 1)}${bElpHttp} | ${bCpuWs}${fmt(cpuWs, 1)}${bCpuWs} | ${bCpuHttp}${fmt(cpuHttp, 1)}${bCpuHttp} | ${bRssWs}${fmt(rssWs, 1)}${bRssWs} | ${bRssHttp}${fmt(rssHttp, 1)}${bRssHttp} |`,
    );
  }
  return lines.join('\n');
}

function renderConclusionsVisual(
  byLoad: Array<any>,
  byClients: Array<any>,
): string {
  let parts: string[] = [];
  if (byLoad && byLoad.length >= 2) {
    parts.push('\n\n### Wnioski — porównanie WS vs HTTP wg obciążenia');
    parts.push(
      '\n\n| Obciążenie [%] | Rate WS [/s] | Rate HTTP [/s] | Jitter WS [ms] | Jitter HTTP [ms] | Staleness WS [ms] | Staleness HTTP [ms] | ELU p99 WS [ms] | ELU p99 HTTP [ms] | CPU WS [%] | CPU HTTP [%] | RSS WS [MB] | RSS HTTP [MB] |',
    );
    parts.push(
      '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    );
    parts.push(renderWsHttpComparisonRows(byLoad, 'Obciążenie'));
  }
  if (byClients && byClients.length >= 2) {
    parts.push('\n\n### Wnioski — porównanie WS vs HTTP wg liczby klientów');
    parts.push(
      '\n\n| Klienci | Rate WS [/s] | Rate HTTP [/s] | Jitter WS [ms] | Jitter HTTP [ms] | Staleness WS [ms] | Staleness HTTP [ms] | ELU p99 WS [ms] | ELU p99 HTTP [ms] | CPU WS [%] | CPU HTTP [%] | RSS WS [MB] | RSS HTTP [MB] |',
    );
    parts.push(
      '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    );
    parts.push(renderWsHttpComparisonRows(byClients, 'Klienci'));
  }
  if (parts.length === 0) return '';
  // Optional tiny chart via Mermaid (only if both methods present and 1-2 groups to keep it small)
  return `\n\n## Wnioski — wizualne porównanie\n${parts.join('\n')}`;
}

function renderConclusionsSummary(items: Array<any>): string {
  if (!items || items.length === 0) return '';
  const modes: Record<string, any[]> = { ws: [], polling: [] };
  for (const s of items) {
    if (s.mode === 'ws') modes.ws.push(s);
    if (s.mode === 'polling') modes.polling.push(s);
  }
  const avg = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN;
  const wsRate = avg(modes.ws.map(s => Number(s.avgRate)));
  const httpRate = avg(modes.polling.map(s => Number(s.avgRate)));
  const wsJit = avg(modes.ws.map(s => Number(s.avgJitterMs)));
  const httpJit = avg(modes.polling.map(s => Number(s.avgJitterMs)));
  const wsFresh = avg(modes.ws.map(s => Number(s.avgFreshnessMs)));
  const httpFresh = avg(modes.polling.map(s => Number(s.avgFreshnessMs)));
  const wsCpu = avg(modes.ws.map(s => Number(s.avgCpu)));
  const httpCpu = avg(modes.polling.map(s => Number(s.avgCpu)));
  const fmt = (n: number, f = 2) => (Number.isFinite(n) ? n.toFixed(f) : '—');
  const bullets = [
    `- Średnio (ten run): Rate — WS ${fmt(wsRate)} /s vs HTTP ${fmt(httpRate)} /s`,
    `- Średnio: Jitter — WS ${fmt(wsJit, 1)} ms vs HTTP ${fmt(httpJit, 1)} ms (niżej = stabilniej)`,
    `- Średnio: Staleness — WS ${fmt(wsFresh, 0)} ms vs HTTP ${fmt(httpFresh, 0)} ms (niżej = świeżej)`,
    `- Średnio: CPU — WS ${fmt(wsCpu, 1)}% vs HTTP ${fmt(httpCpu, 1)}% (niżej = lżej)`,
  ].join('\n');
  return `\n\n### Wnioski — krótkie podsumowanie (WS vs HTTP)\n\n${bullets}\n`;
}
