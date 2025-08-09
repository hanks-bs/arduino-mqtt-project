# Aspekt badawczy – skrót dokumentacji

Poniżej zebrano zwięzły opis części badawczej projektu: cele, metodologia, metryki, procedury pomiarowe, kryteria oceny oraz mapowanie wyników na dashboard. Dokument przygotowuje grunt pod rozdział badawczy w pracy dyplomowej i wskazuje, jak replikować oraz interpretować wyniki.

## 1. Cel i pytania badawcze

Celem jest ilościowe porównanie dwóch sposobów dostarczania danych telemetrycznych z systemu IoT do klienta:

- WebSocket (WS) – transmisja push,
- HTTP Polling – cykliczne odpytywanie (pull).

Kluczowe pytania i hipotezy:

- P1: WS daje mniejszą latencję świeżości danych (freshness) niż HTTP dla porównywalnych częstotliwości (1–2 Hz).
- P2: Zależność bytesRate ≈ rate × payload powinna być spełniona dla obu metod (przy stałym ładunku).
- P3: Stabilność interwałów (jitter) jest lepsza przy kontrolowanym źródle (WS driver) niż przy tykaniu UI.
- P4: Narzut CPU/RSS i opóźnienia pętli zdarzeń (EL p99) pozostają akceptowalne przy 1–2 Hz.

## 2. Metryki i definicje

Mierzone metryki (wyliczane co ok. 1 s):

- Rate [/s]: wsMsgRate lub httpReqRate.
- Bytes/s: wsBytesRate lub httpBytesRate.
- ~Payload [B]: wsAvgBytesPerMsg lub httpAvgBytesPerReq.
- Jitter [ms]: odchylenie standardowe odstępów między wiadomościami/odpowiedziami.
- Freshness [ms]: czas od ostatniego odczytu danych (niższy = świeższe).
- EL p99 [ms]: 99. percentyl opóźnienia pętli zdarzeń Node.
- CPU [%], RSS [MB]: zużycie procesora i pamięci procesu.

Źródło metryk: `api/src/services/ResourceMonitorService.ts`.

## 3. Aparatura i środowisko

- Arduino → MQTT broker → API (Node.js/Express, Socket.IO) → Dashboard (Next.js/MUI/ApexCharts).
- Częstotliwość monitoringu: domyślnie 1 s (`MONITOR_TICK_MS`).
- Sterownik WS (tryb kontrolowany): stała częstotliwość (wsFixedRateHz) oraz założony rozmiar ładunku.
- HTTP (symulacja): wewnętrzny licznik odpowiedzi (onHttpResponse) z określonym rozmiarem ładunku.
- Emisje na żywo podczas pomiarów: wyłączone (izolacja wyników), włączane automatycznie dla sesji WS.

## 4. Procedura eksperymentalna

- Dwie serie na metodę (1 Hz i 2 Hz), czas pojedynczej sesji ~6–10 s.
- WS: sterownik o stałej częstotliwości (fair comparison). HTTP: symulowana odpowiedź w zadanym okresie.
- Oddzielenie sesji krótką przerwą, liczenie średnich po próbkach (bez warmup/cooldown w skrypcie domyślnie).
- Automatyczny pomiar:
  - Skrypt: `api/src/scripts/measurementRunner.ts`
  - Uruchomienie (z katalogu `api`): `yarn measure`
  - Artefakty: `api/benchmarks/<timestamp>/sessions.csv`, `summary.json`, `README.md`.

## 5. Kryteria oceny (wstępna walidacja)

- Rate OK: średnia częstość mieści się w ±50% oczekiwanej (z etykiety `@1Hz`/`@2Hz`).
- Payload OK: bytesPerUnit mieści się w ±50% założonego ładunku (`payload=XYZB`).
- Progi można zaostrzyć w `measurementRunner.ts` (sekcja `evaluate`).

## 6. Mapowanie na dashboard

- Częstotliwość (Rate) → wykres częstości WS/HTTP.
- Przepustowość (Bytes/s) → wykres przepływności danych.
- ~Payload [B] → wykres średniego rozmiaru ładunku.
- Jitter → stabilność interwałów (mniejsze = lepiej).
- Freshness → świeżość danych (mniejsze = szybciej dostarczone).
- EL p99 → opóźnienia pętli zdarzeń (niższe = lepiej).
- CPU/RSS → panel zasobów procesu.

## 7. Testy i walidacja poprawności

- Testy integracyjne (HTTP/WS) i E2E z realnym klientem Socket.IO.
- Test eksportu CSV (nagłówek, wartości numeryczne).
- Harness wiarygodności (`yarn harness`) – szybka inspekcja relacji rate/bytes.
- Wszystkie testy uruchamiane `yarn test` (w `api`).

## 8. Replikowalność i uruchomienie

- Wymagania: Node ≥ 20, Yarn ≥ 1.22, Windows/Linux.
- Uruchomienie pomiarów: `cd api && yarn measure`.
- Wyniki: `api/benchmarks/<znacznik_czasu>/{sessions.csv, summary.json, README.md}`.
- Dashboard można zestawić równolegle, ale skrypt pomiarowy działa niezależnie (bez UI).

## 9. Ograniczenia i zagrożenia dla trafności

- Zegary JS i współdzielenie CPU → jitter, zaniżenia/zanadto uśrednione wartości.
- Środowisko hosta (inne procesy, throttling energii, stan GC).
- Sieć i broker MQTT (opóźnienia/utrata pakietów).
- Krótki horyzont czasowy (6–10 s) – wyniki należy interpretować z rozwagą; dłuższe przebiegi mogą dać stabilniejsze średnie.

## 10. Dalsze prace

- Dłuższe sesje i trimming warmup/cooldown przy agregacjach.
- Uśrednianie wieloprzejściowe (N powtórzeń) i przedziały ufności.
- Automatyczne porównanie run vs. run (trend, regresje wydajności).
- Testy na różnych platformach (Windows/Linux/ARM) i przy różnych obciążeniach.

## 11. Załączniki i jak czytać eksport

- `sessions.csv` – surowe próbki (opis kolumn znajdziesz w README generowanym per run oraz w komentarzach `measurementRunner.ts`).
- `summary.json` – agregaty i checki (Rate OK / Payload OK).
- `README.md` w folderze benchmarku – podsumowanie tabelaryczne i instrukcje interpretacji wyników ściśle spójne z dashboardem.

## 12. Wyniki ostatnich pomiarów (auto)

Poniższa sekcja jest aktualizowana automatycznie na podstawie ostatniego folderu w `api/benchmarks/`.
Zawiera po dwa testy dla każdej metody (WS i HTTP) oraz krótkie wnioski.

<!-- AUTO-RESULTS:BEGIN -->

Ostatni run: 2025-08-09T13-53-06-784Z

Pliki: [sessions.csv](../api/benchmarks/2025-08-09T13-53-06-784Z/sessions.csv), [summary.json](../api/benchmarks/2025-08-09T13-53-06-784Z/summary.json), [README](../api/benchmarks/2025-08-09T13-53-06-784Z/README.md)

| Label | Mode | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | Świeżość [ms] | EL p99 [ms] | Rate OK | Payload OK |
|---|---:|---:|---:|---:|---:|---:|---:|:--:|:--:|
| WS@1Hz payload=360B | ws | 0.70 | 253 | 270 | 17.2 | 614 | 48.9 | ✅ | ✅ |
| WS@2Hz payload=360B | ws | 0.91 | 327 | 360 | 444.9 | 413 | 49.4 | ❌ | ✅ |
| HTTP@1Hz payload=420B | polling | 0.41 | 174 | 350 | 0.3 | 719 | 50.0 | ❌ | ✅ |
| HTTP@2Hz payload=420B | polling | 0.83 | 347 | 350 | 280.2 | 426 | 48.8 | ❌ | ✅ |

Wnioski:
- WS@1Hz payload=360B: rate=0.70 in [0.50, 1.50]; bytesPerUnit=360.0 in [180.0, 540.0]
- WS@2Hz payload=360B: rate=0.91 in [1.00, 3.00]; bytesPerUnit=360.0 in [180.0, 540.0]
- HTTP@1Hz payload=420B: rate=0.41 in [0.50, 1.50]; bytesPerUnit=420.0 in [210.0, 630.0]
- HTTP@2Hz payload=420B: rate=0.83 in [1.00, 3.00]; bytesPerUnit=420.0 in [210.0, 630.0]

<!-- AUTO-RESULTS:END -->
