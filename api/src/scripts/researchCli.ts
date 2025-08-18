/*
 Lightweight CLI that wraps runMeasurements with named presets to keep package.json clean.
 Usage: ts-node -r tsconfig-paths/register ./src/scripts/researchCli.ts <preset>
 Presets: list, sanity, stable, stable60, quick, safe, robust, clients, viz, freq, highhz, baseline, compare-load, stress, latency, all
*/
import { runMeasurements } from './measurementRunner';

type Preset =
  | 'list'
  | 'sanity'
  | 'stable'
  | 'stable60'
  | 'quick'
  | 'safe'
  | 'robust'
  | 'clients'
  | 'viz'
  | 'freq'
  | 'highhz'
  | 'baseline'
  | 'compare-load'
  | 'stress'
  | 'latency'
  | 'all';

function printHelp() {
  const presets: Array<[Preset, string]> = [
    [
      'sanity',
      '12s, 1 Hz, clients=1/1, pair, pidusage disabled (szybki sanity check)',
    ],
    [
      'stable',
      '20s×2, 1 Hz, clients=1/1, cpuSampleMs=1000 (stabilny baseline)',
    ],
    ['stable60', '60s×2, 1 Hz, clients=1/1, cpuSampleMs=1000 (ciasne CI)'],
    ['quick', '4s, 1–2 Hz, pair, bez obciążenia (ekspresowy podgląd)'],
    [
      'safe',
      '4s, 0.5–1 Hz, clients=1/1, pair, tick=500ms (bezpieczny minimalny)',
    ],
    ['robust', '60s×2, Hz=0.5,1,2; Load=0,25,50; pair'],
    ['clients', '60s×2, 1 Hz, Load=0,25; clients sets (1,10,25,50); pair'],
    [
      'viz',
      '30s×2, 1 Hz, Load=0,50; clients=1,10,25,50; pair; cpuSampleMs=1000 (do czytelnych porównań per‑client)',
    ],
    [
      'freq',
      '30s×2, Hz=0.5,1,2,4; Load=0; clients=1,10; pair (mapowanie wpływu częstotliwości)',
    ],
    [
      'highhz',
      '45s×2, Hz=2,4,8; Load=0,25; clients=1,10; pair (wyższe częstotliwości i umiarkowane obciążenie)',
    ],
    [
      'baseline',
      '40s×2, 1 Hz, Load=0; clients=1; cpuSampleMs=500 (ciasny baseline CPU/RSS)',
    ],
    [
      'compare-load',
      '40s×2, 1 Hz, Load=0,25,50,75; clients=10; pair (krzywa degradacji z obciążeniem)',
    ],
    [
      'stress',
      '50s×1, Hz=2,4,8; Load=0,25,50,75; clients=25,50; pair (stress matrix — ostrożnie)',
    ],
    [
      'latency',
      '60s×2, 1 Hz, Load=0,50; clients=1,25; pair + wydłużony tick=150ms (lepsza rozdz. ingest/emit)',
    ],
    [
      'all',
      'Sekwencja: baseline → freq → compare-load → highhz → viz → clients (pełne pokrycie hipotez)',
    ],
  ];
  console.log('Research presets:');
  for (const [k, v] of presets) console.log(` - ${k}: ${v}`);
}

async function main() {
  const raw = (process.argv[2] || '').toLowerCase();
  if (!raw || raw === 'list' || raw === '--help' || raw === '-h') {
    printHelp();
    return;
  }
  const preset = raw as Preset;

  switch (preset) {
    case 'sanity':
      await runMeasurements({
        modes: ['ws', 'polling'],
        hzSet: [1],
        loadSet: [0],
        durationSec: 12,
        tickMs: 200,
        warmupSec: 1,
        cooldownSec: 1,
        clientsHttp: 1,
        clientsWs: 1,
        // @ts-expect-error extended flags supported in CLI
        disablePidusage: true,
        pair: true,
      });
      break;
    case 'stable':
      await runMeasurements({
        modes: ['ws', 'polling'],
        hzSet: [1],
        loadSet: [0],
        durationSec: 20,
        tickMs: 200,
        warmupSec: 2,
        cooldownSec: 2,
        clientsHttp: 1,
        clientsWs: 1,
        repeats: 2,
        // @ts-expect-error extended flags supported in CLI
        cpuSampleMs: 1000,
        pair: true,
      });
      break;
    case 'stable60':
      await runMeasurements({
        modes: ['ws', 'polling'],
        hzSet: [1],
        loadSet: [0],
        durationSec: 60,
        tickMs: 200,
        warmupSec: 4,
        cooldownSec: 4,
        clientsHttp: 1,
        clientsWs: 1,
        repeats: 2,
        // @ts-expect-error extended flags supported in CLI
        cpuSampleMs: 1000,
        pair: true,
      });
      break;
    case 'quick':
      await runMeasurements({
        modes: ['ws', 'polling'],
        hzSet: [1, 2],
        loadSet: [0],
        durationSec: 4,
        tickMs: 200,
        warmupSec: 0.5 as any,
        cooldownSec: 0.5 as any,
        pair: true,
      });
      break;
    case 'safe':
      await runMeasurements({
        modes: ['ws', 'polling'],
        hzSet: [0.5, 1],
        loadSet: [0],
        durationSec: 4,
        tickMs: 500,
        clientsHttp: 1,
        clientsWs: 1,
        warmupSec: 0.5 as any,
        cooldownSec: 0.5 as any,
        pair: true,
      });
      break;
    case 'robust':
      await runMeasurements({
        modes: ['ws', 'polling'],
        hzSet: [0.5, 1, 2],
        loadSet: [0, 25, 50],
        durationSec: 60,
        tickMs: 200,
        warmupSec: 4,
        cooldownSec: 4,
        repeats: 2,
        pair: true,
        // @ts-expect-error extended flags supported in CLI
        cpuSampleMs: 1000,
      });
      break;
    case 'viz':
      await runMeasurements({
        modes: ['ws', 'polling'],
        hzSet: [1],
        loadSet: [0, 50],
        durationSec: 30,
        tickMs: 200,
        warmupSec: 2,
        cooldownSec: 2,
        clientsHttpSet: [1, 10, 25, 50],
        clientsWsSet: [1, 10, 25, 50],
        repeats: 2,
        pair: true,
        // @ts-expect-error extended flags supported in CLI
        cpuSampleMs: 1000,
      });
      break;
    case 'freq':
      await runMeasurements({
        modes: ['ws', 'polling'],
        hzSet: [0.5, 1, 2, 4],
        loadSet: [0],
        durationSec: 30,
        tickMs: 200,
        warmupSec: 2,
        cooldownSec: 2,
        clientsHttpSet: [1, 10],
        clientsWsSet: [1, 10],
        repeats: 2,
        pair: true,
        // @ts-expect-error
        cpuSampleMs: 1000,
      });
      break;
    case 'highhz':
      await runMeasurements({
        modes: ['ws', 'polling'],
        hzSet: [2, 4, 8],
        loadSet: [0, 25],
        durationSec: 45,
        tickMs: 200,
        warmupSec: 3,
        cooldownSec: 3,
        clientsHttpSet: [1, 10],
        clientsWsSet: [1, 10],
        repeats: 2,
        pair: true,
        // @ts-expect-error
        cpuSampleMs: 750,
      });
      break;
    case 'baseline':
      await runMeasurements({
        modes: ['ws', 'polling'],
        hzSet: [1],
        loadSet: [0],
        durationSec: 40,
        tickMs: 200,
        warmupSec: 4,
        cooldownSec: 4,
        clientsHttp: 1,
        clientsWs: 1,
        repeats: 2,
        pair: true,
        // @ts-expect-error
        cpuSampleMs: 500,
      });
      break;
    case 'compare-load':
      await runMeasurements({
        modes: ['ws', 'polling'],
        hzSet: [1],
        loadSet: [0, 25, 50, 75],
        durationSec: 40,
        tickMs: 200,
        warmupSec: 4,
        cooldownSec: 4,
        clientsHttp: 10,
        clientsWs: 10,
        repeats: 2,
        pair: true,
        // @ts-expect-error
        cpuSampleMs: 1000,
      });
      break;
    case 'stress':
      await runMeasurements({
        modes: ['ws', 'polling'],
        hzSet: [2, 4, 8],
        loadSet: [0, 25, 50, 75],
        durationSec: 50,
        tickMs: 200,
        warmupSec: 5,
        cooldownSec: 5,
        clientsHttpSet: [25, 50],
        clientsWsSet: [25, 50],
        repeats: 1,
        pair: true,
        // @ts-expect-error
        cpuSampleMs: 1000,
      });
      break;
    case 'latency':
      await runMeasurements({
        modes: ['ws', 'polling'],
        hzSet: [1],
        loadSet: [0, 50],
        durationSec: 60,
        tickMs: 150,
        warmupSec: 5,
        cooldownSec: 5,
        clientsHttpSet: [1, 25],
        clientsWsSet: [1, 25],
        repeats: 2,
        pair: true,
        // @ts-expect-error
        cpuSampleMs: 750,
      });
      break;
    case 'all':
      // Sekwencja wielofazowa; każdy run dopisuje do tego samego katalogu jeśli ustawimy MEASURE_OUTPUT_DIR
      // Używamy katalogu benchmarków z bieżącym timestampem jako docelowego.
      {
        const outDir = `benchmarks/${new Date().toISOString().replace(/[:.]/g, '-')}`;
        const phases: Array<{ name: string; cfg: any }> = [
          {
            name: 'baseline',
            cfg: {
              modes: ['ws', 'polling'],
              hzSet: [1],
              loadSet: [0],
              durationSec: 40,
              tickMs: 200,
              warmupSec: 4,
              cooldownSec: 4,
              clientsHttp: 1,
              clientsWs: 1,
              repeats: 2,
              pair: true,
              cpuSampleMs: 500,
            },
          },
          {
            name: 'freq',
            cfg: {
              modes: ['ws', 'polling'],
              hzSet: [0.5, 1, 2, 4],
              loadSet: [0],
              durationSec: 30,
              tickMs: 200,
              warmupSec: 2,
              cooldownSec: 2,
              clientsHttpSet: [1, 10],
              clientsWsSet: [1, 10],
              repeats: 2,
              pair: true,
              cpuSampleMs: 1000,
            },
          },
          {
            name: 'compare-load',
            cfg: {
              modes: ['ws', 'polling'],
              hzSet: [1],
              loadSet: [0, 25, 50, 75],
              durationSec: 40,
              tickMs: 200,
              warmupSec: 4,
              cooldownSec: 4,
              clientsHttp: 10,
              clientsWs: 10,
              repeats: 2,
              pair: true,
              cpuSampleMs: 1000,
            },
          },
          {
            name: 'highhz',
            cfg: {
              modes: ['ws', 'polling'],
              hzSet: [2, 4, 8],
              loadSet: [0, 25],
              durationSec: 45,
              tickMs: 200,
              warmupSec: 3,
              cooldownSec: 3,
              clientsHttpSet: [1, 10],
              clientsWsSet: [1, 10],
              repeats: 2,
              pair: true,
              cpuSampleMs: 750,
            },
          },
          {
            name: 'viz',
            cfg: {
              modes: ['ws', 'polling'],
              hzSet: [1],
              loadSet: [0, 50],
              durationSec: 30,
              tickMs: 200,
              warmupSec: 2,
              cooldownSec: 2,
              clientsHttpSet: [1, 10, 25, 50],
              clientsWsSet: [1, 10, 25, 50],
              repeats: 2,
              pair: true,
              cpuSampleMs: 1000,
            },
          },
          {
            name: 'clients',
            cfg: {
              modes: ['ws', 'polling'],
              hzSet: [1],
              loadSet: [0, 25],
              durationSec: 60,
              tickMs: 200,
              warmupSec: 4,
              cooldownSec: 4,
              clientsHttpSet: [1, 10, 25, 50],
              clientsWsSet: [1, 10, 25, 50],
              pair: true,
              repeats: 2,
              cpuSampleMs: 1000,
            },
          },
        ];
        // Ustal katalog wyjściowy globalnie
        (process.env as any).MEASURE_OUTPUT_DIR = outDir;
        console.log('[research:all] Output dir:', outDir);
        for (const ph of phases) {
          console.log(`\n[research:all] Phase: ${ph.name}`);
          (process.env as any).MEASURE_PHASE = ph.name;
          await runMeasurements(ph.cfg);
        }
      }
      break;
    case 'clients':
      await runMeasurements({
        modes: ['ws', 'polling'],
        hzSet: [1],
        loadSet: [0, 25],
        durationSec: 60,
        tickMs: 200,
        warmupSec: 4,
        cooldownSec: 4,
        clientsHttpSet: [1, 10, 25, 50],
        clientsWsSet: [1, 10, 25, 50],
        pair: true,
        repeats: 2,
        // @ts-expect-error extended flags supported in CLI
        cpuSampleMs: 1000,
      });
      break;
    default:
      console.error(`Unknown preset: ${preset}`);
      printHelp();
  }
}

main().catch(err => {
  console.error('[research] Error:', err?.message || err);
  process.exit(1);
});
