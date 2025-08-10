/*
 Consolidates all benchmark runs under ./benchmarks/<timestamp>/ into single CSV and JSON:
 - Inputs: for each directory with summary.json, read summaries[] and runConfig
 - Output:
		- benchmarks/_aggregate.csv: flat rows per session with key metrics and metadata
		- benchmarks/_aggregate.json: array of { tsDir, label, mode, metrics..., runConfig }
 - Safe to re-run; will overwrite aggregate files.
*/
import fs from 'fs-extra';
import path from 'node:path';

type SummaryItem = {
  label: string;
  mode: 'ws' | 'polling';
  avgRate: number;
  avgBytesRate: number;
  avgPayload: number;
  avgJitterMs: number;
  avgFreshnessMs: number;
  avgDelayP99: number;
  avgCpu: number;
  avgRss: number;
  ci95Rate?: number;
  ci95Bytes?: number;
  count?: number;
  nUsed?: number;
  nTotal?: number;
  loadCpuPct?: number;
  clientsHttp?: number;
  clientsWs?: number;
};

async function main() {
  // __dirname -> api/src/scripts; go up two levels to api/
  const apiRoot = path.resolve(__dirname, '../..');
  const benchesDir = path.join(apiRoot, 'benchmarks');
  const exists = await fs.pathExists(benchesDir);
  if (!exists) {
    console.log('[aggregate] Brak folderu benchmarks, nic do zrobienia.');
    return;
  }
  const entries = await fs.readdir(benchesDir);
  const dirs: string[] = [];
  for (const n of entries) {
    if (n.startsWith('_')) continue; // skip aggregate/index files
    const p = path.join(benchesDir, n);
    try {
      const st = await fs.stat(p);
      if (!st.isDirectory()) continue;
      if (await fs.pathExists(path.join(p, 'summary.json'))) dirs.push(n);
    } catch {}
  }
  if (!dirs.length) {
    console.log('[aggregate] Brak plików summary.json w benchmarks.');
    return;
  }
  dirs.sort();

  type Row = {
    tsDir: string;
    label: string;
    mode: 'ws' | 'polling';
    avgRate: number;
    avgBytesRate: number;
    avgPayload: number;
    avgJitterMs: number;
    avgFreshnessMs: number;
    avgDelayP99: number;
    avgCpu: number;
    avgRss: number;
    ci95Rate?: number;
    ci95Bytes?: number;
    nUsed?: number;
    nTotal?: number;
    loadCpuPct?: number;
    clientsHttp?: number;
    clientsWs?: number;
    hzLabel?: string; // parsed from label (e.g., @1Hz)
  };

  const rows: Row[] = [];
  for (const d of dirs) {
    const sumPath = path.join(benchesDir, d, 'summary.json');
    try {
      const json = await fs.readJSON(sumPath);
      const items: SummaryItem[] = json.summaries || [];
      for (const s of items) {
        const m = s.label.match(/@(\d+(?:\.\d+)?)Hz/);
        rows.push({
          tsDir: d,
          label: s.label,
          mode: s.mode,
          avgRate: s.avgRate,
          avgBytesRate: s.avgBytesRate,
          avgPayload: s.avgPayload,
          avgJitterMs: s.avgJitterMs,
          avgFreshnessMs: s.avgFreshnessMs,
          avgDelayP99: s.avgDelayP99,
          avgCpu: s.avgCpu,
          avgRss: s.avgRss,
          ci95Rate: s.ci95Rate,
          ci95Bytes: s.ci95Bytes,
          nUsed: (s as any).nUsed,
          nTotal: (s as any).nTotal,
          loadCpuPct: (s as any).loadCpuPct,
          clientsHttp: (s as any).clientsHttp,
          clientsWs: (s as any).clientsWs,
          hzLabel: m ? m[1] : undefined,
        });
      }
    } catch (e) {
      console.warn(
        '[aggregate] Pomiń katalog (błąd odczytu):',
        d,
        (e as Error).message,
      );
    }
  }

  // Write CSV
  const csvHeader = [
    'timestampDir',
    'label',
    'mode',
    'hz',
    'avgRate',
    'avgBytesRate',
    'avgPayload',
    'avgJitterMs',
    'avgFreshnessMs',
    'avgDelayP99',
    'avgCpu',
    'avgRss',
    'ci95Rate',
    'ci95Bytes',
    'nUsed',
    'nTotal',
    'loadCpuPct',
    'clientsHttp',
    'clientsWs',
  ];
  const csvLines = [csvHeader.join(',')];
  // Sort consolidated rows for stable reading order
  rows.sort((a, b) => {
    if (a.mode !== b.mode) return a.mode === 'ws' ? -1 : 1;
    const ha = Number(a.hzLabel ?? NaN);
    const hb = Number(b.hzLabel ?? NaN);
    if (Number.isFinite(ha) && Number.isFinite(hb) && ha !== hb) return ha - hb;
    const la = Number((a as any).loadCpuPct ?? 0);
    const lb = Number((b as any).loadCpuPct ?? 0);
    if (la !== lb) return la - lb;
    const ca = Number((a as any).clientsWs ?? (a as any).clientsHttp ?? 0);
    const cb = Number((b as any).clientsWs ?? (b as any).clientsHttp ?? 0);
    if (ca !== cb) return ca - cb;
    return String(a.label).localeCompare(String(b.label));
  });
  for (const r of rows) {
    csvLines.push(
      [
        r.tsDir,
        '"' + r.label.replace(/"/g, "''") + '"',
        r.mode,
        r.hzLabel ?? '',
        r.avgRate.toFixed(3),
        r.avgBytesRate.toFixed(0),
        r.avgPayload.toFixed(1),
        r.avgJitterMs.toFixed(1),
        r.avgFreshnessMs.toFixed(0),
        r.avgDelayP99.toFixed(1),
        r.avgCpu.toFixed(1),
        r.avgRss.toFixed(1),
        (r.ci95Rate ?? 0).toFixed(2),
        (r.ci95Bytes ?? 0).toFixed(0),
        String(r.nUsed ?? ''),
        String(r.nTotal ?? ''),
        String(r.loadCpuPct ?? ''),
        String(r.clientsHttp ?? ''),
        String(r.clientsWs ?? ''),
      ].join(','),
    );
  }
  const csvPath = path.join(benchesDir, '_aggregate.csv');
  await fs.writeFile(csvPath, csvLines.join('\n'), 'utf8');

  // Write JSON
  const jsonPath = path.join(benchesDir, '_aggregate.json');
  await fs.writeJSON(jsonPath, rows, { spaces: 2 });

  // Also emit a stable-named combined.csv for convenience
  const combinedCsvPath = path.join(benchesDir, 'combined.csv');
  await fs.writeFile(combinedCsvPath, csvLines.join('\n'), 'utf8');

  // Create/update a concise docs summary
  const repoRoot = path.resolve(apiRoot, '..');
  const docsDir = path.join(repoRoot, 'docs');
  await fs.mkdirp(docsDir);
  const mdPath = path.join(docsDir, 'WYNIKI_ZBIORCZE.md');
  const latestTs = rows.length ? rows[rows.length - 1].tsDir : '—';
  const modes = Array.from(new Set(rows.map(r => r.mode))).join(', ');
  const hzLabels = Array.from(
    new Set(rows.map(r => r.hzLabel).filter(Boolean)),
  ).join(', ');
  const md = `# Wyniki zbiorcze (agregacja wszystkich uruchomień)

Ten plik jest generowany automatycznie przez skrypt agregujący.

Artefakty:
- API: benchmarks/_aggregate.csv (pełne; nagłówki + wiersze)
- API: benchmarks/combined.csv (alias do powyższego, stabilna nazwa)
- API: benchmarks/_aggregate.json (te same dane w formacie JSON)

Ostatnio dodany katalog: ${latestTs}
Zakres trybów: ${modes}
Zakres Hz (z etykiet): ${hzLabels || '—'}
Liczba wierszy: ${rows.length}

Jak używać:
- Otwórz CSV w Excel/LibreOffice/R/Python.
- Do filtrowania po Hz użyj kolumny 'hz'; po obciążeniu 'loadCpuPct'; po klientach 'clientsHttp/clientsWs'.

Utworzono: ${new Date().toISOString()}
`;
  await fs.writeFile(mdPath, md, 'utf8');

  console.log(
    '[aggregate] Zapisano:',
    csvPath,
    ',',
    jsonPath,
    ',',
    combinedCsvPath,
    'oraz',
    mdPath,
    `(wierszy: ${rows.length})`,
  );
}

main().catch(err => {
  console.error('[aggregate] Błąd:', err);
  process.exit(1);
});
