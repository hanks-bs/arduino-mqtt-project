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
  if (candidates.length === 0)
    throw new Error('Brak katalogów wyników w api/benchmarks');
  // Preferuj najnowszy po czasie modyfikacji; przy remisie fallback do sortowania nazwą malejąco
  candidates.sort((a, b) => {
    if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
    return a.name > b.name ? -1 : 1;
  });
  const latest = candidates[0].name;
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
        repeats?: number;
      };
  const byLoad: Array<any> = (summary.byLoad || []) as Array<any>;
  const byClients: Array<any> = (summary.byClients || []) as Array<any>;
  const flags = (summary.flags || {}) as {
    fairPayload?: boolean;
    sourceLimited?: boolean;
  };

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
      const hzOk =
        hzSet.length > 0 && hzSet.every((h: number) => h === 0.5 || h === 1);
      const loadOk = loadSet.every((l: number) => l === 0);
      const clientsOk = clientsHttp === 0 && clientsWs === 0;
      const durOk = durationSec <= 6;
      const tickOk = monitorTickMs >= 500;
      return hzOk && loadOk && clientsOk && durOk && tickOk;
    } catch {
      return false;
    }
  })();

  const fairPayload =
    typeof flags.fairPayload === 'boolean'
      ? flags.fairPayload
      : runCfg?.wsPayload === runCfg?.httpPayload;
  const sourceLimited = flags.sourceLimited === true;

  // Build table header aligned with generated rows (includes per-client and nUsed/nTotal)
  const header = `| Label | Mode | Rate [/s] | Rate/cli [/s] | Bytes/s | Bytes/cli [B/s] | Egress est. [B/s] | ~Payload [B] | Jitter [ms] | Staleness [ms] | ELU p99 [ms] | CPU [%] | RSS [MB] | n (used/total) | Rate OK | Payload OK |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--:|:--:|:--:|`;
  const compactHeader = `| Label | Mode | Rate/cli [/s] | Bytes/cli [B/s] | Jitter [ms] | Staleness [ms] | CPU [%] | RSS [MB] |
|---|---:|---:|---:|---:|---:|---:|---:|`;
  const rows = items
    .map(s => {
      const rateOk = s.rateOk === undefined ? '—' : s.rateOk ? '✅' : '❌';
      const payloadOk =
        s.payloadOk === undefined ? '—' : s.payloadOk ? '✅' : '❌';
      const nUsed = (s.nUsed ?? s.count) as number;
      const nTotal = (s.nTotal ?? s.count) as number;
      const rep =
        s.repIndex && s.repTotal ? ` [rep ${s.repIndex}/${s.repTotal}]` : '';
      const clients =
        s.mode === 'ws' ? Number(s.clientsWs ?? 0) : Number(s.clientsHttp ?? 0);
      // WS: pokaż per‑client nawet przy N=0 (Rate/cli=Rate, Bytes/cli=Rate×Payload w summary)
      const rateCli =
        s.mode === 'ws'
          ? Number(s.ratePerClient)
          : clients > 0 && Number.isFinite(Number(s.ratePerClient))
            ? Number(s.ratePerClient)
            : NaN;
      const bytesCli =
        s.mode === 'ws'
          ? Number(s.bytesRatePerClient)
          : clients > 0 && Number.isFinite(Number(s.bytesRatePerClient))
            ? Number(s.bytesRatePerClient)
            : NaN;
      const egressEst = (() => {
        const avgRate = Number(s.avgRate);
        const avgBytesRate = Number(s.avgBytesRate);
        const payload = Number(s.avgPayload);
        const N = Math.max(0, clients);
        if (s.mode === 'ws') {
          // Oszacowanie kosztu sieci łącznego: Rate × Payload × N
          const v = avgRate * payload * N;
          return Number.isFinite(v) ? v : NaN;
        }
        // HTTP Bytes/s już sumuje po klientach
        return Number.isFinite(avgBytesRate) ? avgBytesRate : NaN;
      })();
      const fmt = (n: number, f = 2) =>
        Number.isFinite(n) ? n.toFixed(f) : '—';
      const stale = Number.isFinite(Number((s as any).avgStalenessMs))
        ? Number((s as any).avgStalenessMs)
        : Number(s.avgFreshnessMs);
      return `| ${s.label}${rep} | ${s.mode} | ${fmt(s.avgRate, 2)} | ${fmt(rateCli, 2)} | ${fmt(s.avgBytesRate, 0)} | ${fmt(bytesCli, 0)} | ${fmt(egressEst, 0)} | ${fmt(s.avgPayload, 0)} | ${fmt(s.avgJitterMs, 1)} | ${fmt(stale, 0)} | ${fmt(s.avgDelayP99, 1)} | ${fmt(s.avgCpu, 1)} | ${fmt(s.avgRss, 1)} | ${nUsed}/${nTotal} | ${rateOk} | ${payloadOk} |`;
    })
    .join('\n');
  const compactRows = items
    .map(s => {
      const clients =
        s.mode === 'ws' ? Number(s.clientsWs ?? 0) : Number(s.clientsHttp ?? 0);
      const rateCli =
        s.mode === 'ws'
          ? Number(s.ratePerClient)
          : clients > 0 && Number.isFinite(Number(s.ratePerClient))
            ? Number(s.ratePerClient)
            : NaN;
      const bytesCli =
        s.mode === 'ws'
          ? Number(s.bytesRatePerClient)
          : clients > 0 && Number.isFinite(Number(s.bytesRatePerClient))
            ? Number(s.bytesRatePerClient)
            : NaN;
      const rep =
        s.repIndex && s.repTotal ? ` [rep ${s.repIndex}/${s.repTotal}]` : '';
      const fmt = (n: number, f = 2) =>
        Number.isFinite(n) ? n.toFixed(f) : '—';
      const stale = Number.isFinite(Number((s as any).avgStalenessMs))
        ? Number((s as any).avgStalenessMs)
        : Number(s.avgFreshnessMs);
      return `| ${s.label}${rep} | ${s.mode} | ${fmt(rateCli, 2)} | ${fmt(bytesCli, 0)} | ${fmt(s.avgJitterMs, 1)} | ${fmt(stale, 0)} | ${fmt(s.avgCpu, 1)} | ${fmt(s.avgRss, 1)} |`;
    })
    .join('\n');

  const notes = items
    .map(
      s =>
        `- ${s.label}: ${s.checks?.join('; ') || ''} ${s.warmupSec || 0 || s.cooldownSec || 0 ? `(trim: warmup=${s.warmupSec || 0}s, cooldown=${s.cooldownSec || 0}s)` : ''}`,
    )
    .join('\n');

  const statusBar = `Status: fair payload: ${fairPayload ? 'TAK' : 'NIE'}, source-limited: ${sourceLimited ? 'TAK' : 'NIE'}, czas: ${runCfg?.durationSec ?? '—'}s, tick: ${runCfg?.monitorTickMs ?? '—'} ms, repeats: ${runCfg?.repeats ?? '—'}`;
  const sourceNote = sourceLimited
    ? '\nUwaga: Etykiety @Hz odnoszą się do tempa transportu, ale run ograniczony przez źródło; różnice WS vs HTTP w Rate nie są miarodajne.'
    : '';
  const clientsZeroNote =
    '\nUwaga: Scenariusze z liczbą klientów = 0 mają różną semantykę: WS (push) emituje niezależnie od liczby klientów — per‑client raportujemy Rate/cli = Rate oraz Bytes/cli ≈ Rate×Payload; HTTP (pull) przy 0 klientach nie generuje żądań → pola per‑client są puste (—). Dlatego w porównaniach WS vs HTTP ("Zwycięzcy", tabele WS vs HTTP) wiersze HTTP z N=0 są pomijane.';
  const example = renderPerClientExample(items);
  const block = `Ostatni run: ${latest}

${statusBar}

Pliki: [sessions.csv](../api/benchmarks/${latest}/sessions.csv), [summary.json](../api/benchmarks/${latest}/summary.json), [README](../api/benchmarks/${latest}/README.md)

Uwaga: tabele uporządkowane wg: Mode (WS, HTTP) → Hz → Obciążenie → Klienci.
${isSafeRun ? '\nUwaga (SAFE): krótki przebieg 0.5–1 Hz bez obciążenia; walidacja odchyleń Rate oznaczana jako WARN (nie FAIL), by unikać fałszywych negatywów przy małym n.' : ''}${sourceNote}${clientsZeroNote}

Uwaga (per klient): kolumny Rate/cli i Bytes/cli pokazują wartości znormalizowane per odbiorcę.
- HTTP: wartości łączne (Rate, Bytes/s) rosną proporcjonalnie do liczby klientów N; per‑client = łączna wartość / N.
- WS (broadcast): Rate/cli ≈ Rate (nie dzielimy przez N); Bytes/cli ≈ Rate × Payload (co odbiera pojedynczy klient). Dla N>0 w pełnej tabeli Bytes/cli może być równoważnie prezentowane jako Bytes/s ÷ N (perspektywa serwera).
- HTTP z N=0: pola per‑client są puste (—).
Uwaga (WS — egress): kolumna Egress est. szacuje łączny koszt sieci: WS ≈ Rate × Payload × N; HTTP ≈ Bytes/s (już zsumowane po klientach).
Kluczowe porównania (TL;DR, zwycięzcy, tabele wizualne) stosują Rate/cli: w WS nie dzielimy przez N, w HTTP dzielimy przez N — dzięki temu liczby są porównywalne per użytkownik.
${example}

${renderTLDR(items)}

### Jak interpretować wyniki (protokół rzetelnego porównania)

- Porównuj per klienta: Rate/cli (wyżej = lepiej), Jitter i Staleness (niżej = lepiej), CPU i RSS (niżej = lepiej).
- Uwzględnij niepewność: jeśli 95% CI dwóch wartości mocno się pokrywa, traktuj różnicę jako niepewną.
- Progi praktyczne (szybkie kryteria istotności):
  - Rate/cli: różnica ≥ 10–15% i poza nakładaniem się 95% CI.
  - Jitter/Staleness: różnica ≥ 20% (lub ≥ 50 ms gdy wartości są rzędu setek ms).
  - CPU: różnice < 3–5 pp przy niskich obciążeniach to często szum; > 5–7 pp — potencjalnie istotne.
  - RSS: różnice < 10 MB zwykle pomijalne w tym kontekście, chyba że utrzymują się we wszystkich scenariuszach.
- Spójność: uznaj różnicę za „realną”, jeśli powtarza się w obu powtórzeniach oraz w agregatach „wg obciążenia” i „wg liczby klientów”.
- Semantyka WS vs HTTP: dla kosztu sieci WS oszacuj egress ≈ Rate × Payload × N (na wszystkich klientów); dla HTTP Bytes/s już zawiera sumę po klientach.

${compactHeader}
${compactRows}

<details>
<summary>Szczegóły (pełna tabela)</summary>

${header}
${rows}

</details>

${renderRunConfig(runCfg)}

${renderByLoadSection(byLoad)}

${renderByClientsSection(byClients)}

${renderMetrology(items, runCfg?.monitorTickMs)}
${renderE2ELatency(items)}
${renderMetrologyGuide()}

${renderPairedComparisons(items)}

${renderConclusions(items)}
${await renderValidationSection(latestDir, items)}
${renderWinners(items, byLoad, byClients)}
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
  // Znormalizuj wielokrotne puste linie w bloku, by spełnić lint (MD012)
  const normalizedBlock = ('\n' + block + '\n').replace(/\n{3,}/g, '\n\n');
  const updated = `${before}${normalizedBlock}${after}`;
  await fs.writeFile(researchPath, updated, 'utf8');
  console.log('Zaktualizowano docs/ASPEKT_BADAWCZY.md wynikami z', latest);
}

main().catch(err => {
  console.error('Błąd aktualizacji dokumentu badawczego:', err.message);
  process.exit(1);
});

async function renderValidationSection(
  latestDir: string,
  items: Array<any>,
): Promise<string> {
  try {
    const p = path.join(latestDir, 'validation.txt');
    const exists = await fs.pathExists(p);
    const lines: string[] = [];
    // Quick stats
    const nMins = items
      .map(s => Number(s.nUsed ?? s.count ?? 0))
      .filter(Number.isFinite) as number[];
    const minN = nMins.length ? Math.min(...nMins) : 0;
    const rateOkCnt = items.filter(s => s.rateOk === true).length;
    const rateTotal = items.filter(s => s.rateOk !== undefined).length;
    const payloadOkCnt = items.filter(s => s.payloadOk === true).length;
    const payloadTotal = items.filter(s => s.payloadOk !== undefined).length;
    const relCi = (mean: number, ci?: number) =>
      mean > 0 && Number.isFinite(ci) ? ci! / mean : NaN;
    const ciRateVals = items
      .map(s => relCi(Number(s.avgRate), Number(s.ci95Rate)))
      .filter(v => Number.isFinite(v)) as number[];
    const ciBytesVals = items
      .map(s => relCi(Number(s.avgBytesRate), Number(s.ci95Bytes)))
      .filter(v => Number.isFinite(v)) as number[];
    const avg = (a: number[]) =>
      a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
    const pct = (n: number, d: number) =>
      d > 0 ? `${((n / d) * 100).toFixed(0)}% (${n}/${d})` : '—';
    lines.push('## Walidacja wiarygodności i poprawności');
    if (exists) {
      const txt = await fs.readFile(p, 'utf8');
      const statusLine =
        txt.split(/\r?\n/).find(l => l.startsWith('Validation status:')) || '';
      const runLine = txt.split(/\r?\n/).find(l => l.startsWith('Run:')) || '';
      lines.push('', statusLine, runLine);
    } else {
      lines.push('', 'Brak pliku validation.txt dla ostatniego runu.');
    }
    lines.push(
      '',
      `- Rate OK: ${pct(rateOkCnt, rateTotal)}`,
      `- Payload OK: ${pct(payloadOkCnt, payloadTotal)}`,
      `- Minimalna liczba próbek n(used): ${minN}`,
      `- Średni względny CI95: Rate ≈ ${Number.isFinite(avg(ciRateVals)) ? (avg(ciRateVals) * 100).toFixed(0) + '%' : '—'}, Bytes/s ≈ ${Number.isFinite(avg(ciBytesVals)) ? (avg(ciBytesVals) * 100).toFixed(0) + '%' : '—'}`,
      '',
      'Uwaga: FAIL wynika głównie z odchyleń Rate od oczekiwanych Hz. To spodziewane, jeśli źródło danych (Arduino/MQTT) publikuje ~1 Hz niezależnie od ustawień nominalnych. Payload przechodzi (OK) we wszystkich scenariuszach.',
    );
    return '\n' + lines.join('\n') + '\n';
  } catch {
    return '';
  }
}

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
- Repeats: ${cfg.repeats}
`;
}

function renderByLoadSection(byLoad: Array<any>): string {
  if (!byLoad || byLoad.length === 0) return '';
  const ws = byLoad.filter(r => r.mode === 'ws');
  const http = byLoad.filter(r => r.mode === 'polling');
  const header = `| Obciążenie | Rate/cli [/s] | Bytes/cli [B/s] | Jitter [ms] | Staleness [ms] | CPU [%] | RSS [MB] |
|---:|---:|---:|---:|---:|---:|---:|`;
  const mk = (rows: any[]) =>
    rows
      .sort((a, b) => (a.loadCpuPct ?? 0) - (b.loadCpuPct ?? 0))
      .map(
        r =>
          `| ${r.loadCpuPct ?? 0}% | ${nf(r.avgRatePerClient, 2)} | ${nf(r.avgBytesPerClient, 0)} | ${nf(r.avgJitterMs, 1)} | ${nf(r.avgFreshnessMs, 0)} | ${nf(r.avgCpu, 1)} | ${nf(r.avgRss, 1)} |`,
      )
      .join('\n');
  const wsTbl = ws.length
    ? `### Porównanie wg obciążenia — WebSocket\n\n${header}\n${mk(ws)}\n\n`
    : '';
  const httpTbl = http.length
    ? `### Porównanie wg obciążenia — HTTP polling\n\n${header}\n${mk(http)}\n\n`
    : '';
  return `\n\n## Uśrednione wyniki wg obciążenia\n\nUwaga: "Obciążenie" oznacza sztuczne obciążenie CPU procesu podczas sesji (generator w worker_threads). Kolumny /cli to normalizacja per odbiorcę (HTTP: suma/N; WS: Rate/cli≈Rate, Bytes/cli≈Rate×Payload).\n\n${wsTbl}${httpTbl}`;
}

function nf(n: any, frac = 1): string {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(frac) : '—';
}

function renderMetrology(items: Array<any>, tickMs?: number): string {
  if (!items || items.length === 0) return '';
  const header = `| Label | n (used/total) | Rate [/s] | CI95 Rate | CI95/avg | σ(rate) | Median Rate | Bytes/s | CI95 Bytes | CI95/avg | σ(bytes) | Median Bytes |
|---|:--:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|`;
  const rows = items
    .map(s => {
      const nUsed = (s.nUsed ?? s.count) as number;
      const nTotal = (s.nTotal ?? s.count) as number;
      const ciRate = Number(s.ci95Rate ?? 0);
      const ciBytes = Number(s.ci95Bytes ?? 0);
      const rateStd = Number(s.rateStd ?? 0);
      const bytesStd = Number(s.bytesStd ?? 0);
      const relCiRate = Number(
        s.relCiRate ?? (ciRate && s.avgRate ? ciRate / s.avgRate : 0),
      );
      const relCiBytes = Number(
        s.relCiBytes ??
          (ciBytes && s.avgBytesRate ? ciBytes / s.avgBytesRate : 0),
      );
      return `| ${s.label} | ${nUsed}/${nTotal} | ${nf(s.avgRate, 2)} | ± ${nf(ciRate, 2)} | ${nf(relCiRate * 100, 0)}% | ${nf(rateStd, 2)} | ${nf(s.rateMedian, 2)} | ${nf(s.avgBytesRate, 0)} | ± ${nf(ciBytes, 0)} | ${nf(relCiBytes * 100, 0)}% | ${nf(bytesStd, 0)} | ${nf(s.bytesMedian, 0)} |`;
    })
    .join('\n');

  const tick =
    Number.isFinite(Number(tickMs)) && Number(tickMs) > 0
      ? String(tickMs)
      : '—';
  return `\n\n## Metrologia (95% CI) — ostatni run\n\nNiepewność średnich estymowana z próbek (tick ~ ${tick} ms).\n\n${header}\n${rows}\n`;
}

function renderE2ELatency(items: Array<any>): string {
  try {
    if (!items || items.length === 0) return '';
    const header = `\n\n## E2E latency (źródło→ingest→emit) [ms]\n\n| Label | Src→Ingest avg | Src→Ingest p95 | Ingest→Emit avg | Ingest→Emit p95 | Src→Emit avg | Src→Emit p95 |\n|---|---:|---:|---:|---:|---:|---:|`;
    const f = (v: any, d = 1) =>
      Number.isFinite(Number(v)) ? Number(v).toFixed(d) : '—';
    const rows = items
      .map(
        s =>
          `| ${s.label} | ${f((s as any).avgSrcToIngestMs)} | ${f((s as any).p95SrcToIngestMs)} | ${f((s as any).avgIngestToEmitMs)} | ${f((s as any).p95IngestToEmitMs)} | ${f((s as any).avgSrcToEmitMs)} | ${f((s as any).p95SrcToEmitMs)} |`,
      )
      .join('\n');
    return `\n${header}\n${rows}\n`;
  } catch {
    return '';
  }
}

function renderByClientsSection(byClients: Array<any>): string {
  if (!byClients || byClients.length === 0) return '';
  const ws = byClients.filter(r => r.mode === 'ws');
  const http = byClients.filter(r => r.mode === 'polling');
  const header = `| Klienci | Rate/cli [/s] | Bytes/cli [B/s] | Jitter [ms] | Staleness [ms] | CPU [%] | RSS [MB] |
|---:|---:|---:|---:|---:|---:|---:|`;
  const mk = (rows: any[]) =>
    rows
      .sort((a, b) => (a.clients ?? 0) - (b.clients ?? 0))
      .map(
        r =>
          `| ${r.clients ?? 0} | ${nf(r.avgRatePerClient, 2)} | ${nf(r.avgBytesPerClient, 0)} | ${nf(r.avgJitterMs, 1)} | ${nf(r.avgFreshnessMs, 0)} | ${nf(r.avgCpu, 1)} | ${nf(r.avgRss, 1)} |`,
      )
      .join('\n');
  const wsTbl = ws.length
    ? `### Zestawienie wg liczby klientów — WebSocket\n\n${header}\n${mk(ws)}\n\n`
    : '';
  const httpTbl = http.length
    ? `### Zestawienie wg liczby klientów — HTTP polling\n\n${header}\n${mk(http)}\n\n`
    : '';
  return `\n\n## Uśrednione wyniki wg liczby klientów\n\nUwaga: "Liczba klientów" to liczba równoległych syntetycznych klientów generowanych wewnętrznie na czas sesji (HTTP: liczbę timerów; WS: efektywną sumaryczną częstość). Kolumny /cli to normalizacja per odbiorcę (HTTP: suma/N; WS: Rate/cli≈Rate, Bytes/cli≈Rate×Payload).\n\n${wsTbl}${httpTbl}`;
}

function renderConclusions(items: Array<any>): string {
  if (!items || items.length === 0) return '';
  const bullets = items
    .map(s => {
      const clients =
        s.mode === 'ws' ? Number(s.clientsWs ?? 0) : Number(s.clientsHttp ?? 0);
      const active = Number(s.avgRate) > 0 || Number(s.avgBytesRate) > 0;
      const na = !active || clients === 0 ? ' [N/A w porównaniach]' : '';
      const rep =
        s.repIndex && s.repTotal ? ` [rep ${s.repIndex}/${s.repTotal}]` : '';
      const trim =
        s.warmupSec || 0 || s.cooldownSec || 0
          ? `(trim: warmup=${s.warmupSec || 0}s, cooldown=${s.cooldownSec || 0}s)`
          : '';
      const checks = s.checks?.join('; ') || '';
      return `- ${s.label}${rep}: ${checks} ${trim}${na}`.trim();
    })
    .join('\n');
  return `\n\n## Wnioski (syntetyczne)\n\n${bullets}\n`;
}

function renderWinners(
  items: Array<any>,
  byLoad: Array<any>,
  byClients: Array<any>,
): string {
  // Zwycięzcy w kategoriach: Rate (wyższy lepszy), Jitter (niższy), Staleness (niższy), CPU (niższy), RSS (niższy)
  if (!items || items.length === 0) return '';
  const categories = [
    {
      key: 'avgRate',
      label: 'Częstość [#/s] (per klient)',
      better: 'high' as const,
    },
    { key: 'avgJitterMs', label: 'Jitter [ms]', better: 'low' as const },
    { key: 'avgFreshnessMs', label: 'Staleness [ms]', better: 'low' as const },
    { key: 'avgCpu', label: 'CPU [%]', better: 'low' as const },
    { key: 'avgRss', label: 'RSS [MB]', better: 'low' as const },
  ];
  // Grupuj po trybie (ws vs polling) i dodatkowo spróbuj znaleźć zwycięzców per Hz
  const parseHz = (label: string): number => {
    const m = label?.match(/@(\d+(?:\.\d+)?)Hz/);
    return m ? Number(m[1]) : Number.NaN;
  };
  type BucketKey = string;
  const buckets = new Map<BucketKey, any[]>();
  for (const s of items) {
    const hz = parseHz(s.label);
    const load = Number(s.loadCpuPct ?? 0);
    const clients =
      s.mode === 'ws' ? Number(s.clientsWs ?? 0) : Number(s.clientsHttp ?? 0);
    // Wyklucz scenariusze bez aktywności i z 0 klientami (różna semantyka metod)
    const active = Number(s.avgRate) > 0 || Number(s.avgBytesRate) > 0;
    if (!active || clients === 0) continue;
    const key = `Hz=${Number.isFinite(hz) ? hz : '—'}|Load=${load}|Clients=${clients}`;
    const arr = buckets.get(key) || [];
    arr.push(s);
    buckets.set(key, arr);
  }
  const lines: string[] = [];
  for (const [k, arr] of buckets) {
    if (arr.length < 2) continue; // potrzebne co najmniej WS vs HTTP
    lines.push(`\n### Zwycięzcy — ${k}`);
    for (const cat of categories) {
      const vals = arr
        .map(s => {
          if (cat.key === 'avgRate') {
            const clients =
              s.mode === 'ws'
                ? Number(s.clientsWs ?? 0)
                : Number(s.clientsHttp ?? 0);
            const v =
              clients > 0 && Number.isFinite(Number(s.ratePerClient))
                ? Number(s.ratePerClient)
                : Number(s.avgRate);
            return { s, v };
          }
          return { s, v: Number((s as any)[cat.key]) };
        })
        .filter(x => Number.isFinite(x.v));
      if (!vals.length) continue;
      vals.sort((a, b) => (cat.better === 'high' ? b.v - a.v : a.v - b.v));
      const best = vals[0];
      // jeśli remis, nie wyróżniaj ciężko — wypisz top2
      const eq = vals.filter(x => Math.abs(x.v - best.v) < 1e-6);
      const label = (s: any) => `${s.mode.toUpperCase()} (${s.label})`;
      if (eq.length > 1) {
        lines.push(
          `- ${cat.label}: remis → ${eq.map(x => label(x.s)).join(' vs ')} (≈ ${best.v.toFixed(cat.key === 'avgRate' ? 2 : 1)})`,
        );
      } else {
        lines.push(
          `- ${cat.label}: ${label(best.s)} (≈ ${best.v.toFixed(cat.key === 'avgRate' ? 2 : 1)})`,
        );
      }
    }
  }
  if (!lines.length) return '';
  const intro =
    '\n\n## Zwycięzcy (per scenariusz)\n\nDla każdej kombinacji Hz/obciążenia/liczby klientów wskazano najlepszą metodę w kluczowych kategoriach.\n';
  // Dodaj też podsumowanie globalne per metoda
  const eligible = items.filter(s => {
    const clients =
      s.mode === 'ws' ? Number(s.clientsWs ?? 0) : Number(s.clientsHttp ?? 0);
    const active = Number(s.avgRate) > 0 || Number(s.avgBytesRate) > 0;
    return active && clients > 0;
  });
  const wsAll = eligible.filter(s => s.mode === 'ws');
  const httpAll = eligible.filter(s => s.mode === 'polling');
  const avg = (a: number[]) =>
    a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
  const fmt = (n: number, f = 2) => (Number.isFinite(n) ? n.toFixed(f) : '—');
  const wsStats = {
    rate: avg(
      wsAll.map(s => {
        const clients = Number(s.clientsWs ?? 0);
        return clients > 0 && Number.isFinite(Number(s.ratePerClient))
          ? Number(s.ratePerClient)
          : Number(s.avgRate);
      }),
    ),
    jit: avg(wsAll.map(s => Number(s.avgJitterMs))),
    fresh: avg(wsAll.map(s => Number(s.avgFreshnessMs))),
    cpu: avg(wsAll.map(s => Number(s.avgCpu))),
    rss: avg(wsAll.map(s => Number(s.avgRss))),
  };
  const httpStats = {
    rate: avg(
      httpAll.map(s => {
        const clients = Number(s.clientsHttp ?? 0);
        return clients > 0 && Number.isFinite(Number(s.ratePerClient))
          ? Number(s.ratePerClient)
          : Number(s.avgRate);
      }),
    ),
    jit: avg(httpAll.map(s => Number(s.avgJitterMs))),
    fresh: avg(httpAll.map(s => Number(s.avgFreshnessMs))),
    cpu: avg(httpAll.map(s => Number(s.avgCpu))),
    rss: avg(httpAll.map(s => Number(s.avgRss))),
  };
  const global = [
    `\n### Podsumowanie globalne (średnio)`,
    `- Rate/cli: WS ${fmt(wsStats.rate)} /s vs HTTP ${fmt(httpStats.rate)} /s`,
    `- Jitter: WS ${fmt(wsStats.jit, 1)} ms vs HTTP ${fmt(httpStats.jit, 1)} ms (niżej lepiej)`,
    `- Staleness: WS ${fmt(wsStats.fresh, 0)} ms vs HTTP ${fmt(httpStats.fresh, 0)} ms (niżej lepiej)`,
    `- CPU: WS ${fmt(wsStats.cpu, 1)}% vs HTTP ${fmt(httpStats.cpu, 1)}% (niżej lepiej)`,
    `- RSS: WS ${fmt(wsStats.rss, 1)} MB vs HTTP ${fmt(httpStats.rss, 1)} MB (niżej lepiej)`,
  ].join('\n');
  return intro + lines.join('\n') + '\n' + global + '\n';
}

function renderMetrologyGuide(): string {
  return `\n\n### Metrologia — jak czytać i co oznaczają wyniki\n\n- n (used/total): liczba próbek wykorzystanych w średnich po trimowaniu vs. całkowita. Zalecane n(used) ≥ 10.\n- Rate [/s] i CI95 Rate: średnia częstość i 95% przedział ufności (mniejszy CI → stabilniejsze wyniki).\n  - Praktyczne kryterium: CI95/średnia < 30% uznajemy za stabilne dla krótkich przebiegów.\n- CI95/avg: względna szerokość przedziału ufności (niższy lepszy).\n- σ(rate): odchylenie standardowe — informuje o zmienności częstości między próbkami.\n- Median Rate/Bytes: mediana — odporna na wartości odstające.\n- Bytes/s i CI95 Bytes: przepływność i jej niepewność. Dla stałego payloadu oczekujemy Bytes/s ≈ Rate × Payload.\n- Tick [ms]: okres próbkowania monitoringu (\`MONITOR_TICK_MS\`). Domyślnie 1000 ms w aplikacji; w badaniach zwykle 200–250 ms.\n- Wpływ warmup/cooldown: odcięcie początkowych/końcowych odcinków stabilizuje średnie i zwęża CI.\n- Minimalne kryteria wiarygodności (propozycja):\n  - n(used) ≥ 10, CI95/średnia (Rate) < 30%, CI95/średnia (Bytes/s) < 30%.\n  - Relacja Bytes≈Rate×Payload: błąd względny < 30% dla przebiegów kontrolowanych.\n`;
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
  usePerClient = false,
  includeDelta = false,
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
    // Pomiń, jeśli brak pełnej pary albo brak aktywności po jednej ze stron
    const wsActive =
      ws && (Number(ws.avgRate) > 0 || Number(ws.avgBytesRate) > 0);
    const httpActive =
      http && (Number(http.avgRate) > 0 || Number(http.avgBytesRate) > 0);
    if (!ws || !http || !wsActive || !httpActive) continue;
    const rateWs = Number(
      usePerClient ? (ws?.avgRatePerClient ?? NaN) : (ws?.avgRate ?? NaN),
    );
    const rateHttp = Number(
      usePerClient ? (http?.avgRatePerClient ?? NaN) : (http?.avgRate ?? NaN),
    );
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
    const deltaRatePct =
      Number.isFinite(rateWs) && Number.isFinite(rateHttp) && rateHttp !== 0
        ? ((rateWs - rateHttp) / Math.abs(rateHttp)) * 100
        : NaN;
    const deltaCol = includeDelta ? ` | ${fmt(deltaRatePct, 0)}%` : '';
    lines.push(
      `| ${k} | ${bRateWs}${fmt(rateWs)}${bRateWs} | ${bRateHttp}${fmt(
        rateHttp,
      )}${bRateHttp}${deltaCol} | ${bJitWs}${fmt(jitWs, 1)}${bJitWs} | ${bJitHttp}${fmt(
        jitHttp,
        1,
      )}${bJitHttp} | ${bStaleWs}${fmt(staleWs, 0)}${bStaleWs} | ${bStaleHttp}${fmt(
        staleHttp,
        0,
      )}${bStaleHttp} | ${bElpWs}${fmt(elpWs, 1)}${bElpWs} | ${bElpHttp}${fmt(
        elpHttp,
        1,
      )}${bElpHttp} | ${bCpuWs}${fmt(cpuWs, 1)}${bCpuWs} | ${bCpuHttp}${fmt(
        cpuHttp,
        1,
      )}${bCpuHttp} | ${bRssWs}${fmt(rssWs, 1)}${bRssWs} | ${bRssHttp}${fmt(
        rssHttp,
        1,
      )}${bRssHttp} |`,
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
    parts.push(
      '\n\n### Wnioski — porównanie WS vs HTTP wg obciążenia (Rate/cli)',
    );
    parts.push(
      '\n\nLegenda: Pogrubienia oznaczają korzystniejszą wartość w danej kolumnie (niżej/lepiej lub wyżej/lepiej zgodnie z metryką). Rate/cli — metryka znormalizowana per odbiorcę.',
    );
    parts.push(
      '\n\n| Obciążenie [%] | Rate/cli WS [/s] | Rate/cli HTTP [/s] | Δ Rate/cli [%] | Jitter WS [ms] | Jitter HTTP [ms] | Staleness WS [ms] | Staleness HTTP [ms] | ELU p99 WS [ms] | ELU p99 HTTP [ms] | CPU WS [%] | CPU HTTP [%] | RSS WS [MB] | RSS HTTP [MB] |',
    );
    parts.push(
      '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    );
    parts.push(renderWsHttpComparisonRows(byLoad, 'Obciążenie', true, true));
  }
  if (byClients && byClients.length >= 2) {
    parts.push(
      '\n\n### Wnioski — porównanie WS vs HTTP wg liczby klientów (Rate/cli)',
    );
    parts.push(
      '\n\nLegenda: Pogrubienia oznaczają korzystniejszą wartość w danej kolumnie (niżej/lepiej lub wyżej/lepiej zgodnie z metryką). Rate/cli — metryka znormalizowana per odbiorcę.',
    );
    parts.push(
      '\n\n| Klienci | Rate/cli WS [/s] | Rate/cli HTTP [/s] | Δ Rate/cli [%] | Jitter WS [ms] | Jitter HTTP [ms] | Staleness WS [ms] | Staleness HTTP [ms] | ELU p99 WS [ms] | ELU p99 HTTP [ms] | CPU WS [%] | CPU HTTP [%] | RSS WS [MB] | RSS HTTP [MB] |',
    );
    parts.push(
      '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    );
    parts.push(renderWsHttpComparisonRows(byClients, 'Klienci', true, true));
  }
  if (parts.length === 0) return '';
  // Optional tiny chart via Mermaid (only if both methods present and 1-2 groups to keep it small)
  return `\n\n## Wnioski — wizualne porównanie\n${parts.join('\n')}`;
}

function renderPairedComparisons(items: Array<any>): string {
  try {
    if (!items || items.length === 0) return '';
    const parseHz = (label: string): number => {
      const m = label?.match(/@(\d+(?:\.\d+)?)Hz/);
      return m ? Number(m[1]) : Number.NaN;
    };
    type Key = string;
    const buckets = new Map<Key, { ws?: any; http?: any; k: string }>();
    for (const s of items) {
      const hz = parseHz(s.label);
      const load = Number(s.loadCpuPct ?? 0);
      const clients =
        s.mode === 'ws' ? Number(s.clientsWs ?? 0) : Number(s.clientsHttp ?? 0);
      const active = Number(s.avgRate) > 0 || Number(s.avgBytesRate) > 0;
      if (!active || clients <= 0) continue;
      const key = `Hz=${Number.isFinite(hz) ? hz : '—'}|Load=${load}|Clients=${clients}`;
      const g = buckets.get(key) || { k: key };
      if (s.mode === 'ws') g.ws = s;
      else if (s.mode === 'polling') g.http = s;
      buckets.set(key, g);
    }
    const keys = Array.from(buckets.keys()).sort();
    const header = `\n\n## Porównania parowane (WS vs HTTP, per klient, z Δ i istotnością)\n\nLegenda: Δ% = (WS−HTTP)/HTTP·100%; Istotność (95% CI): "sig" gdy przedziały [mean±CI] dla Rate/cli nie nachodzą się (dla HTTP CI skalowane 1/N).\n\n| Scenariusz | Rate/cli WS [/s] | Rate/cli HTTP [/s] | Δ Rate/cli [%] | Istotność (95% CI) | Jitter WS [ms] | Jitter HTTP [ms] | Δ Jitter [%] | Staleness WS [ms] | Staleness HTTP [ms] | Δ Stal. [%] | CPU WS [%] | CPU HTTP [%] | Δ CPU [pp] | RSS WS [MB] | RSS HTTP [MB] | Δ RSS [MB] |`;
    const sep =
      '\n|---|---:|---:|---:|:--:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|';
    const fmt = (n: number, f = 2) => (Number.isFinite(n) ? n.toFixed(f) : '—');
    const rows: string[] = [];
    for (const k of keys) {
      const g = buckets.get(k)!;
      if (!g.ws || !g.http) continue;
      const ws = g.ws as any;
      const http = g.http as any;
      const N = Number(http.clientsHttp ?? ws.clientsWs ?? 0) || 1;
      const rateWs = Number.isFinite(Number(ws.ratePerClient))
        ? Number(ws.ratePerClient)
        : Number(ws.avgRate);
      const rateHttp = Number.isFinite(Number(http.ratePerClient))
        ? Number(http.ratePerClient)
        : Number(http.avgRate) / Math.max(1, N);
      const deltaRate =
        Number.isFinite(rateWs) && Number.isFinite(rateHttp) && rateHttp !== 0
          ? ((rateWs - rateHttp) / Math.abs(rateHttp)) * 100
          : NaN;
      const ciWs = Number(ws.ci95Rate ?? NaN);
      const ciHttp = Number(http.ci95Rate ?? NaN) / Math.max(1, N);
      const sig =
        Number.isFinite(rateWs) &&
        Number.isFinite(rateHttp) &&
        Number.isFinite(ciWs) &&
        Number.isFinite(ciHttp)
          ? rateWs - ciWs > rateHttp + ciHttp ||
            rateHttp - ciHttp > rateWs + ciWs
            ? 'sig'
            : 'ns'
          : '—';
      const jitWs = Number(ws.avgJitterMs);
      const jitHttp = Number(http.avgJitterMs);
      const dJit =
        Number.isFinite(jitWs) && Number.isFinite(jitHttp) && jitHttp !== 0
          ? ((jitWs - jitHttp) / Math.abs(jitHttp)) * 100
          : NaN;
      const stWs = Number(ws.avgFreshnessMs);
      const stHttp = Number(http.avgFreshnessMs);
      const dSt =
        Number.isFinite(stWs) && Number.isFinite(stHttp) && stHttp !== 0
          ? ((stWs - stHttp) / Math.abs(stHttp)) * 100
          : NaN;
      const cpuWs = Number(ws.avgCpu);
      const cpuHttp = Number(http.avgCpu);
      const dCpu =
        Number.isFinite(cpuWs) && Number.isFinite(cpuHttp)
          ? cpuWs - cpuHttp
          : NaN;
      const rssWs = Number(ws.avgRss);
      const rssHttp = Number(http.avgRss);
      const dRss =
        Number.isFinite(rssWs) && Number.isFinite(rssHttp)
          ? rssWs - rssHttp
          : NaN;
      rows.push(
        `| ${k} | ${fmt(rateWs)} | ${fmt(rateHttp)} | ${fmt(deltaRate, 0)}% | ${sig} | ${fmt(jitWs, 1)} | ${fmt(jitHttp, 1)} | ${fmt(dJit, 0)}% | ${fmt(stWs, 0)} | ${fmt(stHttp, 0)} | ${fmt(dSt, 0)}% | ${fmt(cpuWs, 1)} | ${fmt(cpuHttp, 1)} | ${fmt(dCpu, 1)} | ${fmt(rssWs, 1)} | ${fmt(rssHttp, 1)} | ${fmt(dRss, 1)} |`,
      );
    }
    if (!rows.length) return '';
    return `${header}${sep}\n${rows.join('\n')}\n`;
  } catch {
    return '';
  }
}

function renderConclusionsSummary(items: Array<any>): string {
  if (!items || items.length === 0) return '';
  // Tylko scenariusze aktywne i z klientami > 0 (porównywalne między metodami)
  const eligible = items.filter(s => {
    const clients =
      s.mode === 'ws' ? Number(s.clientsWs ?? 0) : Number(s.clientsHttp ?? 0);
    const active = Number(s.avgRate) > 0 || Number(s.avgBytesRate) > 0;
    return active && clients > 0;
  });
  const modes: Record<string, any[]> = { ws: [], polling: [] };
  for (const s of eligible) {
    if (s.mode === 'ws') modes.ws.push(s);
    if (s.mode === 'polling') modes.polling.push(s);
  }
  const avg = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN;
  // Porównuj per klienta: WS Rate/cli ≈ Rate, HTTP Rate/cli = Rate/N
  const wsRate = avg(
    modes.ws.map(s => {
      const n = Number(s.clientsWs ?? 0);
      return n > 0 && Number.isFinite(Number(s.ratePerClient))
        ? Number(s.ratePerClient)
        : Number(s.avgRate);
    }),
  );
  const httpRate = avg(
    modes.polling.map(s => {
      const n = Number(s.clientsHttp ?? 0);
      return n > 0 && Number.isFinite(Number(s.ratePerClient))
        ? Number(s.ratePerClient)
        : Number(s.avgRate) / Math.max(1, n);
    }),
  );
  const wsJit = avg(modes.ws.map(s => Number(s.avgJitterMs)));
  const httpJit = avg(modes.polling.map(s => Number(s.avgJitterMs)));
  const wsFresh = avg(modes.ws.map(s => Number(s.avgFreshnessMs)));
  const httpFresh = avg(modes.polling.map(s => Number(s.avgFreshnessMs)));
  const wsCpu = avg(modes.ws.map(s => Number(s.avgCpu)));
  const httpCpu = avg(modes.polling.map(s => Number(s.avgCpu)));
  const fmt = (n: number, f = 2) => (Number.isFinite(n) ? n.toFixed(f) : '—');
  const bullets = [
    `- Średnio (ten run): Rate/cli — WS ${fmt(wsRate)} /s vs HTTP ${fmt(httpRate)} /s`,
    `- Średnio: Jitter — WS ${fmt(wsJit, 1)} ms vs HTTP ${fmt(httpJit, 1)} ms (niżej = stabilniej)`,
    `- Średnio: Staleness — WS ${fmt(wsFresh, 0)} ms vs HTTP ${fmt(httpFresh, 0)} ms (niżej = świeżej)`,
    `- Średnio: CPU — WS ${fmt(wsCpu, 1)}% vs HTTP ${fmt(httpCpu, 1)}% (niżej = lżej)`,
  ].join('\n');
  return `\n\n### Wnioski — krótkie podsumowanie (WS vs HTTP)\n\n${bullets}\n`;
}

function renderTLDR(items: Array<any>): string {
  try {
    if (!items || items.length === 0) return '';
    const eligible = items.filter(s => {
      const clients =
        s.mode === 'ws' ? Number(s.clientsWs ?? 0) : Number(s.clientsHttp ?? 0);
      const active = Number(s.avgRate) > 0 || Number(s.avgBytesRate) > 0;
      return active && clients > 0;
    });
    if (eligible.length < 2) return '';
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
    const bullets = [
      `- Porównuj per klienta: Rate/cli i Bytes/cli; WS: Bytes/cli ≈ Rate × Payload; egress ≈ Rate × Payload × N.`,
      `- Ten run (średnio): Rate/cli — WS ${fmt(wsRate)} /s vs HTTP ${fmt(httpRate)} /s; Jitter — WS ${f1(wsJit)} ms vs HTTP ${f1(httpJit)} ms; Staleness — WS ${f0(wsFresh)} ms vs HTTP ${f0(httpFresh)} ms; CPU — WS ${f1(wsCpu)}% vs HTTP ${f1(httpCpu)}%.`,
      `- Gdy 95% CI (Metrologia) nakładają się, uznawaj różnice za niejednoznaczne.`,
    ].join('\n');
    return `\n\n### TL;DR — szybkie porównanie WS vs HTTP (per klient)\n\n${bullets}\n`;
  } catch {
    return '';
  }
}

function renderPerClientExample(items: Array<any>): string {
  try {
    if (!items || items.length === 0) return '';
    // Znajdź przykładową parę z tym samym N (preferuj N=10, potem N>1)
    const httpMany = items
      .filter(s => s.mode === 'polling' && Number(s.clientsHttp ?? 0) >= 2)
      .sort((a, b) => (b.clientsHttp ?? 0) - (a.clientsHttp ?? 0));
    const httpPick = httpMany[0] || items.find(s => s.mode === 'polling');
    const N = Number(httpPick?.clientsHttp ?? 0);
    if (!httpPick || !Number.isFinite(N) || N <= 1) return '';
    const wsPick = items
      .filter(s => s.mode === 'ws' && Number(s.clientsWs ?? 0) === N)
      .sort((a, b) => Number(b.avgRate) - Number(a.avgRate))[0];
    const f2 = (x: any) =>
      Number.isFinite(Number(x)) ? Number(x).toFixed(2) : '—';
    const f0 = (x: any) =>
      Number.isFinite(Number(x)) ? Number(x).toFixed(0) : '—';
    const lines: string[] = [];
    lines.push('', `Przykład interpretacji (ostatni run):`);
    // HTTP przykład
    lines.push(
      `- HTTP (c=${N}): Rate ≈ ${f2(httpPick.avgRate)}/s → Rate/cli ≈ ${f2(
        httpPick.ratePerClient,
      )}/s; Bytes/s ≈ ${f0(httpPick.avgBytesRate)} → Bytes/cli ≈ ${f0(
        httpPick.bytesRatePerClient,
      )}`,
    );
    if (wsPick) {
      lines.push(
        `- WS (c=${N}): Rate ≈ ${f2(wsPick.avgRate)}/s → Rate/cli ≈ ${f2(
          wsPick.ratePerClient,
        )}/s; Bytes/s ≈ ${f0(wsPick.avgBytesRate)} → Bytes/cli ≈ ${f0(
          wsPick.bytesRatePerClient,
        )}`,
      );
    }
    return '\n' + lines.join('\n');
  } catch {
    return '';
  }
}
