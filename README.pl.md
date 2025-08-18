# Arduino MQTT Monitoring — Przewodnik po projekcie (PL)

Języki / Languages: [Polski (PL)](./README.pl.md) | [English (EN)](./README.en.md)

Monorepo zawiera kompletny, produkcyjny zestaw do akwizycji, transportu, monitoringu i wizualizacji telemetrii z urządzenia Arduino w czasie rzeczywistym.

Skróty: [Aspekt badawczy](./docs/ASPEKT_BADAWCZY.md) • [Glosariusz](./docs/GLOSARIUSZ.md)

- `api/` — Backend oparty na Express.js i TypeScript: odczyt portu szeregowego, publikacja/subskrypcja w MQTT, strumień WebSocket, endpointy HTTP, monitoring zasobów, obsługa sesji pomiarowych, eksport do CSV.
- `client/` — Dashboard w Next.js 15 (React 19, MUI, ApexCharts) z obsługą WebSocket i fallbackiem do HTTP.
- `mosquitto/` — Konfiguracja brokera Eclipse Mosquitto wraz z wolumenami.
- `serial-bridge/` — Narzędzie dla systemu Windows, służące do odczytu portu COM na hoście i publikacji danych do brokera MQTT.

Architektura wspiera trzy główne tryby uruchomienia: pełną konteneryzację w systemie Linux (z mapowaniem portu USB), pracę w systemie Windows z użyciem mostka szeregowego na hoście oraz lokalny development.

---

## Przegląd architektury

**Ścieżka przepływu danych:**

Urządzenie Arduino → (linie JSON wysyłane przez port szeregowy) → Broker MQTT (z flagą `retain`) → Subskrybent w API → WebSocket/HTTP → Interfejs użytkownika (UI)

Dodatkowo, API cyklicznie publikuje przetworzone dane (domyślnie co 1 sekundę), utrzymuje w pamięci ograniczoną historię odczytów oraz wysyła metryki zasobów co sekundę.

**Kluczowe komponenty:**

- `SerialService` — zapewnia odporną na błędy obsługę portu szeregowego z mechanizmami ponawiania połączenia (reconnect/backoff).
- `ArduinoDataService` — odczytuje ostatnią linię danych z portu szeregowego i publikuje ją do brokera MQTT z flagą `retain`.
- `MqttSubscriber` — waliduje odebrane ładunki, wzbogaca je o znacznik czasu, zarządza historią odczytów i emituje dane przez WebSocket.
- `ResourceMonitorService` — monitoruje zużycie CPU, pamięci, obciążenie pętli zdarzeń (ELU), opóźnienia, przepustowość, jitter i wiek danych (staleness). Odpowiada również za sesje pomiarowe i eksport do formatu CSV.
- `WebSocket Provider` (w kliencie) — zarządza cyklem życia połączenia WebSocket i dostarcza dane do komponentów wizualizacyjnych.

---

## Scenariusze uruchomienia

### A) Linux/WSL2 z bezpośrednim dostępem do urządzenia USB

1. Zmapuj urządzenie w głównym pliku `docker-compose.yml`:

   ```yaml
   services:
     arduino-api:
       environment:
         SERIAL_PORT: /dev/ttyUSB0 # lub /dev/ttyACM0
         BAUD_RATE: 9600
       devices:
         - /dev/ttyUSB0:/dev/ttyUSB0
   ```

2. Uruchom cały stos aplikacyjny:

   ```bash
   docker compose up -d --build
   ```

3. Sprawdź w logach kontenera API, czy port został poprawnie otwarty i czy napływają dane.

### B) Windows — zalecany tryb z mostkiem szeregowym

Ten tryb nie wymaga mapowania portu USB do kontenera.

1. Upewnij się, że w pliku `docker-compose.yml` zmienna `SERIAL_PORT` jest ustawiona na `disabled` (wartość domyślna).

2. Uruchom stos:

   ```powershell
   docker compose up -d --build
   ```

3. Uruchom mostek szeregowy na maszynie hosta:

   ```powershell
   cd serial-bridge
   copy .env.example .env
   # W pliku .env dostosuj COM_PORT do swojego urządzenia (np. COM3)
   npm install
   node serial-bridge.js
   ```

4. Zweryfikuj działanie, odpytując endpoint API:

   ```powershell
   curl http://localhost:5000/api/arduino-data
   ```

   Szczegółowy przewodnik: `docs/serial-bridge.md`.

### C) Opcjonalnie: Pełna konteneryzacja w systemie Windows

Jest to możliwe przy użyciu `usbipd-win` i WSL2, co pozwala na podpięcie urządzenia USB bezpośrednio do maszyny wirtualnej. W praktyce jednak tryb z mostkiem (B) jest prostszy w konfiguracji i bardziej stabilny.

---

## Zmienne środowiskowe

### API (`api/.env`)

```env
PORT=5000
NODE_ENV=production
SERIAL_PORT=disabled        # Ścieżka do portu, np. /dev/ttyUSB0, COM3, lub 'disabled'
BAUD_RATE=9600
MQTT_BROKER=mqtt://mosquitto:1883
MQTT_TOPIC=arduino/sensordata
SELF_POLL_URL=http://arduino-api:5000/api/arduino-data
LIVE_EMIT_ENABLED=1         # 0 wyłącza emisję przez WebSocket (alias: LIVE_REALTIME_ENABLED)
```

### Klient (`client/.env.local`)

```env
NEXT_PUBLIC_WS_URL=ws://localhost:5000
NEXT_PUBLIC_API_BASE=http://localhost:5000
```

### Mostek szeregowy (`serial-bridge/.env`)

```env
COM_PORT=COM3
BAUD_RATE=9600
MQTT_BROKER=mqtt://localhost:1883
MQTT_TOPIC=arduino/sensordata
```

---

## Główne endpointy API

- `GET /api/arduino-data` — zwraca ostatni odczyt wraz z ograniczoną historią, w formacie `{ success, data }`.
- `GET /health` — informuje o stanie serwisu, w tym o statusie połączenia z portem szeregowym.

**Monitoring i sesje pomiarowe:**

- `GET /api/monitor/live` — zwraca pojedynczą, aktualną próbkę metryk.
- `POST /api/monitor/start` — rozpoczyna nową sesję pomiarową. W ciele żądania: `{ label, mode: 'ws'|'polling', pollingIntervalMs?, sampleCount?, durationSec? }`.
- `POST /api/monitor/stop` — zatrzymuje sesję o podanym ID. W ciele: `{ id }`.
- `POST /api/monitor/reset` — kasuje wszystkie zapisane sesje.
- `GET /api/monitor/sessions` — zwraca listę wszystkich sesji.
- `GET /api/monitor/sessions/:id` — zwraca szczegóły pojedynczej sesji.
- `GET /api/monitor/sessions/export/csv` — eksportuje metryki wszystkich sesji do formatu CSV.
- `GET /api/monitor/live-emit` — sprawdza, czy emisja na żywo jest włączona.
- `POST /api/monitor/live-emit` — włącza lub wyłącza emisję. W ciele: `{ enabled: boolean }`.

**Zdarzenia WebSocket:**

- `arduinoData` — wysyła ostatni zestaw danych (jako string JSON).
- `metrics` — wysyła obiekt `LiveMetrics` (domyślnie co sekundę).

---

## Metryki na żywo (próbkowane co 1 s)

- Zużycie CPU przez proces, zużycie pamięci (RSS, heap, external, ArrayBuffers).
- Obciążenie pętli zdarzeń (ELU) i jej opóźnienia (percentyle p50/p99/max).
- Liczba aktywnych klientów WebSocket.
- Przepustowość: żądania HTTP/s, wiadomości WS/s, bajty/s (dla HTTP i WS) oraz sumy skumulowane.
- Średni rozmiar ładunku (bajty/żądanie, bajty/wiadomość).
- Jitter: odchylenie standardowe odstępów między zdarzeniami (dla HTTP i WS).
- Wiek danych (staleness): czas w milisekundach od ostatniego znacznika czasu z Arduino (im niższy, tym dane są „świeższe”).

Sesje pomiarowe zapisują próbki metryk i mogą opcjonalnie uruchamiać deterministyczne odpytywanie HTTP (polling) z poziomu API.

---

## Wdrożenie produkcyjne

- Do wdrożenia użyj wieloetapowych plików Dockerfile. Uruchamiaj aplikację za pomocą głównego pliku `docker-compose.yml`, który zarządza kontenerami Mosquitto, API i klienta.
- W środowisku produkcyjnym zaostrz politykę CORS i włącz bibliotekę Helmet (jest już skonfigurowana warunkowo w zależności od `NODE_ENV`).
- Rozważ wdrożenie centralnego systemu logowania i eksportu metryk (np. do systemu Prometheus).
- Skonfiguruj trwałość danych dla brokera Mosquitto (za pomocą wolumenów), jeśli wymagana jest retencja wiadomości.

---

## Rozwiązywanie problemów

- **Komunikat „Brak danych” lub pusty ładunek**: Sprawdź działanie mostka szeregowego (w systemie Windows) lub poprawność mapowania urządzenia i formatu JSON.
- **Błąd `ENOENT` lub `EACCES` na porcie szeregowym**: Zweryfikuj ścieżkę do portu i uprawnienia. W systemie Linux może być konieczne dodanie użytkownika do grupy `dialout` lub tymczasowe uruchomienie kontenera z uprawnieniami roota w celach diagnostycznych.
- **Błąd `ENOTFOUND` dla brokera MQTT**: Upewnij się, że używasz poprawnej nazwy hosta – `mosquitto` wewnątrz sieci Docker, a `localhost` przy dostępie z maszyny hosta.

---

## Wskazówki do badań

- Aby zapewnić rzetelność pomiarów, wyłącz emisje w czasie rzeczywistym na czas ich trwania. Możesz to zrobić, ustawiając zmienną `LIVE_EMIT_ENABLED=0` lub wysyłając żądanie `POST /api/monitor/live-emit` z ciałem `{ "enabled": false }`.
- Porównuj tryby WebSocket i HTTP Polling dla identycznych parametrów sesji. Eksportuj wyniki do formatu CSV, aby analizować jitter, przepustowość i zużycie CPU.

---

## Pomiary, eksport i dokumentacja badawcza

Po stronie API zaimplementowano kompletny mechanizm do przeprowadzania pomiarów, eksportu wyników i automatycznej aktualizacji dokumentacji badawczej.

- **Uruchomienie pełnego zestawu pomiarów** (pliki wynikowe są zapisywane w `api/benchmarks/<timestamp>/`):

  - Z katalogu `api/` wykonaj: `yarn measure`

- **Pliki wynikowe pojedynczego uruchomienia:**

  - `sessions.csv` — spłaszczone próbki z sesji pomiarowych (dla WS i HTTP).
  - `summary.json` — statystyki zbiorcze (średnie, ELU p99, jitter, staleness).
  - `README.md` — podsumowanie wyników z mapowaniem na wskaźniki w dashboardzie.

- **Aktualizacja dokumentu badawczego** o najnowsze wyniki (sekcja `AUTO-RESULTS` w `docs/ASPEKT_BADAWCZY.md`):
  - Z katalogu `api/` wykonaj: `yarn docs:research:update`

**Skróty do różnych trybów pomiarowych** (uruchamiane z katalogu `api/`):

- `npm run research:quick` — szybki test poprawności (sanity check).
- `npm run research:safe` — tryb bezpieczny (0.5–1 Hz, tick=500 ms), minimalizujący obciążenie.
- `npm run research:sanity` — stabilny test poprawności przy 1 Hz (12 s) z wyłączonym próbkowaniem CPU (`--disablePidusage`).
- `npm run research:full` — pełny zestaw testów (Hz: 0.5, 1, 2; Obciążenie CPU: 0, 25, 50%; tick=200 ms).

**Uwagi dla Windows PowerShell:**

- Unikaj składni `FOO=1 node ...`. W PowerShellu używaj flag przekazywanych do skryptu, np. `--disablePidusage` lub `--cpuSampleMs=1000`.

**Wskazówki dodatkowe:**

- Aby ograniczyć szum pomiarowy, tymczasowo wyłącz emisje w czasie rzeczywistym (`LIVE_EMIT_ENABLED=0` lub przez endpoint API).
- Parametry pomiarów i progi tolerancji można dostosować w pliku `api/src/scripts/measurementRunner.ts`.
- Flagi takie jak `--disablePidusage` (wyłącza próbnik CPU) oraz `--cpuSampleMs=1000` (zmniejsza częstotliwość próbkowania) pozwalają zredukować narzut samego mechanizmu monitorującego.

---

---

## Licencja i wkład

Projekt udostępniany na licencji MIT. Pull requesty i zgłoszenia błędów są mile widziane.
