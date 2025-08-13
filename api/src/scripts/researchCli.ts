/*
 Lightweight CLI that wraps runMeasurements with named presets to keep package.json clean.
 Usage: ts-node -r tsconfig-paths/register ./src/scripts/researchCli.ts <preset>
 Presets: list, sanity, stable, stable60, quick, safe, robust, clients, viz
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
  | 'viz';

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
