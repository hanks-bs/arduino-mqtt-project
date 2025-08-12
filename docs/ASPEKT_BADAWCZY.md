# Aspekt badawczy – skrót dokumentacji

Poniżej zebrano zwięzły opis części badawczej projektu: cele, metodologia, metryki, procedury pomiarowe, kryteria oceny oraz mapowanie wyników na dashboard. Dokument opisuje, jak replikować oraz interpretować wyniki.

## 1. Cel i pytania badawcze

Celem jest ilościowe porównanie dwóch sposobów dostarczania danych telemetrycznych z systemu IoT do klienta:

- WebSocket (WS) – transmisja push,
- HTTP Polling – cykliczne odpytywanie (pull).

Kluczowe pytania i hipotezy (H):

- H1: WebSocket (push) zapewnia niższy staleness [ms] niż HTTP polling przy tych samych Hz (0.5–2 Hz), bo dane trafiają „natychmiast” po publikacji, a nie w oknie odpytywania.
- H2: Dla stałego ładunku Bytes/s ≈ Rate × Payload (w obu metodach); odchylenie > 30% wskazuje błąd lub silny jitter/trim.
- H3: Jitter [ms] (stabilność interwałów) jest niższy w WS (sterowany driver) niż w HTTP (timery/kolejki JS).
- H4: Narzut CPU i ELU p99 rośnie wraz z Hz i liczbą klientów; przy ≤ 2 Hz obie metody mieszczą się w „akceptowalnym” zakresie dla pojedynczej instancji API.
- H5: Przy wzroście liczby klientów obciążenie CPU i pamięci rośnie szybciej dla HTTP (koszt żądań) niż dla WS (broadcast).

Charakterystyka metod i oczywiste różnice obserwowalne od razu:

- WS: push, brak stałego narzutu request/response; „świeższe” dane (niższy staleness), zwykle mniejszy jitter; lepsza wydajność broadcastu do wielu klientów.
- HTTP: pull, okres odpytywania determinuje staleness (≈ okres); koszt per klient (request/headers), większy narzut przy N klientach; jitter zależny od precyzji timerów i obciążenia event loop.

## 2. Metryki i definicje

Mierzone metryki (wyliczane co ok. 1 s):

- Rate [/s]: wsMsgRate lub httpReqRate.
- Bytes/s: wsBytesRate lub httpBytesRate.
- ~Payload [B]: wsAvgBytesPerMsg lub httpAvgBytesPerReq.
- Jitter [ms]: odchylenie standardowe odstępów między wiadomościami/odpowiedziami.
- Staleness [ms] (wiek danych): czas od ostatniego odczytu danych (niższy = świeższe).
- ELU p99 [ms]: 99. percentyl opóźnienia pętli zdarzeń Node (metryka skorelowana z ELU).
- CPU [%], RSS [MB]: zużycie procesora i pamięci procesu.

Źródło metryk: `api/src/services/ResourceMonitorService.ts`.

## 3. Aparatura i środowisko

- Arduino → MQTT broker → API (Node.js/Express, Socket.IO) → Dashboard (Next.js/MUI/ApexCharts).
- Częstotliwość monitoringu: sterowana przez `MONITOR_TICK_MS` (domyślnie 1000 ms w aplikacji; w skryptach badawczych najczęściej 200–250 ms).
- Sterownik WS (tryb kontrolowany): stała częstotliwość (wsFixedRateHz) oraz założony rozmiar ładunku.
- HTTP (symulacja): wewnętrzny licznik odpowiedzi (onHttpResponse) z określonym rozmiarem ładunku.
- Emisje na żywo podczas pomiarów: wyłączone (izolacja wyników), włączane automatycznie dla sesji WS.
- Opcjonalne obciążenie CPU na czas sesji: generator w wątkach roboczych (worker_threads), sterowany polami `loadCpuPct` (0..100) i `loadWorkers` (1..8).

## 4. Procedura eksperymentalna

- Dwie serie na metodę (1 Hz i 2 Hz), czas pojedynczej sesji ~6–10 s.
- WS: sterownik o stałej częstotliwości (fair comparison). HTTP: symulowana odpowiedź w zadanym okresie.
- Oddzielenie sesji krótką przerwą; agregacja po próbkach z domyślnym trimmowaniem warmup/cooldown (0.5 s / 0.5 s).
- Automatyczny pomiar:
  - Skrypt: `api/src/scripts/measurementRunner.ts`
  - Uruchomienie (z katalogu `api`):
    - `npm run research:quick` — szybki sanity check (krótki przebieg) + walidacja auto
    - `npm run research:safe` — ostrożny bieg (Hz ≤ 1, tick=500 ms) + walidacja auto
    - `npm run research:full` — alias do solidnego biegu „robust” (30 s, 2 powtórzenia; Hz: 0.5,1,2; obciążenia: 0,25,50) + walidacja auto
    - `npm run research:matrix` — pełna macierz przez skrypt PowerShell (rozszerzenia: klienci, wyższe Hz)
  - Pliki wynikowe: `api/benchmarks/<timestamp>/sessions.csv`, `summary.json`, `README.md`.

## 5. Kryteria oceny (wstępna walidacja)

- Rate OK: średnia częstość mieści się w ±50% oczekiwanej (z etykiety `@1Hz`/`@2Hz`).
- Payload OK: bytesPerUnit mieści się w ±50% założonego ładunku (`payload=XYZB`).
- Progi można zaostrzyć w `measurementRunner.ts` (sekcja `evaluate`).

## 6. Mapowanie na dashboard

- Częstotliwość (Rate) → wykres częstości WS/HTTP.
- Przepustowość (Bytes/s) → wykres przepływności danych.
- ~Payload [B] → wykres średniego rozmiaru ładunku.
- Jitter → stabilność interwałów (mniejsze = lepiej).
- Staleness → wiek danych (mniejsze = szybciej dostarczone).
- ELU p99 → opóźnienia pętli zdarzeń (niższe = lepiej).
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
- `summary.json` – uśrednione wyniki i checki (Rate OK / Payload OK).
- `README.md` w folderze benchmarku – podsumowanie tabelaryczne i instrukcje interpretacji wyników ściśle spójne z dashboardem.

## 12. Wyniki ostatnich pomiarów (auto)

Poniższa sekcja jest aktualizowana automatycznie na podstawie ostatniego folderu w `api/benchmarks/`.
Zawiera podsumowanie sesji, uśrednione wyniki wg obciążenia i liczby klientów oraz wizualne porównanie WS vs HTTP.
Aktualizator wybiera najnowszy katalog po czasie modyfikacji (mtime), co eliminuje problemy sortowania nazw na różnych platformach.

<!-- AUTO-RESULTS:BEGIN -->

Ostatni run: 2025-08-12T23-21-17-499Z

Status: fair payload: TAK, source-limited: NIE, czas: 20s, tick: 200 ms, repeats: 4

Pliki: [sessions.csv](../api/benchmarks/2025-08-12T23-21-17-499Z/sessions.csv), [summary.json](../api/benchmarks/2025-08-12T23-21-17-499Z/summary.json), [README](../api/benchmarks/2025-08-12T23-21-17-499Z/README.md)

Uwaga: tabele uporządkowane wg: Mode (WS, HTTP) → Hz → Obciążenie → Klienci.

Uwaga: Scenariusze z liczbą klientów = 0 mają różną semantykę: WS (push) emituje niezależnie od liczby klientów (mierzymy tempo emisji), natomiast HTTP (pull) przy 0 klientach nie generuje żądań → brak aktywności. Dlatego w porównaniach WS vs HTTP ("Zwycięzcy", tabele WS vs HTTP) takie wiersze są pomijane.

| Label | Mode | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | Staleness [ms] | ELU p99 [ms] | CPU [%] | RSS [MB] | n (used/total) | Rate OK | Payload OK |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--:|:--:|:--:|
| WS@1Hz payload=360B [rep 1/4] | ws | 1.10 | 395 | 360 | 3.9 | 511 | 35.3 | 3.0 | 186.0 | 11/12 | ✅ | ✅ |
| WS@1Hz payload=360B [rep 2/4] | ws | 1.00 | 360 | 360 | 2.6 | 526 | 32.3 | 1.1 | 175.1 | 9/11 | ✅ | ✅ |
| WS@1Hz payload=360B [rep 3/4] | ws | 0.97 | 349 | 360 | 0.7 | 388 | 34.0 | 1.3 | 174.8 | 11/13 | ✅ | ✅ |
| WS@1Hz payload=360B [rep 4/4] | ws | 0.97 | 349 | 360 | 1.1 | 482 | 34.7 | 1.2 | 174.9 | 11/13 | ✅ | ✅ |
| WS@1Hz payload=360B cWs=10 [rep 1/4] | ws | 1.15 | 414 | 360 | 0.7 | 497 | 39.7 | 1.3 | 209.8 | 9/11 | ✅ | ✅ |
| WS@1Hz payload=360B cWs=10 [rep 2/4] | ws | 0.98 | 353 | 360 | 4.7 | 604 | 34.4 | 1.3 | 178.8 | 10/13 | ✅ | ✅ |
| WS@1Hz payload=360B cWs=10 [rep 3/4] | ws | 1.00 | 361 | 360 | 1.0 | 454 | 33.1 | 1.0 | 179.1 | 10/14 | ✅ | ✅ |
| WS@1Hz payload=360B cWs=10 [rep 4/4] | ws | 1.04 | 375 | 360 | 0.6 | 304 | 34.0 | 1.5 | 179.4 | 10/13 | ✅ | ✅ |
| WS@1Hz payload=360B cWs=25 [rep 1/4] | ws | 1.12 | 405 | 360 | 3.1 | 592 | 35.7 | 2.0 | 206.4 | 8/9 | ✅ | ✅ |
| WS@1Hz payload=360B cWs=25 [rep 2/4] | ws | 1.00 | 361 | 360 | 1.2 | 515 | 37.8 | 2.0 | 179.9 | 10/12 | ✅ | ✅ |
| WS@1Hz payload=360B cWs=25 [rep 3/4] | ws | 1.02 | 366 | 360 | 0.5 | 534 | 35.4 | 1.7 | 182.3 | 10/13 | ✅ | ✅ |
| WS@1Hz payload=360B cWs=25 [rep 4/4] | ws | 1.06 | 383 | 360 | 1.6 | 489 | 32.7 | 1.7 | 185.4 | 9/12 | ✅ | ✅ |
| WS@1Hz payload=360B + load=25% [rep 1/4] | ws | 0.95 | 341 | 360 | 2.5 | 529 | 33.9 | 26.3 | 188.5 | 11/13 | ✅ | ✅ |
| WS@1Hz payload=360B + load=25% [rep 2/4] | ws | 0.99 | 358 | 360 | 0.5 | 428 | 33.5 | 25.5 | 188.6 | 9/12 | ✅ | ✅ |
| WS@1Hz payload=360B + load=25% [rep 3/4] | ws | 1.03 | 372 | 360 | 0.8 | 496 | 33.9 | 26.3 | 189.1 | 10/13 | ✅ | ✅ |
| WS@1Hz payload=360B + load=25% [rep 4/4] | ws | 0.94 | 337 | 360 | 0.5 | 481 | 33.0 | 25.8 | 189.1 | 11/13 | ✅ | ✅ |
| WS@1Hz payload=360B + load=25% cWs=10 [rep 1/4] | ws | 1.04 | 375 | 360 | 0.5 | 557 | 32.7 | 24.1 | 191.9 | 9/11 | ✅ | ✅ |
| WS@1Hz payload=360B + load=25% cWs=10 [rep 2/4] | ws | 0.97 | 350 | 360 | 0.7 | 488 | 32.5 | 27.1 | 192.8 | 10/13 | ✅ | ✅ |
| WS@1Hz payload=360B + load=25% cWs=10 [rep 3/4] | ws | 1.03 | 372 | 360 | 1.1 | 450 | 33.8 | 25.8 | 194.1 | 10/13 | ✅ | ✅ |
| WS@1Hz payload=360B + load=25% cWs=10 [rep 4/4] | ws | 0.94 | 338 | 360 | 0.8 | 637 | 34.4 | 26.2 | 198.0 | 10/12 | ✅ | ✅ |
| WS@1Hz payload=360B + load=25% cWs=25 [rep 1/4] | ws | 0.99 | 357 | 360 | 1.2 | 458 | 33.8 | 26.2 | 203.6 | 9/11 | ✅ | ✅ |
| WS@1Hz payload=360B + load=25% cWs=25 [rep 2/4] | ws | 0.95 | 342 | 360 | 0.6 | 511 | 33.3 | 25.4 | 202.4 | 10/13 | ✅ | ✅ |
| WS@1Hz payload=360B + load=25% cWs=25 [rep 3/4] | ws | 0.97 | 349 | 360 | 0.4 | 530 | 33.9 | 25.9 | 207.8 | 11/13 | ✅ | ✅ |
| WS@1Hz payload=360B + load=25% cWs=25 [rep 4/4] | ws | 1.01 | 363 | 360 | 5.8 | 524 | 32.7 | 28.0 | 208.4 | 8/11 | ✅ | ✅ |
| HTTP@1Hz payload=360B [rep 1/4] | polling | 1.03 | 370 | 360 | 0.5 | 396 | 35.6 | 1.1 | 174.9 | 11/13 | ✅ | ✅ |
| HTTP@1Hz payload=360B [rep 2/4] | polling | 0.98 | 353 | 360 | 2.8 | 642 | 33.0 | 1.5 | 175.0 | 9/11 | ✅ | ✅ |
| HTTP@1Hz payload=360B [rep 3/4] | polling | 0.98 | 353 | 360 | 0.5 | 475 | 34.1 | 1.3 | 175.1 | 11/13 | ✅ | ✅ |
| HTTP@1Hz payload=360B [rep 4/4] | polling | 1.01 | 365 | 360 | 0.8 | 561 | 34.2 | 0.9 | 175.9 | 10/13 | ✅ | ✅ |
| HTTP@1Hz payload=360B cHttp=10 [rep 1/4] | polling | 10.12 | 3643 | 360 | 288.7 | 544 | 36.3 | 1.0 | 179.5 | 9/12 | ✅ | ✅ |
| HTTP@1Hz payload=360B cHttp=10 [rep 2/4] | polling | 9.64 | 3472 | 360 | 287.8 | 392 | 34.1 | 0.8 | 179.6 | 11/13 | ✅ | ✅ |
| HTTP@1Hz payload=360B cHttp=10 [rep 3/4] | polling | 9.90 | 3565 | 360 | 287.1 | 521 | 33.5 | 1.2 | 179.7 | 10/13 | ✅ | ✅ |
| HTTP@1Hz payload=360B cHttp=10 [rep 4/4] | polling | 10.10 | 3635 | 360 | 289.1 | 549 | 34.5 | 1.3 | 179.0 | 10/13 | ✅ | ✅ |
| HTTP@1Hz payload=360B cHttp=25 [rep 1/4] | polling | 25.08 | 9030 | 360 | 190.6 | 270 | 39.2 | 1.2 | 185.9 | 9/11 | ✅ | ✅ |
| HTTP@1Hz payload=360B cHttp=25 [rep 2/4] | polling | 25.19 | 9070 | 360 | 190.2 | 479 | 32.9 | 1.3 | 185.7 | 10/12 | ✅ | ✅ |
| HTTP@1Hz payload=360B cHttp=25 [rep 3/4] | polling | 24.73 | 8904 | 360 | 189.9 | 516 | 34.6 | 1.2 | 185.5 | 10/12 | ✅ | ✅ |
| HTTP@1Hz payload=360B cHttp=25 [rep 4/4] | polling | 25.93 | 9335 | 360 | 189.4 | 497 | 33.9 | 1.2 | 185.7 | 10/12 | ✅ | ✅ |
| HTTP@1Hz payload=360B + load=25% [rep 1/4] | polling | 0.97 | 349 | 360 | 9.1 | 516 | 34.1 | 27.3 | 189.0 | 10/12 | ✅ | ✅ |
| HTTP@1Hz payload=360B + load=25% [rep 2/4] | polling | 0.93 | 337 | 360 | 1.1 | 514 | 33.9 | 27.1 | 189.3 | 9/12 | ✅ | ✅ |
| HTTP@1Hz payload=360B + load=25% [rep 3/4] | polling | 0.99 | 358 | 360 | 2.1 | 434 | 44.5 | 26.8 | 190.7 | 10/14 | ✅ | ✅ |
| HTTP@1Hz payload=360B + load=25% [rep 4/4] | polling | 1.00 | 359 | 360 | 0.8 | 443 | 34.4 | 26.6 | 188.8 | 10/14 | ✅ | ✅ |
| HTTP@1Hz payload=360B + load=25% cHttp=10 [rep 1/4] | polling | 9.83 | 3537 | 360 | 287.6 | 407 | 36.0 | 24.5 | 199.2 | 9/11 | ✅ | ✅ |
| HTTP@1Hz payload=360B + load=25% cHttp=10 [rep 2/4] | polling | 10.03 | 3611 | 360 | 286.2 | 681 | 32.8 | 26.2 | 199.2 | 10/12 | ✅ | ✅ |
| HTTP@1Hz payload=360B + load=25% cHttp=10 [rep 3/4] | polling | 10.30 | 3709 | 360 | 288.4 | 472 | 32.9 | 25.3 | 199.1 | 9/13 | ✅ | ✅ |
| HTTP@1Hz payload=360B + load=25% cHttp=10 [rep 4/4] | polling | 9.78 | 3521 | 360 | 287.2 | 548 | 34.2 | 26.7 | 199.1 | 10/12 | ✅ | ✅ |
| HTTP@1Hz payload=360B + load=25% cHttp=25 [rep 1/4] | polling | 25.02 | 9005 | 360 | 192.1 | 579 | 33.5 | 24.6 | 209.0 | 9/12 | ✅ | ✅ |
| HTTP@1Hz payload=360B + load=25% cHttp=25 [rep 2/4] | polling | 24.79 | 8925 | 360 | 188.5 | 493 | 35.2 | 26.4 | 208.1 | 11/13 | ✅ | ✅ |
| HTTP@1Hz payload=360B + load=25% cHttp=25 [rep 3/4] | polling | 26.04 | 9374 | 360 | 190.3 | 398 | 33.1 | 27.1 | 207.8 | 11/13 | ✅ | ✅ |
| HTTP@1Hz payload=360B + load=25% cHttp=25 [rep 4/4] | polling | 25.02 | 9008 | 360 | 189.3 | 483 | 32.0 | 25.0 | 207.5 | 10/12 | ✅ | ✅ |



Parametry przyjęte w ostatnim runie:
- Metody: ws, polling
- Częstotliwości [Hz]: 1
- Obciążenia CPU [%]: 0, 25
- Czas sesji [s]: 20
- MONITOR_TICK_MS: 200
- Payloady: WS=360B, HTTP=360B
- Klienci: clientsHttp=25, clientsWs=25
- Warmup/Cooldown [s]: 2 / 2
- Repeats: 4




## Uśrednione wyniki wg obciążenia

Uwaga: "Obciążenie" oznacza sztuczne obciążenie CPU procesu podczas sesji (generator w worker_threads).

### Porównanie wg obciążenia — WebSocket

| Obciążenie | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | ELU p99 [ms] | CPU [%] | RSS [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0% | 1.03 | 372 | 360 | 1.8 | 34.9 | 1.6 | 184.3 |
| 25% | 0.99 | 355 | 360 | 1.3 | 33.4 | 26.1 | 196.2 |

### Porównanie wg obciążenia — HTTP polling

| Obciążenie | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | ELU p99 [ms] | CPU [%] | RSS [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0% | 12.06 | 4341 | 360 | 159.8 | 34.7 | 1.2 | 180.1 |
| 25% | 12.06 | 4341 | 360 | 160.2 | 34.7 | 26.1 | 198.9 |





## Uśrednione wyniki wg liczby klientów

Uwaga: "Liczba klientów" to liczba równoległych syntetycznych klientów generowanych wewnętrznie na czas sesji (HTTP: liczbę timerów; WS: efektywną sumaryczną częstość).

### Zestawienie wg liczby klientów — WebSocket

| Klienci | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | ELU p99 [ms] | CPU [%] | RSS [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 0.99 | 358 | 360 | 1.6 | 33.8 | 13.8 | 183.2 |
| 10 | 1.02 | 367 | 360 | 1.3 | 34.3 | 13.5 | 190.5 |
| 25 | 1.02 | 366 | 360 | 1.8 | 34.4 | 14.1 | 197.0 |

### Zestawienie wg liczby klientów — HTTP polling

| Klienci | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | ELU p99 [ms] | CPU [%] | RSS [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0.99 | 355 | 360 | 2.2 | 35.5 | 14.1 | 182.3 |
| 10 | 9.96 | 3587 | 360 | 287.8 | 34.3 | 13.4 | 189.3 |
| 25 | 25.23 | 9081 | 360 | 190.0 | 34.3 | 13.5 | 196.9 |





## Metrologia (95% CI) — ostatni run

Niepewność średnich estymowana z próbek (tick ~ 200 ms).

| Label | n (used/total) | Rate [/s] | CI95 Rate | CI95/avg | σ(rate) | Median Rate | Bytes/s | CI95 Bytes | CI95/avg | σ(bytes) | Median Bytes |
|---|:--:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| WS@1Hz payload=360B | 11/12 | 1.10 | ± 0.51 | 46% | 4.11 | 0.93 | 395 | ± 182 | 46% | 1481 | 335 |
| WS@1Hz payload=360B | 9/11 | 1.00 | ± 0.49 | 49% | 0.25 | 1.07 | 360 | ± 177 | 49% | 89 | 387 |
| WS@1Hz payload=360B | 11/13 | 0.97 | ± 0.46 | 48% | 0.34 | 1.00 | 349 | ± 166 | 48% | 124 | 360 |
| WS@1Hz payload=360B | 11/13 | 0.97 | ± 0.47 | 49% | 0.34 | 0.69 | 349 | ± 171 | 49% | 124 | 250 |
| WS@1Hz payload=360B cWs=10 | 9/11 | 1.15 | ± 0.55 | 48% | 4.59 | 1.19 | 414 | ± 197 | 48% | 1652 | 430 |
| WS@1Hz payload=360B cWs=10 | 10/13 | 0.98 | ± 0.48 | 49% | 0.31 | 1.00 | 353 | ± 173 | 49% | 113 | 360 |
| WS@1Hz payload=360B cWs=10 | 10/14 | 1.00 | ± 0.51 | 51% | 0.36 | 0.97 | 361 | ± 183 | 51% | 128 | 351 |
| WS@1Hz payload=360B cWs=10 | 10/13 | 1.04 | ± 0.51 | 49% | 0.36 | 1.18 | 375 | ± 184 | 49% | 129 | 426 |
| WS@1Hz payload=360B cWs=25 | 8/9 | 1.12 | ± 0.53 | 48% | 6.27 | 1.06 | 405 | ± 192 | 48% | 2256 | 381 |
| WS@1Hz payload=360B cWs=25 | 10/12 | 1.00 | ± 0.49 | 49% | 0.30 | 1.17 | 361 | ± 177 | 49% | 109 | 421 |
| WS@1Hz payload=360B cWs=25 | 10/13 | 1.02 | ± 0.50 | 49% | 0.34 | 1.23 | 366 | ± 179 | 49% | 124 | 442 |
| WS@1Hz payload=360B cWs=25 | 9/12 | 1.06 | ± 0.54 | 51% | 0.35 | 1.25 | 383 | ± 194 | 51% | 125 | 451 |
| WS@1Hz payload=360B + load=25% | 11/13 | 0.95 | ± 0.46 | 49% | 0.35 | 0.72 | 341 | ± 167 | 49% | 127 | 258 |
| WS@1Hz payload=360B + load=25% | 9/12 | 0.99 | ± 0.49 | 49% | 0.26 | 1.08 | 358 | ± 175 | 49% | 93 | 390 |
| WS@1Hz payload=360B + load=25% | 10/13 | 1.03 | ± 0.51 | 49% | 0.39 | 1.24 | 372 | ± 182 | 49% | 139 | 447 |
| WS@1Hz payload=360B + load=25% | 11/13 | 0.94 | ± 0.46 | 49% | 0.35 | 0.70 | 337 | ± 165 | 49% | 125 | 252 |
| WS@1Hz payload=360B + load=25% cWs=10 | 9/11 | 1.04 | ± 0.50 | 48% | 0.21 | 1.12 | 375 | ± 178 | 48% | 76 | 404 |
| WS@1Hz payload=360B + load=25% cWs=10 | 10/13 | 0.97 | ± 0.48 | 49% | 0.33 | 1.10 | 350 | ± 171 | 49% | 120 | 395 |
| WS@1Hz payload=360B + load=25% cWs=10 | 10/13 | 1.03 | ± 0.51 | 49% | 0.35 | 1.23 | 372 | ± 182 | 49% | 127 | 442 |
| WS@1Hz payload=360B + load=25% cWs=10 | 10/12 | 0.94 | ± 0.48 | 51% | 0.32 | 0.91 | 338 | ± 171 | 51% | 114 | 329 |
| WS@1Hz payload=360B + load=25% cWs=25 | 9/11 | 0.99 | ± 0.49 | 49% | 0.25 | 1.05 | 357 | ± 175 | 49% | 88 | 377 |
| WS@1Hz payload=360B + load=25% cWs=25 | 10/13 | 0.95 | ± 0.48 | 51% | 0.34 | 0.92 | 342 | ± 173 | 51% | 123 | 332 |
| WS@1Hz payload=360B + load=25% cWs=25 | 11/13 | 0.97 | ± 0.46 | 48% | 0.32 | 1.16 | 349 | ± 166 | 48% | 116 | 418 |
| WS@1Hz payload=360B + load=25% cWs=25 | 8/11 | 1.01 | ± 0.49 | 49% | 0.70 | 1.04 | 363 | ± 178 | 49% | 252 | 373 |
| HTTP@1Hz payload=360B | 11/13 | 1.03 | ± 0.49 | 48% | 0.36 | 1.22 | 370 | ± 176 | 48% | 131 | 438 |
| HTTP@1Hz payload=360B | 9/11 | 0.98 | ± 0.48 | 49% | 0.26 | 1.05 | 353 | ± 173 | 49% | 94 | 377 |
| HTTP@1Hz payload=360B | 11/13 | 0.98 | ± 0.47 | 48% | 0.31 | 1.11 | 353 | ± 168 | 48% | 112 | 400 |
| HTTP@1Hz payload=360B | 10/13 | 1.01 | ± 0.50 | 49% | 0.33 | 1.15 | 365 | ± 179 | 49% | 118 | 415 |
| HTTP@1Hz payload=360B cHttp=10 | 9/12 | 10.12 | ± 2.09 | 21% | 3.20 | 10.57 | 3643 | ± 752 | 21% | 1151 | 3807 |
| HTTP@1Hz payload=360B cHttp=10 | 11/13 | 9.64 | ± 1.91 | 20% | 3.24 | 10.15 | 3472 | ± 688 | 20% | 1165 | 3654 |
| HTTP@1Hz payload=360B cHttp=10 | 10/13 | 9.90 | ± 2.23 | 23% | 3.60 | 9.44 | 3565 | ± 804 | 23% | 1297 | 3399 |
| HTTP@1Hz payload=360B cHttp=10 | 10/13 | 10.10 | ± 1.99 | 20% | 3.22 | 12.00 | 3635 | ± 718 | 20% | 1158 | 4319 |
| HTTP@1Hz payload=360B cHttp=25 | 9/11 | 25.08 | ± 3.28 | 13% | 5.03 | 26.44 | 9030 | ± 1182 | 13% | 1810 | 9520 |
| HTTP@1Hz payload=360B cHttp=25 | 10/12 | 25.19 | ± 5.03 | 20% | 8.12 | 29.75 | 9070 | ± 1812 | 20% | 2924 | 10711 |
| HTTP@1Hz payload=360B cHttp=25 | 10/12 | 24.73 | ± 4.84 | 20% | 7.80 | 29.44 | 8904 | ± 1741 | 20% | 2809 | 10600 |
| HTTP@1Hz payload=360B cHttp=25 | 10/12 | 25.93 | ± 4.78 | 18% | 7.71 | 28.71 | 9335 | ± 1720 | 18% | 2776 | 10337 |
| HTTP@1Hz payload=360B + load=25% | 10/12 | 0.97 | ± 0.49 | 51% | 0.34 | 0.91 | 349 | ± 177 | 51% | 123 | 329 |
| HTTP@1Hz payload=360B + load=25% | 9/12 | 0.93 | ± 0.47 | 51% | 0.34 | 1.21 | 337 | ± 170 | 51% | 121 | 434 |
| HTTP@1Hz payload=360B + load=25% | 10/14 | 0.99 | ± 0.50 | 51% | 0.35 | 1.00 | 358 | ± 181 | 51% | 127 | 361 |
| HTTP@1Hz payload=360B + load=25% | 10/14 | 1.00 | ± 0.50 | 51% | 0.36 | 0.96 | 359 | ± 182 | 51% | 128 | 347 |
| HTTP@1Hz payload=360B + load=25% cHttp=10 | 9/11 | 9.83 | ± 1.30 | 13% | 1.99 | 9.84 | 3537 | ± 468 | 13% | 717 | 3544 |
| HTTP@1Hz payload=360B + load=25% cHttp=10 | 10/12 | 10.03 | ± 1.75 | 17% | 2.83 | 10.79 | 3611 | ± 631 | 17% | 1018 | 3885 |
| HTTP@1Hz payload=360B + load=25% cHttp=10 | 9/13 | 10.30 | ± 2.19 | 21% | 3.35 | 12.17 | 3709 | ± 787 | 21% | 1204 | 4382 |
| HTTP@1Hz payload=360B + load=25% cHttp=10 | 10/12 | 9.78 | ± 1.98 | 20% | 3.19 | 10.94 | 3521 | ± 711 | 20% | 1147 | 3938 |
| HTTP@1Hz payload=360B + load=25% cHttp=25 | 9/12 | 25.02 | ± 5.21 | 21% | 7.97 | 28.55 | 9005 | ± 1875 | 21% | 2870 | 10277 |
| HTTP@1Hz payload=360B + load=25% cHttp=25 | 11/13 | 24.79 | ± 5.37 | 22% | 9.09 | 30.14 | 8925 | ± 1934 | 22% | 3272 | 10851 |
| HTTP@1Hz payload=360B + load=25% cHttp=25 | 11/13 | 26.04 | ± 5.08 | 20% | 8.59 | 30.44 | 9374 | ± 1828 | 20% | 3094 | 10957 |
| HTTP@1Hz payload=360B + load=25% cHttp=25 | 10/12 | 25.02 | ± 5.15 | 21% | 8.31 | 27.38 | 9008 | ± 1855 | 21% | 2992 | 9857 |



### Metrologia — jak czytać i co oznaczają wyniki

- n (used/total): liczba próbek wykorzystanych w średnich po trimowaniu vs. całkowita. Zalecane n(used) ≥ 10.
- Rate [/s] i CI95 Rate: średnia częstość i 95% przedział ufności (mniejszy CI → stabilniejsze wyniki).
  - Praktyczne kryterium: CI95/średnia < 30% uznajemy za stabilne dla krótkich przebiegów.
- CI95/avg: względna szerokość przedziału ufności (niższy lepszy).
- σ(rate): odchylenie standardowe — informuje o zmienności częstości między próbkami.
- Median Rate/Bytes: mediana — odporna na wartości odstające.
- Bytes/s i CI95 Bytes: przepływność i jej niepewność. Dla stałego payloadu oczekujemy Bytes/s ≈ Rate × Payload.
- Tick [ms]: okres próbkowania monitoringu (`MONITOR_TICK_MS`). Domyślnie 1000 ms w aplikacji; w badaniach zwykle 200–250 ms.
- Wpływ warmup/cooldown: odcięcie początkowych/końcowych odcinków stabilizuje średnie i zwęża CI.
- Minimalne kryteria wiarygodności (propozycja):
  - n(used) ≥ 10, CI95/średnia (Rate) < 30%, CI95/średnia (Bytes/s) < 30%.
  - Relacja Bytes≈Rate×Payload: błąd względny < 30% dla przebiegów kontrolowanych.




## Wnioski (syntetyczne)

- WS@1Hz payload=360B [rep 1/4]: rate=1.10 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s) [N/A w porównaniach]
- WS@1Hz payload=360B [rep 2/4]: rate=1.00 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s) [N/A w porównaniach]
- WS@1Hz payload=360B [rep 3/4]: rate=0.97 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s) [N/A w porównaniach]
- WS@1Hz payload=360B [rep 4/4]: rate=0.97 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s) [N/A w porównaniach]
- WS@1Hz payload=360B cWs=10 [rep 1/4]: rate=1.15 in [0.50, 1.50] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B cWs=10 [rep 2/4]: rate=0.98 in [0.50, 1.50] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B cWs=10 [rep 3/4]: rate=1.00 in [0.50, 1.50] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B cWs=10 [rep 4/4]: rate=1.04 in [0.50, 1.50] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B cWs=25 [rep 1/4]: rate=1.12 in [0.50, 1.50] (c=25); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B cWs=25 [rep 2/4]: rate=1.00 in [0.50, 1.50] (c=25); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B cWs=25 [rep 3/4]: rate=1.02 in [0.50, 1.50] (c=25); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B cWs=25 [rep 4/4]: rate=1.06 in [0.50, 1.50] (c=25); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B + load=25% [rep 1/4]: rate=0.95 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s) [N/A w porównaniach]
- WS@1Hz payload=360B + load=25% [rep 2/4]: rate=0.99 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s) [N/A w porównaniach]
- WS@1Hz payload=360B + load=25% [rep 3/4]: rate=1.03 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s) [N/A w porównaniach]
- WS@1Hz payload=360B + load=25% [rep 4/4]: rate=0.94 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s) [N/A w porównaniach]
- WS@1Hz payload=360B + load=25% cWs=10 [rep 1/4]: rate=1.04 in [0.50, 1.50] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B + load=25% cWs=10 [rep 2/4]: rate=0.97 in [0.50, 1.50] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B + load=25% cWs=10 [rep 3/4]: rate=1.03 in [0.50, 1.50] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B + load=25% cWs=10 [rep 4/4]: rate=0.94 in [0.50, 1.50] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B + load=25% cWs=25 [rep 1/4]: rate=0.99 in [0.50, 1.50] (c=25); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B + load=25% cWs=25 [rep 2/4]: rate=0.95 in [0.50, 1.50] (c=25); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B + load=25% cWs=25 [rep 3/4]: rate=0.97 in [0.50, 1.50] (c=25); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B + load=25% cWs=25 [rep 4/4]: rate=1.01 in [0.50, 1.50] (c=25); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B [rep 1/4]: rate=1.03 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B [rep 2/4]: rate=0.98 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B [rep 3/4]: rate=0.98 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B [rep 4/4]: rate=1.01 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B cHttp=10 [rep 1/4]: rate=10.12 in [5.00, 15.00] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B cHttp=10 [rep 2/4]: rate=9.64 in [5.00, 15.00] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B cHttp=10 [rep 3/4]: rate=9.90 in [5.00, 15.00] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B cHttp=10 [rep 4/4]: rate=10.10 in [5.00, 15.00] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B cHttp=25 [rep 1/4]: rate=25.08 in [12.50, 37.50] (c=25); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B cHttp=25 [rep 2/4]: rate=25.19 in [12.50, 37.50] (c=25); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B cHttp=25 [rep 3/4]: rate=24.73 in [12.50, 37.50] (c=25); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B cHttp=25 [rep 4/4]: rate=25.93 in [12.50, 37.50] (c=25); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B + load=25% [rep 1/4]: rate=0.97 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B + load=25% [rep 2/4]: rate=0.93 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B + load=25% [rep 3/4]: rate=0.99 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B + load=25% [rep 4/4]: rate=1.00 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B + load=25% cHttp=10 [rep 1/4]: rate=9.83 in [5.00, 15.00] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B + load=25% cHttp=10 [rep 2/4]: rate=10.03 in [5.00, 15.00] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B + load=25% cHttp=10 [rep 3/4]: rate=10.30 in [5.00, 15.00] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B + load=25% cHttp=10 [rep 4/4]: rate=9.78 in [5.00, 15.00] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B + load=25% cHttp=25 [rep 1/4]: rate=25.02 in [12.50, 37.50] (c=25); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B + load=25% cHttp=25 [rep 2/4]: rate=24.79 in [12.50, 37.50] (c=25); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B + load=25% cHttp=25 [rep 3/4]: rate=26.04 in [12.50, 37.50] (c=25); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B + load=25% cHttp=25 [rep 4/4]: rate=25.02 in [12.50, 37.50] (c=25); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)


## Walidacja wiarygodności i poprawności

Brak pliku validation.txt dla ostatniego runu.

- Rate OK: 100% (48/48)
- Payload OK: 100% (48/48)
- Minimalna liczba próbek n(used): 8
- Średni względny CI95: Rate ≈ 39%, Bytes/s ≈ 39%

Uwaga: FAIL wynika głównie z odchyleń Rate od oczekiwanych Hz. To spodziewane, jeśli źródło danych (Arduino/MQTT) publikuje ~1 Hz niezależnie od ustawień nominalnych. Payload przechodzi (OK) we wszystkich scenariuszach.



## Zwycięzcy (per scenariusz)

Dla każdej kombinacji Hz/obciążenia/liczby klientów wskazano najlepszą metodę w kluczowych kategoriach.

### Zwycięzcy — Hz=1|Load=0|Clients=10
- Częstość [#/s]: POLLING (HTTP@1Hz payload=360B cHttp=10) (≈ 10.12)
- Jitter [ms]: WS (WS@1Hz payload=360B cWs=10) (≈ 0.6)
- Staleness [ms]: WS (WS@1Hz payload=360B cWs=10) (≈ 304.3)
- CPU [%]: POLLING (HTTP@1Hz payload=360B cHttp=10) (≈ 0.8)
- RSS [MB]: WS (WS@1Hz payload=360B cWs=10) (≈ 178.8)

### Zwycięzcy — Hz=1|Load=0|Clients=25
- Częstość [#/s]: POLLING (HTTP@1Hz payload=360B cHttp=25) (≈ 25.93)
- Jitter [ms]: WS (WS@1Hz payload=360B cWs=25) (≈ 0.5)
- Staleness [ms]: POLLING (HTTP@1Hz payload=360B cHttp=25) (≈ 269.9)
- CPU [%]: POLLING (HTTP@1Hz payload=360B cHttp=25) (≈ 1.2)
- RSS [MB]: WS (WS@1Hz payload=360B cWs=25) (≈ 179.9)

### Zwycięzcy — Hz=1|Load=25|Clients=10
- Częstość [#/s]: POLLING (HTTP@1Hz payload=360B + load=25% cHttp=10) (≈ 10.30)
- Jitter [ms]: WS (WS@1Hz payload=360B + load=25% cWs=10) (≈ 0.5)
- Staleness [ms]: POLLING (HTTP@1Hz payload=360B + load=25% cHttp=10) (≈ 406.9)
- CPU [%]: WS (WS@1Hz payload=360B + load=25% cWs=10) (≈ 24.1)
- RSS [MB]: WS (WS@1Hz payload=360B + load=25% cWs=10) (≈ 191.9)

### Zwycięzcy — Hz=1|Load=25|Clients=25
- Częstość [#/s]: POLLING (HTTP@1Hz payload=360B + load=25% cHttp=25) (≈ 26.04)
- Jitter [ms]: WS (WS@1Hz payload=360B + load=25% cWs=25) (≈ 0.4)
- Staleness [ms]: POLLING (HTTP@1Hz payload=360B + load=25% cHttp=25) (≈ 398.1)
- CPU [%]: POLLING (HTTP@1Hz payload=360B + load=25% cHttp=25) (≈ 24.6)
- RSS [MB]: WS (WS@1Hz payload=360B + load=25% cWs=25) (≈ 202.4)

### Zwycięzcy — Hz=1|Load=0|Clients=1
- Częstość [#/s]: POLLING (HTTP@1Hz payload=360B) (≈ 1.03)
- Jitter [ms]: POLLING (HTTP@1Hz payload=360B) (≈ 0.5)
- Staleness [ms]: POLLING (HTTP@1Hz payload=360B) (≈ 395.5)
- CPU [%]: POLLING (HTTP@1Hz payload=360B) (≈ 0.9)
- RSS [MB]: POLLING (HTTP@1Hz payload=360B) (≈ 174.9)

### Zwycięzcy — Hz=1|Load=25|Clients=1
- Częstość [#/s]: POLLING (HTTP@1Hz payload=360B + load=25%) (≈ 1.00)
- Jitter [ms]: POLLING (HTTP@1Hz payload=360B + load=25%) (≈ 0.8)
- Staleness [ms]: POLLING (HTTP@1Hz payload=360B + load=25%) (≈ 433.7)
- CPU [%]: POLLING (HTTP@1Hz payload=360B + load=25%) (≈ 26.6)
- RSS [MB]: POLLING (HTTP@1Hz payload=360B + load=25%) (≈ 188.8)

### Podsumowanie globalne (średnio)
- Rate: WS 1.02 /s vs HTTP 12.06 /s
- Jitter: WS 1.5 ms vs HTTP 160.0 ms (niżej lepiej)
- Staleness: WS 509 ms vs HTTP 492 ms (niżej lepiej)
- CPU: WS 13.8% vs HTTP 13.7% (niżej lepiej)
- RSS: WS 193.8 MB vs HTTP 189.5 MB (niżej lepiej)



## Wnioski — wizualne porównanie


### Wnioski — porównanie WS vs HTTP wg obciążenia


| Obciążenie [%] | Rate WS [/s] | Rate HTTP [/s] | Jitter WS [ms] | Jitter HTTP [ms] | Staleness WS [ms] | Staleness HTTP [ms] | ELU p99 WS [ms] | ELU p99 HTTP [ms] | CPU WS [%] | CPU HTTP [%] | RSS WS [MB] | RSS HTTP [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 1.03 | **12.06** | **1.8** | 159.8 | 491 | **487** | 34.9 | **34.7** | 1.6 | **1.2** | 184.3 | **180.1** |
| 25 | 0.99 | **12.06** | **1.3** | 160.2 | 507 | **497** | **33.4** | 34.7 | **26.1** | 26.1 | **196.2** | 198.9 |


### Wnioski — porównanie WS vs HTTP wg liczby klientów


| Klienci | Rate WS [/s] | Rate HTTP [/s] | Jitter WS [ms] | Jitter HTTP [ms] | Staleness WS [ms] | Staleness HTTP [ms] | ELU p99 WS [ms] | ELU p99 HTTP [ms] | CPU WS [%] | CPU HTTP [%] | RSS WS [MB] | RSS HTTP [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 1.02 | **9.96** | **1.3** | 287.8 | **499** | 514 | 34.3 | **34.3** | 13.5 | **13.4** | 190.5 | **189.3** |
| 25 | 1.02 | **25.23** | **1.8** | 190.0 | 519 | **464** | 34.4 | **34.3** | 14.1 | **13.5** | 197.0 | **196.9** |


### Wnioski — krótkie podsumowanie (WS vs HTTP)

- Średnio (ten run): Rate — WS 1.02 /s vs HTTP 12.06 /s
- Średnio: Jitter — WS 1.5 ms vs HTTP 160.0 ms (niżej = stabilniej)
- Średnio: Staleness — WS 509 ms vs HTTP 492 ms (niżej = świeżej)
- Średnio: CPU — WS 13.8% vs HTTP 13.7% (niżej = lżej)


<!-- AUTO-RESULTS:END -->

## 13. Status pokrycia scenariuszy (S1–S6)

Mapowanie do sekcji „8.2 Scenariusze eksperymentalne” z architectural-overview:

- S1 (WS – 1 klient): realizowane przez measurementRunner (WS@1Hz/2Hz) – Pokryte.
- S2 (WS – N klientów): realizowane przez measurementRunner (parametr clientsWs) – Pokryte.
- S3 (Polling – 1 klient): realizowane przez measurementRunner (HTTP@1Hz/2Hz) – Pokryte.
- S4 (Polling – N klientów): realizowane przez measurementRunner (parametr clientsHttp) – Pokryte.
- S5 (Polling 250 ms): runner wspiera zmianę interwału, domyślnie nie uruchamia 250 ms; dostępne po ustawieniu interwału (flagi) – Możliwe (Wymaga flag).
- S6 (Mix WS/Polling): brak mieszanej generacji obciążenia w jednym przebiegu – Do zrobienia.

Wniosek: obecny proces testów i pomiarów pokrywa przypadki S1–S4. Scenariusz high-frequency (S5) jest dostępny parametrycznie. Mieszany (S6) wymaga rozszerzenia runnera lub skryptów z sekcji 12.

---

Uwagi metodologiczne dot. prezentacji wyników:

- Wszystkie wartości prezentowane na dashboardzie i w tabelach są formatowane do dwóch miejsc po przecinku dla spójności wizualnej. Nie implikuje to rzeczywistej rozdzielczości pomiaru.
- Tam, gdzie to istotne, jednostki są pokazywane wprost (ms, B, B/s, %). Dla dużych liczb stosowane są separatory tysięcy zgodne z lokalizacją (PL).

## 14. Słownik pojęć i tłumaczenia (co jest czym)

- Rate [/s] — częstość zdarzeń na sekundę; dla WS: wiadomości/s, dla HTTP: żądania/s.
- Bytes/s — przepływność (ile bajtów na sekundę przesyłamy łącznie).
- ~Payload [B] — średni rozmiar ładunku pojedynczej wiadomości/odpowiedzi (B/zdarzenie).
- Bytes/jednostkę — stosunek Bytes/s do Rate; koszt bajtowy per zdarzenie (mniej = lepiej).
- CPU [%] — średnie obciążenie procesu Node.js (nie całego systemu) w procentach.
- RSS [MB] — pamięć robocza procesu (Resident Set Size).
- ELU p99 [ms] — 99. percentyl opóźnień pętli zdarzeń (większe piki wskazują blokady/GC/I/O).
- Jitter [ms] — zmienność odstępów między kolejnymi zdarzeniami (odchylenie standardowe; niższe = stabilniej).
- Staleness [ms] (wiek danych) — czas od ostatniego odczytu danych z urządzenia do chwili pomiaru (niżej = świeższe dane na UI/API).
- Tick [ms] — okres próbkowania monitoringu (`MONITOR_TICK_MS`). Domyślnie 1000 ms w aplikacji; w badaniach zwykle 200–250 ms.
- n (used/total) — liczba próbek wykorzystanych po trimowaniu warmup/cooldown względem całkowitej liczby próbek sesji.
- Warmup/Cooldown [s] — okna czasowe na początku/końcu sesji wyłączane z agregacji (stabilizacja wyników).
- Obciążenie CPU (loadCpuPct, loadWorkers) — sztuczne obciążenie tła: docelowy udział CPU oraz liczba wątków generatora.
- Klienci (clientsHttp, clientsWs) — liczba syntetycznych klientów HTTP/WS uruchamianych wewnętrznie na czas sesji.

## 15. Jak czytać „Wnioski” i uśrednione wyniki

- Wiersze w „Wnioski (syntetyczne)” odnoszą się do testów z tabeli — zawierają autowalidację względem oczekiwanej częstości i ładunku (±50%).
- Jeśli trimowanie było aktywne, w nawiasie pokazujemy warmup/cooldown — to próbki pominięte przy liczeniu średnich.
- W sekcjach „Zestawienie wg obciążenia” oraz „wg liczby klientów” wartości są uśredniane per kategoria, co pozwala szybko ocenić skalowanie metod.
- Dla oceny wiarygodności średnich korzystaj z „Metrologia (95% CI)” — im węższy przedział ufności i większe n (used), tym stabilniejsze wyniki.

## 16. Jak uruchomić badania (jedna komenda)

- Podstawowa komenda (zalecana, pełna macierz): w katalogu `api` uruchom: `npm run research:full`
  - Alias do kompletnej orkiestracji (WS/HTTP; Hz: 0.5, 1, 2, 5; obciążenia: 0,25,50; klienci: 0,10,25,50; tick: 200 ms).
  - Po zakończeniu wyniki trafią do `api/benchmarks/<timestamp>/`, sekcja AUTO-RESULTS zaktualizuje się automatycznie oraz powstanie raport zbiorczy `docs/WYNIKI_ZBIORCZE.md` (agregacja wszystkich dotychczasowych runów).

Opcjonalne skróty:

- `npm run research:quick` — szybki przebieg (krótki, bez pełnej macierzy) + walidacja auto.
- `npm run research:safe` — tryb bezpieczny: Hz ≤ 1 (0.5,1), bez obciążeń i klientów; tick=500 ms + walidacja auto.
- `npm run research:sanity` — szybki i stabilny sanity @1 Hz (12 s, tick=200 ms; z wyłączonym pidusage), następnie auto‑update i walidacja.
- `npm run research:robust` — ustandaryzowany, solidny przebieg (Hz: 0.5,1,2; Load: 0,25,50; 30 s; warmup/cooldown 2 s; 2 powtórzenia; tick=200 ms) + walidacja w trybie auto (źródło‑limitowane → WARN, nie FAIL).
- `npm run research:matrix` — pełna macierz przez `tools/orchestrate-benchmarks.ps1` (rozszerza o klientów, wyższe Hz, warianty tick itp.).

Zbiorczy raport ze wszystkich uruchomień:

- `npm run research:aggregate` — generuje/aktualizuje `api/benchmarks/combined.csv` oraz `docs/WYNIKI_ZBIORCZE.md`.

Szybkie otwarcie raportów:

- `npm run research:open` — otwiera `docs/ASPEKT_BADAWCZY.md`
- `npm run research:results` — otwiera `docs/WYNIKI_ZBIORCZE.md`

Uwaga dot. zakresu częstotliwości:

- Źródło danych (Arduino) publikuje typowo co ~1 s. Testy z Hz > 1 nie zwiększają realnej świeżości danych, lecz obciążają transport i serwer (sensowne do oceny narzutu, nie „świeżości”).
- W praktyce warto raportować oddzielnie scenariusze „do 1 Hz” (źródło-limitowane, data-limited) i „> 1 Hz” (transport-limited). W tabelach pomocna jest metryka Staleness [ms] — jeśli utrzymuje się ~1000 ms mimo 2–5 Hz, to potwierdza ograniczenie źródła.

Bezpieczeństwo termiczne (tryb SAFE):

- Gdy CPU/obudowa nagrzewa się nadmiernie, użyj `npm run research:safe`.
- Ogranicza macierz do 0.5–1 Hz, bez obciążeń i klientów, skraca czas i zwiększa tick do 500 ms, znacząco redukując pobór CPU.
- Zachowuje tę samą strukturę wyników i automatyczne uzupełnianie sekcji AUTO-RESULTS.

Po wykonaniu dowolnej z komend, sekcje „Zestawienie wg obciążenia” i „Zestawienie wg liczby klientów” będą odzwierciedlać uśrednione wyniki.

### 16b. Konfiguracja parametrów (metody, payload, CPU, klienci, nowe flagi)

Elastyczna konfiguracja jest dostępna bezpośrednio w runnerze i orkiestratorze. Najważniejsze opcje (przyjazne dla PowerShell):

- Metody: `--modes ws,polling`
- Częstotliwości: `--hz 0.5,1,2`
- Obciążenia CPU: `--load 0,25,50`
- Czas sesji: `--dur 20`
- Tick monitora: `--tick 200`
- Klienci: `--clientsHttp 0,10,25` i/lub `--clientsWs 0,10,25`
- Payload: wspólny `--payload 360` lub rozdzielnie `--payloadWs 512`, `--payloadHttp 360`
- Trimming: `--warmup 2 --cooldown 2`
- Powtórzenia: `--repeats 2`
- Parowanie scenariuszy: `--pair`
- Overhead CPU samplera: `--disablePidusage` lub `--cpuSampleMs 1000`

Przykłady:

```powershell
# Pojedynczy run, 60 s, @1 Hz, WS=512 B, HTTP=360 B, 2 powtórzenia
npm run -s measure -- --modes ws,polling --hz 1 --dur 60 --tick 200 --payloadWs 512 --payloadHttp 360 --repeats 2 --cpuSampleMs 1000

# Macierz klientów z parowaniem (fair), 60 s @1 Hz
pwsh -NoProfile -File .\tools\orchestrate-benchmarks.ps1 -Hz "1" -Load "0" -DurationSet "60" -TickSet "200" -ClientsHttpSet "0,10,25,50" -ClientsWsSet "0,10,25,50" -Repeats 2 -PairClients -Payload 360 -CpuSampleMs 1000
```
