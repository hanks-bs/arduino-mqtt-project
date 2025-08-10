# Arduino MQTT Monitoring – Full Project Guide

Języki / Languages: [Polski (PL)](./README.pl.md) | [English (EN)](./README.en.md)

Monorepo zawiera trzy główne elementy:

| Folder           | Rola                                                                           |
| ---------------- | ------------------------------------------------------------------------------ |
| `api/`           | Backend (Express + MQTT + WebSocket + monitor zasobów)                         |
| `client/`        | Aplikacja Next.js (UI, realtime)                                               |
| `mosquitto/`     | Konfiguracja brokera MQTT (Eclipse Mosquitto)                                  |
| `serial-bridge/` | (Windows) Mostek COM -> MQTT, gdy kontener nie ma dostępu do portu szeregowego |

Szczegółowe diagramy architektury i przepływu: zobacz `docs/architectural-overview.md`.

## 1. Wymagania wstępne

| Narzędzie                                         | Wersja (min)              |
| ------------------------------------------------- | ------------------------- |
| Docker Desktop                                    | aktualna / WSL2 (Windows) |
| Node.js (host – tylko dla serial-bridge albo dev) | 20+                       |
| Git                                               | dowolna                   |

## 2. Scenariusze uruchomienia

### 2.1 Linux / WSL2 z bezpośrednim dostępem do Arduino

1. Podłącz Arduino, sprawdź urządzenie:

   ```bash
   ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null
   ```

2. W `docker-compose.yml` ustaw:

   ```yaml
   SERIAL_PORT: /dev/ttyUSB0 # lub /dev/ttyACM0
   devices:
     - /dev/ttyUSB0:/dev/ttyUSB0
   ```

3. Uruchom stack:

   ```bash
   docker compose up -d --build
   ```

4. Sprawdź logi:

   ```bash
   docker logs -f arduino-api
   ```

5. Oczekuj logu: `[Serial] Otwarty port ...` oraz publikacji JSON.

### 2.2 Windows – rekomendowany mostek (bez USB w kontenerze)

1. Pozostaw w `docker-compose.yml`: `SERIAL_PORT=disabled` (już ustawione).

2. Uruchom usługi (broker, api, client):

   ```powershell
   docker compose up -d --build
   ```

3. Mostek:

   ```powershell
   cd serial-bridge
   copy .env.example .env   # dopasuj COM_PORT jeśli inny niż COM3
   npm install
   node serial-bridge.js
   ```

4. Po pierwszych liniach JSON zobaczysz w `curl http://localhost:5000/api/arduino-data` strukturę z `history`.

Pełny przewodnik: `docs/serial-bridge.md` (zawiera przykładowy skrypt i kroki weryfikacji).

### 2.3 Windows – pełna konteneryzacja (opcjonalne)

Wymaga usbipd-win + WSL2 i przypięcia urządzenia do dystrybucji. W większości przypadków prostszy jest mostek z pkt 2.2.

## 3. Zmienne środowiskowe

### 3.1 API (`api/.env` – przykład)

```env
PORT=5000
NODE_ENV=production
SERIAL_PORT=disabled        # /dev/ttyUSB0 / COM3 / disabled
BAUD_RATE=9600
MQTT_BROKER=mqtt://mosquitto:1883
MQTT_TOPIC=arduino/sensordata
SELF_POLL_URL=http://arduino-api:5000/api/arduino-data
LIVE_EMIT_ENABLED=1                # 0 wyłącza emisję WS (alias: LIVE_REALTIME_ENABLED)
```

### 3.2 Client (`client/.env.local` – jeśli potrzeba)

```env
NEXT_PUBLIC_WS_URL=ws://localhost:5000
NEXT_PUBLIC_API_BASE=http://localhost:5000
```

Uwagi:

- `NEXT_PUBLIC_API_BASE` (opcjonalny) definiuje bazowy adres dla zapytań HTTP (polling, przełączniki, eksport CSV). Jeśli nie podany, w kodzie klienta stosowany jest domyślny `http://localhost:5000`.
- `NEXT_PUBLIC_WS_URL` wskazuje bazę WebSocket (Socket.IO). W środowisku docker‑compose wartości są prekonfigurowane.

### 3.3 Serial Bridge (`serial-bridge/.env`)

```env
COM_PORT=COM3
BAUD_RATE=9600
MQTT_BROKER=mqtt://localhost:1883
MQTT_TOPIC=arduino/sensordata
```

## 4. Architektura przepływu danych

Arduino → (linia JSON) → Serial (COM lub /dev/tty\*) → [Mostek (Windows) lub API bezpośrednio] → MQTT Broker → API (subskrypcja) → WebSocket → Client UI.

API dodatkowo:

- publikuje dane co 1 s
- agreguje historię w pamięci
- monitoruje zasoby i emituje metryki

## 5. Kluczowe endpointy

| Endpoint                               | Opis                                               |
| -------------------------------------- | -------------------------------------------------- |
| `GET /api/arduino-data`                | Ostatnie dane + historia                           |
| `GET /health`                          | Status + serialOpen                                |
| `GET /api/monitor/sessions`            | Sesje monitoringu zasobów                          |
| `GET /api/monitor/sessions/export/csv` | Eksport sesji do CSV                               |
| `GET /api/monitor/live-emit`           | Sprawdzenie stanu emisji WS                        |
| `POST /api/monitor/live-emit`          | Włączenie/wyłączenie emisji `{ enabled: boolean }` |

WebSocket kanały:

| Event         | Dane                 |
| ------------- | -------------------- |
| `arduinoData` | JSON + history       |
| `metrics`     | Metryki żywe procesu |

Uwaga (testy): w celu ograniczenia zniekształceń podczas pomiarów można tymczasowo wyłączyć emisję `arduinoData` i `metrics`:

- ustawić w środowisku `LIVE_EMIT_ENABLED=0` (lub `LIVE_REALTIME_ENABLED=0`), albo
- skorzystać z endpointu `POST /api/monitor/live-emit` z `{ "enabled": false }`.

## 10. Pomiary, eksport i dokument badawczy

Pomiarów dokonujemy po stronie API. Zaimplementowany jest kompletny „measurement runner”, eksport wyników oraz automatyczna aktualizacja dokumentu badawczego.

- Uruchomienie pomiaru (zapisuje pliki wynikowe do `api/benchmarks/<timestamp>/`):
  - z katalogu `api/`: `yarn measure`
- Pliki wynikowe jednego uruchomienia:
  - `sessions.csv` – spłaszczone próbki z sesji (WS i HTTP)
  - `summary.json` – agregaty (średnie, ELU p99, jitter, staleness)
  - `README.md` – skrót wyników z mapowaniem do dashboardu
- Aktualizacja sekcji „Wyniki ostatnich pomiarów (auto)” w `docs/ASPEKT_BADAWCZY.md`:
  - z katalogu `api/`: `yarn docs:research:update`

Wskazówki:

- Na Windows (PowerShell) powyższe komendy działają tak samo jak na Linux/macOS.
- Jeśli chcesz ograniczyć szum w trakcie pomiarów, ustaw `LIVE_EMIT_ENABLED=0` lub użyj `POST /api/monitor/live-emit` z `enabled=false`.

## 6. Typowe problemy i rozwiązania

| Problem                | Przyczyna              | Rozwiązanie                                                                       |
| ---------------------- | ---------------------- | --------------------------------------------------------------------------------- |
| `Brak danych` ciągle   | Brak realnych odczytów | Sprawdź mostek lub port, format JSON                                              |
| EACCES przy /dev/tty\* | Uprawnienia            | group_add dialout / user root / chmod tymczasowo                                  |
| ENOENT port            | Zły path               | Zweryfikuj nazwę urządzenia / attach usbipd                                       |
| MQTT ENOTFOUND         | Hostname               | Upewnij się, że używasz `mosquitto` wewnątrz sieci docker lub `localhost` z hosta |

## 7. Development lokalny API (bez docker)

```bash
cd api
yarn install
yarn dev   # używa ts-node
```

Wtedy ustaw w `.env`: `MQTT_BROKER=mqtt://localhost:1883` i odpal tylko mosquitto + client w kontenerach, lub lokalnie broker.

## 8. Aktualizacja obrazów

```bash
docker compose build --no-cache api client
docker compose up -d
```

## 9. Sprzątanie

```bash
docker compose down -v
```

---

Gotowe – przejdź do sekcji odpowiedniej dla Twojego systemu (2.1 lub 2.2) i uruchom projekt.
