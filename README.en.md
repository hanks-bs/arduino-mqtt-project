# Arduino MQTT Monitoring — Production Guide (EN)

This monorepo contains a complete, production‑ready reference stack for real‑time Arduino telemetry acquisition, transport, monitoring, and visualization.

- api/ — Express + TypeScript backend: Serial ingestion, MQTT publish/subscribe, WebSocket streaming, HTTP polling endpoint, resource monitoring, sessions, CSV export
- client/ — Next.js 15 dashboard (React 19, MUI, ApexCharts) with WS + HTTP fallback
- mosquitto/ — Eclipse Mosquitto configuration and mounted volumes
- serial-bridge/ — Windows‑only helper to read COM port on host and publish to MQTT

The design supports three run modes: fully dockerized on Linux (USB mapped), Windows with a host serial bridge, and local development.

---

## Architecture overview

Data path:

Arduino → Serial JSON lines → MQTT retain topic → API subscriber → WS/HTTP → Client UI

Additionally, the API publishes processed data roughly every 1 s, maintains an in‑memory bounded history, and emits per‑second resource metrics.

Key components:

- SerialService — robust port handling with reconnect/backoff
- ArduinoDataService — reads latest serial line and publishes to MQTT (retain)
- MqttSubscriber — validates payloads, enriches with timestamp, maintains history, emits WS
- ResourceMonitorService — CPU/memory/ELU/event‑loop delay, throughput, jitter, staleness; sessions; CSV export
- Client WS Provider — central socket lifecycle and context; charts and KPIs across sections

---

## Run scenarios

### A) Linux/WSL2 with direct USB device

1. Map your device in root docker‑compose.yml:

```yaml
services:
  arduino-api:
    environment:
      SERIAL_PORT: /dev/ttyUSB0 # or /dev/ttyACM0
      BAUD_RATE: 9600
    devices:
      - /dev/ttyUSB0:/dev/ttyUSB0
```

2. Start the stack:

```bash
docker compose up -d --build
```

3. Verify API logs show an open serial port and periodic data.

### B) Windows — recommended Serial Bridge (no USB passthrough)

1. Keep `SERIAL_PORT=disabled` in compose (default provided).

2. Run the stack:

```pwsh
docker compose up -d --build
```

3. Start the bridge on host:

```pwsh
cd serial-bridge
copy .env.example .env
# adjust COM_PORT if needed (e.g., COM3)
npm install
node serial-bridge.js
```

4. Check the API endpoint:

```pwsh
curl http://localhost:5000/api/arduino-data
```

Full guide: docs/serial-bridge.md

### C) Optional: Full containerization on Windows

Possible with usbipd‑win + WSL2 attaching the USB device to the Linux VM. Usually the bridge mode is simpler and more robust.

---

## Environment variables

### API (api/.env)

```env
PORT=5000
NODE_ENV=production
SERIAL_PORT=disabled        # /dev/ttyUSB0 / COM3 / disabled
BAUD_RATE=9600
MQTT_BROKER=mqtt://mosquitto:1883
MQTT_TOPIC=arduino/sensordata
SELF_POLL_URL=http://arduino-api:5000/api/arduino-data
LIVE_EMIT_ENABLED=1         # 0 disables real-time WS emissions (alias: LIVE_REALTIME_ENABLED)
```

### Client (client/.env.local)

```env
NEXT_PUBLIC_WS_URL=ws://localhost:5000
NEXT_PUBLIC_API_BASE=http://localhost:5000
```

### Serial Bridge (serial-bridge/.env)

```env
COM_PORT=COM3
BAUD_RATE=9600
MQTT_BROKER=mqtt://localhost:1883
MQTT_TOPIC=arduino/sensordata
```

---

## Endpoints

- GET /api/arduino-data — latest composite payload (lastMeasurement + bounded history), JSON string wrapped in `{ success, data }`
- GET /health — service health including serial status

Monitoring & sessions:

- GET /api/monitor/live — single live metrics snapshot
- POST /api/monitor/start — body `{ label, mode: 'ws'|'polling', pollingIntervalMs?, sampleCount?, durationSec? }`
- POST /api/monitor/stop — body `{ id }`
- POST /api/monitor/reset — clears all sessions
- GET /api/monitor/sessions — list sessions
- GET /api/monitor/sessions/:id — single session
- GET /api/monitor/sessions/export/csv — CSV export of flattened metrics
- GET /api/monitor/live-emit — check real-time emission flag
- POST /api/monitor/live-emit — set `{ enabled: boolean }`

WebSocket events:

- arduinoData — latest composite dataset (JSON string)
- metrics — LiveMetrics object (per-second)

CSV columns (sessions.csv — quick reference):

- sessionId — session identifier
- label — human label (e.g., "WS@1Hz payload=360B cWs=10")
- mode — `ws` or `polling`
- startedAt, finishedAt — session timestamps
- sampleIndex — sample index within session (1..N)
- ts — sample timestamp (ISO)
- cpu — Node.js process CPU load [%]
- rssMB — resident set size [MB]
- heapUsedMB — heap usage [MB]
- elu — Event Loop Utilization (0..1)
- elDelayP99Ms — event‑loop delay p99 [ms]
- httpReqRate, wsMsgRate — request/message rates [/s]
- httpBytesRate, wsBytesRate — throughput [B/s]
- httpAvgBytesPerReq, wsAvgBytesPerMsg — average payload [B]
- httpJitterMs, wsJitterMs — inter‑arrival jitter [ms]
- tickMs — actual monitor sampling interval [ms]
- dataFreshnessMs — staleness (ms since last Arduino timestamp)
- sourceTsMs — source timestamp from device (ms) if available
- ingestTsMs — backend ingestion time (ms)
- emitTsMs — emission time to client (ms)

---

## Live metrics (per second)

- CPU percent (process), memory breakdown (RSS, heap, external, ArrayBuffers)
- Event Loop Utilization (ELU) and event‑loop delay percentiles (p50/p99/max)
- WS client count
- Throughput: HTTP req/s, WS msg/s, HTTP and WS bytes/s, cumulative totals
- Average payload sizes (HTTP bytes/req, WS bytes/msg)
- Jitter: stdDev of inter‑arrival intervals (HTTP, WS)
- Staleness (data age): milliseconds since last Arduino timestamp (lower is fresher)

Sessions can record these samples and optionally drive deterministic HTTP polling traffic from the API itself.

---

## Production deployment notes

- Use the provided multi‑stage Dockerfiles; run via root docker‑compose.yml to start Mosquitto, API, and Client.
- Restrict CORS and enable Helmet in production (already wired conditionally by NODE_ENV).
- Consider log aggregation (e.g., bring your own pino/winston) and metrics export (Prometheus) if needed.
- Persist Mosquitto volumes for message durability, if your use case requires it.

---

## Troubleshooting

- “Brak danych” or empty payloads: ensure the bridge is running (Windows) or the USB device is mapped and Arduino emits valid JSON lines.
- ENOENT/EACCES on serial: verify device path/permissions; for Linux use dialout group or run the container as root for debugging.
- MQTT hostnames: inside compose use service name `mosquitto`; from host use `localhost` (ports are published).

---

## Research workflow hints

- Use the live‑emit toggle to disable real‑time WS emissions during measurements: env `LIVE_EMIT_ENABLED=0` or POST `/api/monitor/live-emit` with `{ enabled:false }`.
- Compare WS vs HTTP polling by running sessions with identical durations/intervals; export CSV and analyze jitter, bytes/s, CPU.

---

## Benchmarks, export and research doc

The API provides a complete measurement pipeline, export, and auto‑update of the research document.

- Run the full measurement suite (artifacts under `api/benchmarks/<timestamp>/`):
  - `yarn measure` (from `api/`)
  - Stable sanity: `npm run research:sanity` (WS+HTTP @1 Hz, 12 s, pidusage disabled)
- Artifacts per run:
  - `sessions.csv` — flattened per‑second samples for WS and HTTP
  - `summary.json` — summary metrics (averages, EL delay p99, jitter, staleness)
  - `by_load.csv`, `by_clients.csv` — averages by CPU load and by number of clients
  - `by_clients_normalized.csv` — metrics normalized per client
  - `README.md` — human‑readable summary mapped to the dashboard
- Update the research document with the latest results (auto section in `docs/ASPEKT_BADAWCZY.md`):
  - `yarn docs:research:update` (from `api/`)

Notes:

- To reduce noise, temporarily disable real‑time emissions: `LIVE_EMIT_ENABLED=0` or `POST /api/monitor/live-emit` with `{ enabled:false }`.
- You can tune parameters and tolerances in `api/src/scripts/measurementRunner.ts`.
- Runner flags (PowerShell‑friendly): `--disablePidusage` to turn off CPU sampling; `--cpuSampleMs=1000` to throttle it.

---

---

## License and contributions

Add your license (e.g., MIT). Pull Requests and issues welcome.
