import { runMeasurements, RunProgress } from 'App/scripts/measurementRunner';
import { NextFunction, Request, Response } from 'express';
import fs from 'fs-extra';
import path from 'node:path';

// Lekki rejestr statusów w pamięci procesu
interface RunStatus {
  id: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  outDir?: string;
  flags?: any;
  evaluatedCount?: number;
  config?: any; // oryginalne opcje startu
  configLabel?: string; // skrócony opis konfiguracji
  // Live progress
  totalSessions?: number;
  completedSessions?: number;
  currentLabel?: string;
  scenarioIndex?: number;
  scenarioTotal?: number;
  repIndex?: number;
  repTotal?: number;
  aborting?: boolean;
}

const runs = new Map<string, RunStatus>();

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

function summarizeConfig(cfg: any): string {
  if (!cfg || typeof cfg !== 'object') return '';
  const modes = Array.isArray(cfg.modes)
    ? cfg.modes.join('+')
    : cfg.modes || '';
  const hz = Array.isArray(cfg.hzSet) ? cfg.hzSet.join(',') : cfg.hzSet || '';
  const load = Array.isArray(cfg.loadSet)
    ? cfg.loadSet.join(',')
    : cfg.loadSet || '';
  const dur = cfg.durationSec != null ? `${cfg.durationSec}s` : '';
  const reps = cfg.repeats && cfg.repeats > 1 ? `x${cfg.repeats}` : '';
  const cWs = cfg.clientsWsSet?.length
    ? `ws:${cfg.clientsWsSet.join(',')}`
    : cfg.clientsWs != null
      ? `ws:${cfg.clientsWs}`
      : '';
  const cHttp = cfg.clientsHttpSet?.length
    ? `http:${cfg.clientsHttpSet.join(',')}`
    : cfg.clientsHttp != null
      ? `http:${cfg.clientsHttp}`
      : '';
  const pair = cfg.pair ? 'pair' : '';
  const parts = [
    modes && `m=${modes}`,
    hz && `Hz=${hz}`,
    load && `L=${load}`,
    dur,
    reps,
    (cWs || cHttp) && `C[${[cWs, cHttp].filter(Boolean).join('/')}]`,
    pair,
  ].filter(Boolean);
  return parts.join(' ');
}

async function updateResearchAspectDoc(params: {
  outDir: string;
  evaluated?: any[];
  flags?: any;
}) {
  try {
    // Ścieżka do pliku aspektu (repo root/docs/ASPEKT_BADAWCZY.md); proces startuje w katalogu api
    const docPathCandidates = [
      path.resolve(process.cwd(), '..', 'docs', 'ASPEKT_BADAWCZY.md'),
      path.resolve(process.cwd(), 'docs', 'ASPEKT_BADAWCZY.md'),
    ];
    const docPath = (
      await Promise.all(
        docPathCandidates.map(async p => ((await fs.pathExists(p)) ? p : null)),
      )
    ).find(Boolean);
    if (!docPath) return; // brak pliku – pomijamy
    const content = await fs.readFile(docPath, 'utf8');
    const begin = '<!-- AUTO-RESULTS:BEGIN -->';
    const end = '<!-- AUTO-RESULTS:END -->';
    if (!content.includes(begin) || !content.includes(end)) return; // brak markerów
    // Spróbuj odczytać summary.json (bogatsze dane)
    let summary: any = {};
    const summaryPath = path.join(params.outDir, 'summary.json');
    if (await fs.pathExists(summaryPath)) {
      summary = await fs.readJSON(summaryPath);
    }
    const evaluated = params.evaluated || summary.summaries || [];
    const flags = params.flags || summary.flags || {};
    const runConfig = summary.runConfig || {};
    const folder = path.basename(params.outDir);
    const fair = flags.fairPayload ? 'TAK' : 'NIE';
    const srcLim = flags.sourceLimited ? 'TAK' : 'NIE';
    const dur = runConfig.durationSec ?? '—';
    const tick = runConfig.monitorTickMs ?? '—';
    const repeats = runConfig.repeats ?? runConfig.repTotal ?? '1';
    // Zbuduj krótką tabelę (max 6 wierszy) z kluczowymi metrykami per rep / scenariusz
    const head =
      '| Label | Mode | Rate/cli [/s] | Bytes/cli [B/s] | Jitter [ms] | Staleness [ms] | CPU [%] | RSS [MB] |';
    const sep = '|---|---:|---:|---:|---:|---:|---:|---:|';
    const rows = (evaluated as Array<Record<string, any>>)
      .slice(0, 6)
      .map((s: Record<string, any>) => {
        const rateCli = (s as any).ratePerClient ?? s.avgRate;
        const bytesCli = (s as any).bytesRatePerClient ?? s.avgBytesRate;
        const f = (n: any, d = 2) =>
          Number.isFinite(Number(n)) ? Number(n).toFixed(d) : '—';
        return `| ${s.label} | ${s.mode} | ${f(rateCli, 2)} | ${f(bytesCli, 0)} | ${f(s.avgJitterMs, 1)} | ${f(s.avgFreshnessMs, 0)} | ${f(s.avgCpu, 1)} | ${f(s.avgRss, 1)} |`;
      });
    const table = [head, sep, ...rows].join('\n');
    const block = `Ostatni run: ${folder}\n\nStatus: fair payload: ${fair}, source-limited: ${srcLim}, czas: ${dur}s, tick: ${tick} ms, repeats: ${repeats}\n\nPliki: [sessions.csv](../api/benchmarks/${folder}/sessions.csv), [summary.json](../api/benchmarks/${folder}/summary.json), [README](../api/benchmarks/${folder}/README.md)\n\nPodgląd (pierwsze scenariusze):\n\n${table}`;
    const newContent = content.replace(
      new RegExp(`${begin}[\s\S]*?${end}`),
      `${begin}\n${block}\n\n${end}`,
    );
    if (newContent !== content) {
      await fs.writeFile(docPath, newContent, 'utf8');
      console.log(
        '[research-runs] Zaktualizowano ASPEKT_BADAWCZY.md (AUTO-RESULTS)',
      );
    }
  } catch (e) {
    console.warn('[research-runs] updateResearchAspectDoc error', e);
  }
}

class ResearchRunsController {
  /** POST /api/research/run
   * Body (opcjonalnie): { modes, hzSet, loadSet, durationSec, clientsHttp, clientsWs, repeats, payload, payloadWs, payloadHttp, warmupSec, cooldownSec }
   * Zwraca 202 + { runId } i uruchamia asynchronicznie runMeasurements.
   */
  async start(req: Request, res: Response, _next: NextFunction) {
    const id = genId();
    const status: RunStatus = { id, startedAt: new Date().toISOString() };
    runs.set(id, status);
    let aborted = false;
    const abort = () => {
      aborted = true;
      const st = runs.get(id);
      if (st) st.aborting = true;
    };
    (status as any).abort = abort; // internal handle (not serialized)
    (async () => {
      try {
        const opts = req.body || {};
        // zachowaj konfigurację + skrót
        status.config = opts;
        status.configLabel = summarizeConfig(opts);
        const { outDir, evaluated, flags } = await runMeasurements(opts, {
          onProgress: (p: RunProgress) => {
            const st = runs.get(id);
            if (!st) return;
            st.totalSessions = p.totalSessions;
            st.completedSessions = p.completedSessions;
            st.currentLabel = p.currentLabel;
            st.scenarioIndex = p.scenarioIndex;
            st.scenarioTotal = p.scenarioTotal;
            st.repIndex = p.repIndex;
            st.repTotal = p.repTotal;
            st.aborting = p.aborting;
          },
          shouldAbort: () => aborted,
        });
        status.outDir = outDir;
        status.evaluatedCount = evaluated?.length;
        status.flags = flags;
        status.finishedAt = new Date().toISOString();
        // Aktualizacja dokumentu aspektu badawczego
        updateResearchAspectDoc({ outDir, evaluated, flags }).catch(() => {});
      } catch (e: any) {
        status.error = e?.message || String(e);
        status.finishedAt = new Date().toISOString();
      }
    })();
    return res.status(202).json({ success: true, data: { runId: id } });
  }

  /** GET /api/research/run/:id — status */
  async status(req: Request, res: Response) {
    const st = runs.get(req.params.id);
    if (!st)
      return res.status(404).json({ success: false, error: 'not found' });
    return res.status(200).json({ success: true, data: st });
  }

  /** DELETE /api/research/run/:id — abort in-progress */
  async abort(req: Request, res: Response) {
    const st: any = runs.get(req.params.id);
    if (!st)
      return res.status(404).json({ success: false, error: 'not found' });
    if (st.finishedAt)
      return res
        .status(400)
        .json({ success: false, error: 'already finished' });
    if (typeof st.abort === 'function') st.abort();
    return res.status(202).json({ success: true });
  }

  /** GET /api/research/runs — lista ostatnich runów */
  async list(_req: Request, res: Response) {
    // 1. In‑memory (bieżąca sesja procesu)
    const mem = Array.from(runs.values());
    // 2. Dysk: katalogi benchmarks/* (persistencja po restarcie)
    //    Każdy folder ma nazwę będącą zmodyfikowanym ISO czasu startu.
    const benchRoot = path.resolve(process.cwd(), 'benchmarks');
    let fileRuns: RunStatus[] = [];
    try {
      if (await fs.pathExists(benchRoot)) {
        const entries = await fs.readdir(benchRoot);
        for (const dir of entries) {
          const full = path.join(benchRoot, dir);
          const stat = await fs.stat(full).catch(() => null);
          if (!stat || !stat.isDirectory()) continue;
          // Pomijaj jeśli odpowiada aktualnie śledzonemu runowi (po outDir)
          const already = mem.find(
            m => m.outDir && path.resolve(m.outDir) === full,
          );
          if (already) continue;
          // Spróbuj odczytać summary.json aby potwierdzić że to run pomiarowy
          const summaryPath = path.join(full, 'summary.json');
          if (!(await fs.pathExists(summaryPath))) continue;
          let startedAt: string | undefined;
          // Przywróć ISO z nazwy katalogu: YYYY-MM-DDTHH-MM-SS-mmmZ -> YYYY-MM-DDTHH:MM:SS.mmmZ
          const isoMatch = dir.match(
            /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
          );
          if (isoMatch) {
            const [, d, hh, mm, ss, ms] = isoMatch;
            startedAt = `${d}T${hh}:${mm}:${ss}.${ms}Z`;
          }
          if (!startedAt) {
            // fallback: mtime katalogu
            startedAt = stat.mtime.toISOString();
          }
          // wczytaj runConfig dla etykiety
          let configLabel: string | undefined;
          let config: any;
          try {
            const summary = await fs.readJSON(summaryPath);
            const rc =
              summary?.runConfig ||
              (Array.isArray(summary?.runConfigs)
                ? summary.runConfigs.at(-1)
                : undefined);
            if (rc) {
              config = rc;
              configLabel = summarizeConfig(rc);
            }
          } catch {}
          fileRuns.push({
            id: dir, // użyj nazwy folderu jako ID runu archiwalnego
            startedAt,
            finishedAt: stat.mtime.toISOString(),
            outDir: full,
            config,
            configLabel,
          });
        }
      }
    } catch (e) {
      // Nie blokuj odpowiedzi w razie błędów dyskowych
      console.warn('[research-runs] scan benchmarks error', e);
    }
    const combined = [...mem, ...fileRuns].sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
    return res
      .status(200)
      .json({ success: true, data: combined.slice(0, 200) });
  }

  /** GET /api/research/run/:id/results — summary.json */
  async results(req: Request, res: Response) {
    let st = runs.get(req.params.id);
    // Fallback: archiwalny run z dysku (po restarcie procesu) – id = nazwa katalogu benchmarks/<id>
    if (!st) {
      const benchDir = path.resolve(process.cwd(), 'benchmarks', req.params.id);
      const summaryPath = path.join(benchDir, 'summary.json');
      if (await fs.pathExists(summaryPath)) {
        const stat = await fs.stat(benchDir).catch(() => null);
        let config: any;
        let configLabel: string | undefined;
        try {
          const summary = await fs.readJSON(summaryPath);
          const rc =
            summary?.runConfig ||
            (Array.isArray(summary?.runConfigs)
              ? summary.runConfigs.at(-1)
              : undefined);
          if (rc) {
            config = rc;
            configLabel = summarizeConfig(rc);
          }
        } catch {}
        st = {
          id: req.params.id,
          startedAt: stat ? stat.mtime.toISOString() : new Date().toISOString(),
          finishedAt: stat
            ? stat.mtime.toISOString()
            : new Date().toISOString(),
          outDir: benchDir,
          config,
          configLabel,
        };
      }
    }
    if (!st)
      return res.status(404).json({ success: false, error: 'not found' });
    if (!st.finishedAt)
      return res
        .status(409)
        .json({ success: false, error: 'run not finished yet' });
    if (!st.outDir)
      return res.status(404).json({ success: false, error: 'no outDir' });
    try {
      const summaryPath = path.join(st.outDir, 'summary.json');
      if (!(await fs.pathExists(summaryPath))) {
        return res
          .status(404)
          .json({ success: false, error: 'summary.json not found' });
      }
      const data = await fs.readJSON(summaryPath);
      return res.status(200).json({ success: true, data });
    } catch (e: any) {
      return res
        .status(500)
        .json({ success: false, error: e?.message || String(e) });
    }
  }

  /** GET /api/research/run/:id/sessions — surowe próbki (timeline) z sessions.csv (przycięte o warmup/cooldown) */
  async sessions(req: Request, res: Response) {
    // Ustal katalog runu (jak w results())
    let st = runs.get(req.params.id);
    if (!st) {
      const benchDir = path.resolve(process.cwd(), 'benchmarks', req.params.id);
      const summaryPath = path.join(benchDir, 'summary.json');
      if (await fs.pathExists(summaryPath)) {
        const stat = await fs.stat(benchDir).catch(() => null);
        st = {
          id: req.params.id,
          startedAt: stat ? stat.mtime.toISOString() : new Date().toISOString(),
          finishedAt: stat
            ? stat.mtime.toISOString()
            : new Date().toISOString(),
          outDir: benchDir,
        };
      }
    }
    if (!st || !st.outDir)
      return res.status(404).json({ success: false, error: 'not found' });
    const csvPath = path.join(st.outDir, 'sessions.csv');
    if (!(await fs.pathExists(csvPath))) {
      return res
        .status(404)
        .json({ success: false, error: 'sessions.csv not found' });
    }
    // Wczytaj summary.json (parametry warmup/cooldown i rep info); w razie braku użyj domyślnych 0
    let summaries: any[] = [];
    let runConfigs: any[] = [];
    try {
      const summary = await fs.readJSON(path.join(st.outDir, 'summary.json'));
      summaries = Array.isArray(summary?.summaries) ? summary.summaries : [];
      if (Array.isArray(summary?.runConfigs)) runConfigs = summary.runConfigs;
    } catch {}
    // Mapa label-> {warmupSec,cooldownSec} (używamy wartości z pierwszego pasującego podsumowania)
    const trimCfg = new Map<
      string,
      { warmupSec: number; cooldownSec: number }
    >();
    for (const s of summaries) {
      const warmupSec = Number((s as any).warmupSec || 0);
      const cooldownSec = Number((s as any).cooldownSec || 0);
      if (!trimCfg.has(s.label))
        trimCfg.set(s.label, { warmupSec, cooldownSec });
    }
    // Szybki parser CSV bez dodatkowych zależności
    const raw = await fs.readFile(csvPath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(l => l.trim().length);
    const header = lines.shift();
    if (!header)
      return res.status(500).json({ success: false, error: 'empty csv' });
    const cols = header.split(',');
    const idx = (name: string) => cols.indexOf(name);
    const col = {
      sessionId: idx('sessionId'),
      label: idx('label'),
      mode: idx('mode'),
      startedAt: idx('startedAt'),
      finishedAt: idx('finishedAt'),
      sampleIndex: idx('sampleIndex'),
      ts: idx('ts'),
      cpu: idx('cpu'),
      rssMB: idx('rssMB'),
      httpReqRate: idx('httpReqRate'),
      wsMsgRate: idx('wsMsgRate'),
      httpBytesRate: idx('httpBytesRate'),
      wsBytesRate: idx('wsBytesRate'),
      httpJitterMs: idx('httpJitterMs'),
      wsJitterMs: idx('wsJitterMs'),
      dataFreshnessMs: idx('dataFreshnessMs'),
      tickMs: idx('tickMs'),
    };
    const sessionsMap = new Map<
      string,
      {
        label: string;
        mode: string;
        startedAt?: string;
        finishedAt?: string;
        samples: any[];
      }
    >();
    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length < cols.length) continue;
      const sid = parts[col.sessionId];
      if (!sessionsMap.has(sid)) {
        sessionsMap.set(sid, {
          label: JSON.parse(parts[col.label] || '""'),
          mode: parts[col.mode],
          startedAt: parts[col.startedAt],
          finishedAt: parts[col.finishedAt] || undefined,
          samples: [],
        });
      }
      const sess = sessionsMap.get(sid)!;
      sess.samples.push({
        ts: parts[col.ts],
        cpu: Number(parts[col.cpu]),
        rssMB: Number(parts[col.rssMB]),
        rate:
          sess.mode === 'polling'
            ? Number(parts[col.httpReqRate])
            : Number(parts[col.wsMsgRate]),
        bytesRate:
          sess.mode === 'polling'
            ? Number(parts[col.httpBytesRate])
            : Number(parts[col.wsBytesRate]),
        jitterMs:
          sess.mode === 'polling'
            ? Number(parts[col.httpJitterMs])
            : Number(parts[col.wsJitterMs]),
        freshnessMs: Number(parts[col.dataFreshnessMs]),
        tickMs: Number(parts[col.tickMs]),
      });
    }
    // Przytnij warmup/cooldown + wylicz t=0 (po warmup)
    const result: any[] = [];
    for (const sess of sessionsMap.values()) {
      const trim = trimCfg.get(sess.label) || { warmupSec: 0, cooldownSec: 0 };
      const start = Date.parse(sess.startedAt || sess.samples[0]?.ts || '');
      const end = Date.parse(sess.finishedAt || sess.samples.at(-1)?.ts || '');
      const trimStart = start + trim.warmupSec * 1000;
      const trimEnd = end - trim.cooldownSec * 1000;
      const trimmed = sess.samples.filter(s => {
        const t = Date.parse(s.ts);
        return Number.isFinite(t) && t >= trimStart && t <= trimEnd;
      });
      const samples = trimmed.map(s => {
        const tMs = Date.parse(s.ts) - trimStart;
        return { tSec: Number((tMs / 1000).toFixed(3)), ...s };
      });
      // Parsowanie parametrów scenariusza z labelu
      const lbl = sess.label as string;
      const hz = (() => {
        const m = lbl.match(/@([0-9]+(?:\.[0-9]+)?)Hz/);
        return m ? Number(m[1]) : undefined;
      })();
      const payload = (() => {
        const m = lbl.match(/payload=(\d+)B/);
        return m ? Number(m[1]) : undefined;
      })();
      const loadPct = (() => {
        const m = lbl.match(/\+ load=(\d+)%/);
        return m ? Number(m[1]) : 0;
      })();
      const clients = (() => {
        const m = lbl.match(/cWs=(\d+)/) || lbl.match(/cHttp=(\d+)/);
        return m ? Number(m[1]) : undefined;
      })();
      result.push({
        label: sess.label,
        mode: sess.mode,
        warmupSec: trim.warmupSec,
        cooldownSec: trim.cooldownSec,
        hz,
        loadPct,
        clients,
        payloadBytes: payload,
        samples,
      });
    }
    // Opcjonalne filtrowanie po mode (?mode=ws) – inne filtry można dodać później
    const modeQ = req.query.mode as string | undefined;
    const filtered = modeQ ? result.filter(r => r.mode === modeQ) : result;
    return res
      .status(200)
      .json({ success: true, data: { sessions: filtered } });
  }
}

export default new ResearchRunsController();
