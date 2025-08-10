# Arduino MQTT Monitoring — Przewodnik produkcyjny (PL)

Monorepo zawiera kompletny, produkcyjny zestaw do akwizycji, transportu, monitoringu i wizualizacji telemetrii z Arduino w czasie rzeczywistym.

- api/ — Backend Express + TypeScript: odczyt szeregowy, publikacja/subskrypcja MQTT, strumień WebSocket, endpoint HTTP, monitoring zasobów, sesje, eksport CSV
- client/ — Dashboard Next.js 15 (React 19, MUI, ApexCharts) z WS + HTTP fallback
- mosquitto/ — Konfiguracja Eclipse Mosquitto i wolumeny
- serial-bridge/ — Narzędzie dla Windows do odczytu COM na hoście i publikacji do MQTT

Architektura wspiera trzy tryby uruchomienia: pełna konteneryzacja na Linux (USB zmapowane), Windows z mostkiem szeregowym na hoście oraz lokalny development.

---

## Przegląd architektury

Ścieżka danych:

Arduino → linie JSON z portu szeregowego → MQTT (retain) → subskrybent w API → WS/HTTP → UI klienta

Dodatkowo API publikuje przetworzone dane co ~1 s, utrzymuje ograniczoną historię w pamięci oraz wysyła metryki zasobów co sekundę.

Kluczowe komponenty:

- SerialService — odporna obsługa portu z reconnect/backoff
- ArduinoDataService — pobiera ostatnią linię z serial i publikuje do MQTT (retain)
- MqttSubscriber — waliduje ładunki, dodaje znacznik czasu, utrzymuje historię, emituje WS
- ResourceMonitorService — CPU/pamięć/ELU/opóźnienia pętli, przepływność, jitter, staleness (wiek danych); sesje; CSV
- WebSocket Provider (client) — zarządza cyklem życia gniazda; wykresy i KPI w sekcjach

---

## Scenariusze uruchomienia

### A) Linux/WSL2 z bezpośrednim urządzeniem USB

1. Zmapuj urządzenie w pliku docker‑compose.yml (root):

```yaml
services:
  arduino-api:
    environment:
      SERIAL_PORT: /dev/ttyUSB0 # lub /dev/ttyACM0
      BAUD_RATE: 9600
    devices:
      - /dev/ttyUSB0:/dev/ttyUSB0
```

2. Uruchom stack:

```bash
docker compose up -d --build
```

3. Sprawdź w logach API otwarcie portu i napływ danych.

### B) Windows — zalecany mostek szeregowy (bez USB w kontenerze)

1. Pozostaw `SERIAL_PORT=disabled` w compose (domyślne).

2. Uruchom stack:

```pwsh
docker compose up -d --build
```

3. Uruchom mostek na hoście:

```pwsh
cd serial-bridge
copy .env.example .env
# dopasuj COM_PORT (np. COM3)
npm install
node serial-bridge.js
```

4. Zweryfikuj endpoint API:

```pwsh
curl http://localhost:5000/api/arduino-data
```

Pełny przewodnik: docs/serial-bridge.md

### C) Opcjonalnie: pełna konteneryzacja na Windows

Możliwa z usbipd‑win + WSL2 i podpięciem USB do VM. W praktyce tryb mostka jest prostszy i stabilniejszy.

---

## Zmienne środowiskowe

### API (api/.env)

```env
PORT=5000
NODE_ENV=production
SERIAL_PORT=disabled        # /dev/ttyUSB0 / COM3 / disabled
BAUD_RATE=9600
MQTT_BROKER=mqtt://mosquitto:1883
MQTT_TOPIC=arduino/sensordata
SELF_POLL_URL=http://arduino-api:5000/api/arduino-data
LIVE_EMIT_ENABLED=1         # 0 wyłącza emisje WS (alias: LIVE_REALTIME_ENABLED)
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

## Endpointy

- GET /api/arduino-data — ostatni zestaw (lastMeasurement + bounded history), łańcuch JSON w `{ success, data }`
- GET /health — zdrowie serwisu, status serial

Monitoring i sesje:

- GET /api/monitor/live — pojedyncza próbka metryk
- POST /api/monitor/start — body `{ label, mode: 'ws'|'polling', pollingIntervalMs?, sampleCount?, durationSec? }`
- POST /api/monitor/stop — body `{ id }`
- POST /api/monitor/reset — kasuje sesje
- GET /api/monitor/sessions — lista sesji
- GET /api/monitor/sessions/:id — jedna sesja
- GET /api/monitor/sessions/export/csv — eksport metryk do CSV
- GET /api/monitor/live-emit — sprawdź przełącznik emisji
- POST /api/monitor/live-emit — ustaw `{ enabled: boolean }`

Zdarzenia WebSocket:

- arduinoData — ostatni zestaw danych (łańcuch JSON)
- metrics — obiekt LiveMetrics (co sekundę)

---

## Metryki na żywo (co 1 s)

- CPU procesu, pamięć (RSS, heap, external, ArrayBuffers)
- ELU i percentyle opóźnienia pętli zdarzeń (p50/p99/max)
- Liczba klientów WS
- Przepływność: HTTP req/s, WS msg/s, bajty/s (HTTP, WS) oraz skumulowane sumy
- Średnie rozmiary ładunków (bajty/req, bajty/msg)
- Jitter: odchylenie standardowe odstępów (HTTP, WS)
- Staleness (wiek danych): ms od ostatniego timestamp z Arduino (niżej=lepiej)

Sesje zapisują próbki i opcjonalnie uruchamiają z API deterministyczne sprawdzanie HTTP (polling).

---

## Wdrożenie produkcyjne

- Użyj wieloetapowych Dockerfile; uruchamiaj przez root docker‑compose.yml (Mosquitto, API, Client).
- W produkcji zaostrz CORS i włącz Helmet (już warunkowo wg NODE_ENV).
- Rozważ agregację logów i eksport metryk (Prometheus).
- Trwałość Mosquitto (wolumeny) jeśli wymagana retencja.

---

## Rozwiązywanie problemów

- „Brak danych”/pusty payload: sprawdź mostek (Windows) lub mapowanie urządzenia i format JSON.
- ENOENT/EACCES na serial: zweryfikuj ścieżkę/uprawnienia; na Linux użyj grupy dialout lub uruchom kontener jako root do debug.
- Hostname MQTT: wewnątrz compose użyj `mosquitto`, z hosta `localhost`.

---

## Wskazówki do badań

- Wyłącz emisje w czasie rzeczywistym na czas pomiarów: `LIVE_EMIT_ENABLED=0` lub POST `/api/monitor/live-emit` z `{ enabled:false }`.
- Porównuj WS vs HTTP polling dla identycznych parametrów sesji; eksportuj CSV i analizuj jitter, bajty/s, CPU.

---

## Pomiary, eksport i dokument badawczy

Po stronie API dostępny jest kompletny mechanizm pomiarów, eksportu i aktualizacji dokumentacji.

- Uruchom pełny zestaw pomiarowy (pliki wynikowe w `api/benchmarks/<timestamp>/`):
  - `yarn measure` (z katalogu `api/`)
- Pliki wynikowe jednego uruchomienia:
  - `sessions.csv` — spłaszczone próbki sesji (WS i HTTP)
  - `summary.json` — agregaty (średnie, ELU p99, jitter, staleness)
  - `README.md` — podsumowanie z mapowaniem do dashboardu
- Zaktualizuj dokument badawczy o ostatnie wyniki (sekcja auto w `docs/ASPEKT_BADAWCZY.md`):
  - `yarn docs:research:update` (z katalogu `api/`)

Uwagi:

- Aby ograniczyć szum, tymczasowo wyłącz emisje w czasie rzeczywistym: `LIVE_EMIT_ENABLED=0` lub `POST /api/monitor/live-emit` z `{ enabled:false }`.
- Parametry i tolerancje możesz dostosować w `api/src/scripts/measurementRunner.ts`.

---

---

## Licencja i wkład

Dodaj licencję (np. MIT). PR i zgłoszenia mile widziane.
