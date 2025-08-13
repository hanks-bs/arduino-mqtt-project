/*
 Export latest benchmark folder (api/benchmarks/<timestamp>) to a single Excel file
 with sheets: Sessions, Summary, ByLoad, ByClients, Meta. Aids in sharing one file.
*/
import ExcelJS from 'exceljs';
import fs from 'fs-extra';
import path from 'node:path';

async function findLatestBenchmarkDir(repoRoot: string) {
  const benchesDir = path.join(repoRoot, 'api', 'benchmarks');
  const exists = await fs.pathExists(benchesDir);
  if (!exists) throw new Error(`Brak folderu benchmarków: ${benchesDir}`);
  const entries = await fs.readdir(benchesDir);
  const dirs: string[] = [];
  for (const n of entries) {
    if (n.startsWith('.') || n.startsWith('_')) continue;
    const p = path.join(benchesDir, n);
    try {
      const st = await fs.stat(p);
      if (!st.isDirectory()) continue;
      const hasSummary = await fs.pathExists(path.join(p, 'summary.json'));
      if (!hasSummary) continue;
      dirs.push(n);
    } catch {}
  }
  if (dirs.length === 0)
    throw new Error('Brak katalogów wyników w api/benchmarks');
  const latest = dirs.sort((a, b) => (a > b ? -1 : 1))[0];
  return { benchesDir, latest, latestDir: path.join(benchesDir, latest) };
}

async function csvToRows(csvPath: string): Promise<string[][]> {
  const txt = await fs.readFile(csvPath, 'utf8');
  const lines = txt.split(/\r?\n/).filter(Boolean);
  return lines.map(l => l.split(','));
}

async function main() {
  const repoRoot = path.resolve(__dirname, '../../..');
  const { latest, latestDir } = await findLatestBenchmarkDir(repoRoot);
  const summaryPath = path.join(latestDir, 'summary.json');
  const sessionsCsv = path.join(latestDir, 'sessions.csv');
  const byLoadCsv = path.join(latestDir, 'by_load.csv');
  const byClientsCsv = path.join(latestDir, 'by_clients.csv');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Benchmark Exporter';
  workbook.created = new Date();

  // Meta sheet
  const summary = await fs.readJSON(summaryPath);
  {
    const ws = workbook.addWorksheet('Meta');
    ws.columns = [
      { header: 'Key', key: 'k', width: 28 },
      { header: 'Value', key: 'v', width: 60 },
    ];
    ws.addRow({ k: 'Folder', v: latest });
    ws.addRow({ k: 'modes', v: (summary.runConfig?.modes || []).join(', ') });
    ws.addRow({ k: 'hzSet', v: (summary.runConfig?.hzSet || []).join(', ') });
    ws.addRow({
      k: 'loadSet',
      v: (summary.runConfig?.loadSet || []).join(', '),
    });
    ws.addRow({
      k: 'durationSec',
      v: String(summary.runConfig?.durationSec ?? ''),
    });
    ws.addRow({
      k: 'tickMs',
      v: String(summary.runConfig?.monitorTickMs ?? ''),
    });
    ws.addRow({
      k: 'clientsHttp',
      v: String(summary.runConfig?.clientsHttp ?? ''),
    });
    ws.addRow({
      k: 'clientsWs',
      v: String(summary.runConfig?.clientsWs ?? ''),
    });
  ws.addRow({ k: 'wsPayload', v: String(summary.runConfig?.wsPayload ?? '') });
  ws.addRow({ k: 'httpPayload', v: String(summary.runConfig?.httpPayload ?? '') });
  ws.addRow({ k: 'repeats', v: String(summary.runConfig?.repeats ?? '') });
  const flags = summary.flags || {};
  ws.addRow({ k: 'fairPayload', v: String(flags.fairPayload ?? '') });
  ws.addRow({ k: 'sourceLimited', v: String(flags.sourceLimited ?? '') });
  }

  // Summary sheet
  {
    const ws = workbook.addWorksheet('Summary');
    const items: any[] = summary.summaries || [];
    ws.columns = [
      { header: 'Label', key: 'label', width: 40 },
      { header: 'Mode', key: 'mode', width: 10 },
      { header: 'Rate [/s]', key: 'rate', width: 12 },
      { header: 'Rate/cli [/s]', key: 'rateCli', width: 12 },
      { header: 'Bytes/s', key: 'bytes', width: 12 },
      { header: 'Bytes/cli [B/s]', key: 'bytesCli', width: 14 },
      { header: 'Bytes/cli (server) [B/s]', key: 'bytesCliSrv', width: 18 },
      { header: 'Egress est. [B/s]', key: 'egress', width: 16 },
      { header: '~Payload [B]', key: 'payload', width: 14 },
      { header: 'Jitter [ms]', key: 'jitter', width: 12 },
      { header: 'CI95 Jitter [ms]', key: 'ciJit', width: 16 },
      { header: 'Staleness [ms]', key: 'fresh', width: 16 },
      { header: 'CI95 Staleness [ms]', key: 'ciFresh', width: 20 },
      { header: 'ELU p99 [ms]', key: 'elp', width: 14 },
      { header: 'CPU [%]', key: 'cpu', width: 10 },
      { header: 'RSS [MB]', key: 'rss', width: 10 },
      { header: 'n used/total', key: 'n', width: 12 },
      { header: 'Rate OK', key: 'rateok', width: 10 },
      { header: 'Payload OK', key: 'pk', width: 12 },
      { header: 'Src→Ingest avg [ms]', key: 'l1a', width: 16 },
      { header: 'Src→Ingest p95 [ms]', key: 'l1p', width: 16 },
      { header: 'Ingest→Emit avg [ms]', key: 'l2a', width: 16 },
      { header: 'Ingest→Emit p95 [ms]', key: 'l2p', width: 16 },
      { header: 'Src→Emit avg [ms]', key: 'l3a', width: 16 },
      { header: 'Src→Emit p95 [ms]', key: 'l3p', width: 16 },
    ];
    for (const s of items) {
      const stale = Number.isFinite(Number(s.avgStalenessMs)) ? Number(s.avgStalenessMs) : Number(s.avgFreshnessMs);
      ws.addRow({
        label: s.label,
        mode: s.mode,
        rate: Number(s.avgRate?.toFixed?.(2) ?? s.avgRate ?? ''),
        rateCli: Number.isFinite(Number(s.ratePerClient)) ? Number(Number(s.ratePerClient).toFixed(2)) : '',
        bytes: Number(s.avgBytesRate?.toFixed?.(0) ?? s.avgBytesRate ?? ''),
        bytesCli: Number.isFinite(Number(s.bytesRatePerClient)) ? Number(Number(s.bytesRatePerClient).toFixed(0)) : '',
        bytesCliSrv: Number.isFinite(Number(s.bytesRatePerClientServer)) ? Number(Number(s.bytesRatePerClientServer).toFixed(0)) : '',
        egress: Number.isFinite(Number(s.egressBytesRateEst)) ? Number(Number(s.egressBytesRateEst).toFixed(0)) : '',
        payload: Number(s.avgPayload?.toFixed?.(0) ?? s.avgPayload ?? ''),
        jitter: Number(s.avgJitterMs?.toFixed?.(1) ?? s.avgJitterMs ?? ''),
        ciJit: Number.isFinite(Number(s.ci95Jitter)) ? Number(Number(s.ci95Jitter).toFixed(1)) : '',
        fresh: Number.isFinite(stale) ? Number(stale.toFixed(0)) : '',
        ciFresh: Number.isFinite(Number(s.ci95Staleness)) ? Number(Number(s.ci95Staleness).toFixed(0)) : '',
        elp: Number(s.avgDelayP99?.toFixed?.(1) ?? s.avgDelayP99 ?? ''),
        cpu: Number(s.avgCpu?.toFixed?.(1) ?? s.avgCpu ?? ''),
        rss: Number(s.avgRss?.toFixed?.(1) ?? s.avgRss ?? ''),
        n: `${s.nUsed ?? s.count}/${s.nTotal ?? s.count}`,
        rateok: s.rateOk === undefined ? '' : s.rateOk ? 'OK' : 'NOK',
        pk: s.payloadOk === undefined ? '' : s.payloadOk ? 'OK' : 'NOK',
        l1a: Number.isFinite(Number(s.avgSrcToIngestMs)) ? Number(Number(s.avgSrcToIngestMs).toFixed(1)) : '',
        l1p: Number.isFinite(Number(s.p95SrcToIngestMs)) ? Number(Number(s.p95SrcToIngestMs).toFixed(1)) : '',
        l2a: Number.isFinite(Number(s.avgIngestToEmitMs)) ? Number(Number(s.avgIngestToEmitMs).toFixed(1)) : '',
        l2p: Number.isFinite(Number(s.p95IngestToEmitMs)) ? Number(Number(s.p95IngestToEmitMs).toFixed(1)) : '',
        l3a: Number.isFinite(Number(s.avgSrcToEmitMs)) ? Number(Number(s.avgSrcToEmitMs).toFixed(1)) : '',
        l3p: Number.isFinite(Number(s.p95SrcToEmitMs)) ? Number(Number(s.p95SrcToEmitMs).toFixed(1)) : '',
      });
    }
  }

  // ByLoad sheet
  if (await fs.pathExists(byLoadCsv)) {
    const ws = workbook.addWorksheet('ByLoad');
    const rows = await csvToRows(byLoadCsv);
    rows.forEach((r, i) =>
      ws.addRow(
        i === 0 ? r : r.map(v => (isFinite(Number(v)) ? Number(v) : v)),
      ),
    );
  }
  // ByClients sheet
  if (await fs.pathExists(byClientsCsv)) {
    const ws = workbook.addWorksheet('ByClients');
    const rows = await csvToRows(byClientsCsv);
    rows.forEach((r, i) =>
      ws.addRow(
        i === 0 ? r : r.map(v => (isFinite(Number(v)) ? Number(v) : v)),
      ),
    );
  }
  // Sessions sheet (warning: can be large)
  if (await fs.pathExists(sessionsCsv)) {
    const ws = workbook.addWorksheet('Sessions');
    const rows = await csvToRows(sessionsCsv);
    // Limit to, e.g., first 30k rows to avoid huge files
    const MAX = 30000;
    const subset = rows.slice(0, MAX);
    subset.forEach((r, i) =>
      ws.addRow(
        i === 0 ? r : r.map(v => (isFinite(Number(v)) ? Number(v) : v)),
      ),
    );
    if (rows.length > MAX) {
      const notes =
        workbook.getWorksheet('Meta') || workbook.addWorksheet('Meta');
      notes.addRow({
        k: 'Sessions truncated',
        v: `${MAX}/${rows.length} rows saved to XLSX`,
      });
    }
  }

  const outPath = path.join(latestDir, 'report.xlsx');
  await workbook.xlsx.writeFile(outPath);
  console.log('Zapisano plik', outPath);
}

main().catch(err => {
  console.error('Błąd eksportu XLSX:', err.message);
  process.exit(1);
});
