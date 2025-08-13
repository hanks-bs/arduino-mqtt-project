# Arduino MQTT Monitoring — Production Guide (EN)

This monorepo contains a complete, production-ready reference stack for real-time Arduino telemetry acquisition, transport, monitoring, and visualization.

- `api/` — Express.js + TypeScript backend: Serial ingestion, MQTT publish/subscribe, WebSocket streaming, HTTP polling endpoint, resource monitoring, measurement sessions, and CSV export.
- `client/` — Next.js 15 dashboard (React 19, MUI, ApexCharts) with WebSocket support and an HTTP fallback.
- `mosquitto/` — Eclipse Mosquitto broker configuration and mounted volumes.
- `serial-bridge/` — A Windows-only helper tool to read from a COM port on the host and publish data to the MQTT broker.

The architecture supports three main run modes: fully containerized on Linux (with USB mapping), Windows with a host-based serial bridge, and local development.

---

## Architecture Overview

**Data Path:**

Arduino device → (JSON lines sent via serial port) → MQTT Broker (with `retain` flag) → API Subscriber → WebSocket/HTTP → Client User Interface (UI)

Additionally, the API periodically publishes processed data (by default, every 1 second), maintains a bounded in-memory history of readings, and emits resource metrics every second.

**Key Components:**

- `SerialService` — Provides robust serial port handling with reconnect/backoff mechanisms.
- `ArduinoDataService` — Reads the latest data line from the serial port and publishes it to the MQTT broker with the `retain` flag.
- `MqttSubscriber` — Validates incoming payloads, enriches them with a timestamp, manages the reading history, and emits data via WebSocket.
- `ResourceMonitorService` — Monitors CPU usage, memory, event loop utilization (ELU), delays, throughput, jitter, and data staleness. It also handles measurement sessions and CSV exports.
- `WebSocket Provider` (in the client) — Manages the WebSocket connection lifecycle and delivers data to visualization components.

---

## Run Scenarios

### A) Linux/WSL2 with Direct USB Device Access

1. Map your device in the root `docker-compose.yml` file:

   ```yaml
   services:
     arduino-api:
       environment:
         SERIAL_PORT: /dev/ttyUSB0 # or /dev/ttyACM0
         BAUD_RATE: 9600
       devices:
         - /dev/ttyUSB0:/dev/ttyUSB0
   ```

2. Start the entire application stack:

   ```bash
   docker compose up -d --build
   ```

3. Check the API container logs to confirm that the port was opened correctly and that data is flowing.

### B) Windows — Recommended Mode with Serial Bridge

This mode does not require mapping the USB port to the container.

1. Ensure that the `SERIAL_PORT` variable in `docker-compose.yml` is set to `disabled` (the default value).

2. Start the stack:

   ```powershell
   docker compose up -d --build
   ```

3. Run the serial bridge on the host machine:

   ```powershell
   cd serial-bridge
   copy .env.example .env
   # Adjust COM_PORT in the .env file to match your device (e.g., COM3)
   npm install
   node serial-bridge.js
   ```

4. Verify the setup by querying the API endpoint:

   ```powershell
   curl http://localhost:5000/api/arduino-data
   ```

   A detailed guide is available in `docs/serial-bridge.md`.

### C) Optional: Full Containerization on Windows

This is possible using `usbipd-win` and WSL2, which allows you to attach a USB device directly to the virtual machine. However, in practice, the bridge mode (B) is simpler to configure and more stable.

---

## Environment Variables

### API (`api/.env`)

```env
PORT=5000
NODE_ENV=production
SERIAL_PORT=disabled        # Path to the port, e.g., /dev/ttyUSB0, COM3, or 'disabled'
BAUD_RATE=9600
MQTT_BROKER=mqtt://mosquitto:1883
MQTT_TOPIC=arduino/sensordata
SELF_POLL_URL=http://arduino-api:5000/api/arduino-data
LIVE_EMIT_ENABLED=1         # 0 disables WebSocket emissions (alias: LIVE_REALTIME_ENABLED)
```

### Client (`client/.env.local`)

```env
NEXT_PUBLIC_WS_URL=ws://localhost:5000
NEXT_PUBLIC_API_BASE=http://localhost:5000
```

### Serial Bridge (`serial-bridge/.env`)

```env
COM_PORT=COM3
BAUD_RATE=9600
MQTT_BROKER=mqtt://localhost:1883
MQTT_TOPIC=arduino/sensordata
```

---

## Main API Endpoints

- `GET /api/arduino-data` — Returns the latest reading along with a bounded history, in the format `{ success, data }`.
- `GET /health` — Reports the service's health, including the serial port connection status.

**Monitoring and Measurement Sessions:**

- `GET /api/monitor/live` — Returns a single, current sample of metrics.
- `POST /api/monitor/start` — Starts a new measurement session. Request body: `{ label, mode: 'ws'|'polling', pollingIntervalMs?, sampleCount?, durationSec? }`.
- `POST /api/monitor/stop` — Stops the session with the specified ID. Body: `{ id }`.
- `POST /api/monitor/reset` — Deletes all saved sessions.
- `GET /api/monitor/sessions` — Returns a list of all sessions.
- `GET /api/monitor/sessions/:id` — Returns the details of a single session.
- `GET /api/monitor/sessions/export/csv` — Exports all session metrics to a CSV file.
- `GET /api/monitor/live-emit` — Checks if live emissions are enabled.
- `POST /api/monitor/live-emit` — Enables or disables emissions. Body: `{ enabled: boolean }`.

**WebSocket Events:**

- `arduinoData` — Sends the latest dataset (as a JSON string).
- `metrics` — Sends the `LiveMetrics` object (by default, every second).

---

## Live Metrics (Sampled Every 1s)

- Process CPU usage, memory consumption (RSS, heap, external, ArrayBuffers).
- Event loop utilization (ELU) and its delays (p50/p99/max percentiles).
- Number of active WebSocket clients.
- Throughput: HTTP requests/s, WebSocket messages/s, bytes/s (for both HTTP and WS), and cumulative totals.
- Average payload size (bytes/request, bytes/message).
- Jitter: standard deviation of event intervals (for both HTTP and WS).
- Data staleness: time in milliseconds since the last timestamp from the Arduino (lower is "fresher").

Measurement sessions record samples of these metrics and can optionally run deterministic HTTP polling from the API level.

---

## Production Deployment

- For deployment, use the multi-stage Dockerfiles. Run the application using the root `docker-compose.yml` file, which manages the Mosquitto, API, and client containers.
- In a production environment, tighten the CORS policy and enable the Helmet library (it is already conditionally configured based on `NODE_ENV`).
- Consider implementing a centralized logging system and exporting metrics (e.g., to Prometheus).
- Configure data persistence for the Mosquitto broker (using volumes) if message retention is required.

---

## Troubleshooting

- **"No data" message or empty payload**: Check the serial bridge's operation (on Windows) or the device mapping and JSON format.
- **`ENOENT` or `EACCES` error on the serial port**: Verify the port path and permissions. On Linux, you may need to add the user to the `dialout` group or temporarily run the container as root for diagnostic purposes.
- **`ENOTFOUND` error for the MQTT broker**: Ensure you are using the correct hostname – `mosquitto` within the Docker network, and `localhost` when accessing from the host machine.

---

## Research Tips

- To ensure the reliability of measurements, disable real-time emissions during their execution. You can do this by setting the `LIVE_EMIT_ENABLED=0` variable or by sending a `POST /api/monitor/live-emit` request with the body `{ "enabled": false }`.
- Compare WebSocket and HTTP Polling modes using identical session parameters. Export the results to a CSV file to analyze jitter, throughput, and CPU usage.

---

## Measurements, Export, and Research Documentation

The API side implements a complete mechanism for conducting measurements, exporting results, and automatically updating the research documentation.

- **Run the full measurement suite** (output files are saved in `api/benchmarks/<timestamp>/`):
  - From the `api/` directory, run: `yarn measure`

- **Output files from a single run:**
  - `sessions.csv` — Flattened samples from measurement sessions (for WS and HTTP).
  - `summary.json` — Aggregate statistics (averages, ELU p99, jitter, staleness).
  - `README.md` — A summary of the results with a mapping to the dashboard indicators.

- **Update the research document** with the latest results (the `AUTO-RESULTS` section in `docs/ASPEKT_BADAWCZY.md`):
  - From the `api/` directory, run: `yarn docs:research:update`

**Shortcuts for different measurement modes** (run from the `api/` directory):

- `npm run research:quick` — A quick sanity check.
- `npm run research:safe` — A safe mode (0.5–1 Hz, tick=500 ms) that minimizes load.
- `npm run research:sanity` — A stable sanity check at 1 Hz (12 s) with CPU sampling disabled (`--disablePidusage`).
- `npm run research:full` — A full test suite (Hz: 0.5, 1, 2; CPU Load: 0, 25, 50%; tick=200 ms).

**Notes for Windows PowerShell:**

- Avoid syntax like `FOO=1 node ...`. In PowerShell, use flags passed to the script, e.g., `--disablePidusage` or `--cpuSampleMs=1000`.

**Additional Tips:**

- To reduce measurement noise, temporarily disable real-time emissions (`LIVE_EMIT_ENABLED=0` or via the API endpoint).
- Measurement parameters and tolerance thresholds can be adjusted in the `api/src/scripts/measurementRunner.ts` file.
- Flags like `--disablePidusage` (disables the CPU sampler) and `--cpuSampleMs=1000` (reduces the sampling frequency) help minimize the overhead of the monitoring mechanism itself.

---
---

## License and Contributions

This project is licensed under the MIT License. Pull requests and bug reports are welcome.
