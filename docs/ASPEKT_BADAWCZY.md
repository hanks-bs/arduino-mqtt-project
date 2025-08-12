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

<!-- AUTO-RESULTS:BEGIN -->

Ostatni run: 2025-08-12T13-12-51-098Z

Status: fair payload: TAK, source-limited: TAK, czas: 60s, tick: 200 ms, repeats: 2

Pliki: [sessions.csv](../api/benchmarks/2025-08-12T13-12-51-098Z/sessions.csv), [summary.json](../api/benchmarks/2025-08-12T13-12-51-098Z/summary.json), [README](../api/benchmarks/2025-08-12T13-12-51-098Z/README.md)

Uwaga: tabele uporządkowane wg: Mode (WS, HTTP) → Hz → Obciążenie → Klienci.

Uwaga: Etykiety @Hz odnoszą się do tempa transportu, ale run ograniczony przez źródło; różnice WS vs HTTP w Rate nie są miarodajne.

| Label | Mode | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | Staleness [ms] | ELU p99 [ms] | CPU [%] | RSS [MB] | n (used/total) | Rate OK | Payload OK |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--:|:--:|:--:|
| WS@0.5Hz payload=360B | ws | 0.03 | 9 | 360 | 53.9 | 1003 | 182.2 | 1.1 | 182.1 | 225/249 | ❌ | ✅ |
| WS@0.5Hz payload=360B | ws | 0.02 | 8 | 360 | 100.7 | 1048 | 375.3 | 0.7 | 176.7 | 235/272 | ❌ | ✅ |
| WS@0.5Hz payload=360B + load=25% | ws | 0.02 | 8 | 360 | 203.9 | 1011 | 574.8 | 3.6 | 200.7 | 205/228 | ❌ | ✅ |
| WS@0.5Hz payload=360B + load=25% | ws | 0.02 | 7 | 360 | 163.2 | 1065 | 581.3 | 2.7 | 200.4 | 194/215 | ❌ | ✅ |
| WS@0.5Hz payload=360B + load=50% | ws | 0.02 | 6 | 360 | 169.4 | 1108 | 569.3 | 3.5 | 192.5 | 183/213 | ❌ | ✅ |
| WS@0.5Hz payload=360B + load=50% | ws | 0.02 | 7 | 360 | 203.6 | 1134 | 639.6 | 5.0 | 193.9 | 184/212 | ❌ | ✅ |
| WS@1Hz payload=360B | ws | 0.04 | 13 | 360 | 118.4 | 580 | 423.2 | 0.5 | 181.6 | 227/261 | ❌ | ✅ |
| WS@1Hz payload=360B | ws | 0.04 | 15 | 360 | 59.6 | 564 | 311.5 | 0.9 | 184.3 | 223/258 | ❌ | ✅ |
| WS@1Hz payload=360B + load=25% | ws | 0.04 | 13 | 360 | 188.1 | 641 | 555.7 | 3.9 | 200.4 | 194/224 | ❌ | ✅ |
| WS@1Hz payload=360B + load=25% | ws | 0.04 | 14 | 360 | 231.5 | 575 | 548.7 | 3.2 | 200.7 | 189/222 | ❌ | ✅ |
| WS@1Hz payload=360B + load=50% | ws | 0.03 | 12 | 360 | 424.5 | 640 | 911.2 | 7.1 | 198.5 | 167/193 | ❌ | ✅ |
| WS@1Hz payload=360B + load=50% | ws | 0.03 | 12 | 360 | 209.5 | 628 | 734.2 | 8.2 | 199.9 | 174/212 | ❌ | ✅ |
| WS@2Hz payload=360B | ws | 0.07 | 27 | 360 | 109.2 | 342 | 381.1 | 0.7 | 187.4 | 219/249 | ❌ | ✅ |
| WS@2Hz payload=360B | ws | 0.07 | 26 | 360 | 175.7 | 335 | 539.2 | 1.0 | 186.9 | 205/239 | ❌ | ✅ |
| WS@2Hz payload=360B + load=25% | ws | 0.07 | 24 | 360 | 235.1 | 353 | 568.7 | 3.7 | 200.7 | 194/220 | ❌ | ✅ |
| WS@2Hz payload=360B + load=25% | ws | 0.06 | 20 | 360 | 172.2 | 384 | 528.5 | 3.3 | 200.8 | 191/221 | ❌ | ✅ |
| WS@2Hz payload=360B + load=50% | ws | 0.05 | 20 | 360 | 276.3 | 333 | 787.7 | 7.4 | 201.3 | 171/200 | ❌ | ✅ |
| WS@2Hz payload=360B + load=50% | ws | 0.05 | 19 | 360 | 263.5 | 380 | 735.3 | 9.9 | 201.2 | 158/184 | ❌ | ✅ |
| HTTP@0.5Hz payload=360B | polling | 0.02 | 8 | 360 | 103.4 | 1008 | 316.6 | 0.9 | 178.9 | 223/260 | ❌ | ✅ |
| HTTP@0.5Hz payload=360B | polling | 0.02 | 7 | 360 | 66.1 | 1043 | 384.4 | 1.0 | 180.5 | 226/258 | ❌ | ✅ |
| HTTP@0.5Hz payload=360B + load=25% | polling | 0.02 | 8 | 360 | 111.0 | 1008 | 539.0 | 2.5 | 200.5 | 205/237 | ❌ | ✅ |
| HTTP@0.5Hz payload=360B + load=25% | polling | 0.02 | 7 | 360 | 178.3 | 1148 | 621.8 | 1.6 | 201.8 | 192/218 | ❌ | ✅ |
| HTTP@0.5Hz payload=360B + load=50% | polling | 0.02 | 6 | 360 | 131.5 | 1128 | 596.1 | 8.9 | 195.2 | 179/214 | ❌ | ✅ |
| HTTP@0.5Hz payload=360B + load=50% | polling | 0.02 | 6 | 360 | 226.8 | 1071 | 697.3 | 7.2 | 196.7 | 184/207 | ❌ | ✅ |
| HTTP@1Hz payload=360B | polling | 0.04 | 14 | 360 | 244.7 | 520 | 596.0 | 1.0 | 186.7 | 206/231 | ❌ | ✅ |
| HTTP@1Hz payload=360B | polling | 0.04 | 14 | 360 | 175.4 | 589 | 493.3 | 0.8 | 186.9 | 214/248 | ❌ | ✅ |
| HTTP@1Hz payload=360B + load=25% | polling | 0.04 | 13 | 360 | 192.5 | 652 | 516.4 | 3.9 | 201.8 | 184/212 | ❌ | ✅ |
| HTTP@1Hz payload=360B + load=25% | polling | 0.03 | 11 | 360 | 184.6 | 576 | 575.2 | 4.8 | 201.0 | 194/223 | ❌ | ✅ |
| HTTP@1Hz payload=360B + load=50% | polling | 0.03 | 12 | 360 | 335.5 | 559 | 783.9 | 7.0 | 201.2 | 177/203 | ❌ | ✅ |
| HTTP@1Hz payload=360B + load=50% | polling | 0.03 | 11 | 360 | 354.9 | 614 | 654.4 | 6.6 | 201.2 | 178/202 | ❌ | ✅ |
| HTTP@2Hz payload=360B | polling | 0.07 | 24 | 360 | 131.3 | 336 | 438.1 | 0.8 | 187.1 | 212/240 | ❌ | ✅ |
| HTTP@2Hz payload=360B | polling | 0.07 | 25 | 360 | 187.8 | 328 | 499.1 | 0.9 | 187.2 | 207/236 | ❌ | ✅ |
| HTTP@2Hz payload=360B + load=25% | polling | 0.06 | 21 | 360 | 313.4 | 372 | 487.2 | 3.6 | 188.9 | 186/218 | ❌ | ✅ |
| HTTP@2Hz payload=360B + load=25% | polling | 0.06 | 21 | 360 | 166.6 | 326 | 602.6 | 2.8 | 191.5 | 184/215 | ❌ | ✅ |
| HTTP@2Hz payload=360B + load=50% | polling | 0.05 | 18 | 360 | 380.5 | 371 | 865.7 | 4.1 | 201.2 | 176/197 | ❌ | ✅ |
| HTTP@2Hz payload=360B + load=50% | polling | 0.06 | 20 | 360 | 270.6 | 414 | 706.2 | 3.6 | 201.2 | 171/193 | ❌ | ✅ |



Parametry przyjęte w ostatnim runie:
- Metody: ws, polling
- Częstotliwości [Hz]: 0.5, 1, 2
- Obciążenia CPU [%]: 0, 25, 50
- Czas sesji [s]: 60
- MONITOR_TICK_MS: 200
- Payloady: WS=360B, HTTP=360B
- Klienci: clientsHttp=0, clientsWs=0
- Warmup/Cooldown [s]: 4 / 4
- Repeats: 2




## Uśrednione wyniki wg obciążenia

Uwaga: "Obciążenie" oznacza sztuczne obciążenie CPU procesu podczas sesji (generator w worker_threads).

### Porównanie wg obciążenia — WebSocket

| Obciążenie | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | ELU p99 [ms] | CPU [%] | RSS [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0% | 0.05 | 16 | 360 | 102.9 | 368.8 | 0.8 | 183.2 |
| 25% | 0.04 | 15 | 360 | 199.0 | 559.6 | 3.4 | 200.6 |
| 50% | 0.04 | 13 | 360 | 257.8 | 729.5 | 6.9 | 197.9 |

### Porównanie wg obciążenia — HTTP polling

| Obciążenie | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | ELU p99 [ms] | CPU [%] | RSS [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0% | 0.04 | 15 | 360 | 151.5 | 454.6 | 0.9 | 184.5 |
| 25% | 0.04 | 14 | 360 | 191.1 | 557.0 | 3.2 | 197.6 |
| 50% | 0.03 | 12 | 360 | 283.3 | 717.3 | 6.2 | 199.5 |





## Uśrednione wyniki wg liczby klientów

Uwaga: "Liczba klientów" to liczba równoległych syntetycznych klientów generowanych wewnętrznie na czas sesji (HTTP: liczbę timerów; WS: efektywną sumaryczną częstość).

### Zestawienie wg liczby klientów — WebSocket

| Klienci | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | ELU p99 [ms] | CPU [%] | RSS [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 0.04 | 14 | 360 | 186.6 | 552.6 | 3.7 | 193.9 |

### Zestawienie wg liczby klientów — HTTP polling

| Klienci | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | ELU p99 [ms] | CPU [%] | RSS [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0.04 | 14 | 360 | 208.6 | 576.3 | 3.4 | 193.9 |





## Metrologia (95% CI) — ostatni run

Niepewność średnich estymowana z próbek (tick ~ 200 ms).

| Label | n (used/total) | Rate [/s] | CI95 Rate | CI95/avg | σ(rate) | Median Rate | Bytes/s | CI95 Bytes | CI95/avg | σ(bytes) | Median Bytes |
|---|:--:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| WS@0.5Hz payload=360B | 225/249 | 0.03 | ± 0.01 | 45% | 0.09 | 0.00 | 9 | ± 4 | 45% | 32 | 0 |
| WS@0.5Hz payload=360B | 235/272 | 0.02 | ± 0.01 | 38% | 0.06 | 0.00 | 8 | ± 3 | 38% | 23 | 0 |
| WS@0.5Hz payload=360B + load=25% | 205/228 | 0.02 | ± 0.01 | 40% | 0.07 | 0.00 | 8 | ± 3 | 40% | 23 | 0 |
| WS@0.5Hz payload=360B + load=25% | 194/215 | 0.02 | ± 0.01 | 40% | 0.06 | 0.00 | 7 | ± 3 | 40% | 20 | 0 |
| WS@0.5Hz payload=360B + load=50% | 183/213 | 0.02 | ± 0.01 | 40% | 0.05 | 0.00 | 6 | ± 3 | 40% | 18 | 0 |
| WS@0.5Hz payload=360B + load=50% | 184/212 | 0.02 | ± 0.01 | 40% | 0.05 | 0.00 | 7 | ± 3 | 40% | 19 | 0 |
| WS@1Hz payload=360B | 227/261 | 0.04 | ± 0.01 | 27% | 0.08 | 0.00 | 13 | ± 4 | 27% | 27 | 0 |
| WS@1Hz payload=360B | 223/258 | 0.04 | ± 0.01 | 26% | 0.08 | 0.00 | 15 | ± 4 | 26% | 29 | 0 |
| WS@1Hz payload=360B + load=25% | 194/224 | 0.04 | ± 0.01 | 26% | 0.07 | 0.00 | 13 | ± 3 | 26% | 24 | 0 |
| WS@1Hz payload=360B + load=25% | 189/222 | 0.04 | ± 0.01 | 29% | 0.08 | 0.00 | 14 | ± 4 | 29% | 29 | 0 |
| WS@1Hz payload=360B + load=50% | 167/193 | 0.03 | ± 0.02 | 67% | 0.15 | 0.00 | 12 | ± 8 | 67% | 53 | 0 |
| WS@1Hz payload=360B + load=50% | 174/212 | 0.03 | ± 0.14 | 398% | 0.92 | 0.00 | 12 | ± 49 | 398% | 331 | 0 |
| WS@2Hz payload=360B | 219/249 | 0.07 | ± 0.01 | 19% | 0.10 | 0.00 | 27 | ± 5 | 19% | 38 | 0 |
| WS@2Hz payload=360B | 205/239 | 0.07 | ± 0.02 | 22% | 0.12 | 0.00 | 26 | ± 6 | 22% | 42 | 0 |
| WS@2Hz payload=360B + load=25% | 194/220 | 0.07 | ± 0.02 | 22% | 0.11 | 0.00 | 24 | ± 5 | 22% | 39 | 0 |
| WS@2Hz payload=360B + load=25% | 191/221 | 0.06 | ± 10.26 | 18373% | 72.35 | 0.00 | 20 | ± 3694 | 18373% | 26047 | 0 |
| WS@2Hz payload=360B + load=50% | 171/200 | 0.05 | ± 0.01 | 22% | 0.08 | 0.00 | 20 | ± 4 | 22% | 28 | 0 |
| WS@2Hz payload=360B + load=50% | 158/184 | 0.05 | ± 0.01 | 22% | 0.08 | 0.00 | 19 | ± 4 | 22% | 27 | 0 |
| HTTP@0.5Hz payload=360B | 223/260 | 0.02 | ± 0.01 | 37% | 0.07 | 0.00 | 8 | ± 3 | 37% | 24 | 0 |
| HTTP@0.5Hz payload=360B | 226/258 | 0.02 | ± 0.01 | 39% | 0.06 | 0.00 | 7 | ± 3 | 39% | 21 | 0 |
| HTTP@0.5Hz payload=360B + load=25% | 205/237 | 0.02 | ± 0.01 | 38% | 0.06 | 0.00 | 8 | ± 3 | 38% | 22 | 0 |
| HTTP@0.5Hz payload=360B + load=25% | 192/218 | 0.02 | ± 1.67 | 8782% | 11.80 | 0.00 | 7 | ± 601 | 8782% | 4247 | 0 |
| HTTP@0.5Hz payload=360B + load=50% | 179/214 | 0.02 | ± 0.01 | 41% | 0.05 | 0.00 | 6 | ± 3 | 41% | 18 | 0 |
| HTTP@0.5Hz payload=360B + load=50% | 184/207 | 0.02 | ± 0.01 | 39% | 0.05 | 0.00 | 6 | ± 2 | 39% | 17 | 0 |
| HTTP@1Hz payload=360B | 206/231 | 0.04 | ± 0.01 | 27% | 0.08 | 0.00 | 14 | ± 4 | 27% | 28 | 0 |
| HTTP@1Hz payload=360B | 214/248 | 0.04 | ± 0.01 | 27% | 0.08 | 0.00 | 14 | ± 4 | 27% | 28 | 0 |
| HTTP@1Hz payload=360B + load=25% | 184/212 | 0.04 | ± 0.01 | 27% | 0.07 | 0.00 | 13 | ± 4 | 27% | 25 | 0 |
| HTTP@1Hz payload=360B + load=25% | 194/223 | 0.03 | ± 0.01 | 29% | 0.06 | 0.00 | 11 | ± 3 | 29% | 23 | 0 |
| HTTP@1Hz payload=360B + load=50% | 177/203 | 0.03 | ± 0.01 | 32% | 0.07 | 0.00 | 12 | ± 4 | 32% | 26 | 0 |
| HTTP@1Hz payload=360B + load=50% | 178/202 | 0.03 | ± 0.04 | 145% | 0.30 | 0.00 | 11 | ± 16 | 145% | 107 | 0 |
| HTTP@2Hz payload=360B | 212/240 | 0.07 | ± 0.01 | 20% | 0.10 | 0.00 | 24 | ± 5 | 20% | 36 | 0 |
| HTTP@2Hz payload=360B | 207/236 | 0.07 | ± 0.12 | 169% | 0.87 | 0.00 | 25 | ± 43 | 169% | 315 | 0 |
| HTTP@2Hz payload=360B + load=25% | 186/218 | 0.06 | ± 0.04 | 72% | 0.30 | 0.00 | 21 | ± 15 | 72% | 107 | 0 |
| HTTP@2Hz payload=360B + load=25% | 184/215 | 0.06 | ± 0.11 | 184% | 0.74 | 0.00 | 21 | ± 38 | 184% | 266 | 0 |
| HTTP@2Hz payload=360B + load=50% | 176/197 | 0.05 | ± 0.01 | 23% | 0.07 | 0.00 | 18 | ± 4 | 23% | 27 | 0 |
| HTTP@2Hz payload=360B + load=50% | 171/193 | 0.06 | ± 0.27 | 484% | 1.81 | 0.00 | 20 | ± 98 | 484% | 652 | 0 |



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

- WS@0.5Hz payload=360B: rate=0.03 in [0.25, 0.75] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- WS@0.5Hz payload=360B: rate=0.02 in [0.25, 0.75] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- WS@0.5Hz payload=360B + load=25%: rate=0.02 in [0.25, 0.75] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- WS@0.5Hz payload=360B + load=25%: rate=0.02 in [0.25, 0.75] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- WS@0.5Hz payload=360B + load=50%: rate=0.02 in [0.25, 0.75] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- WS@0.5Hz payload=360B + load=50%: rate=0.02 in [0.25, 0.75] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- WS@1Hz payload=360B: rate=0.04 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- WS@1Hz payload=360B: rate=0.04 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- WS@1Hz payload=360B + load=25%: rate=0.04 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- WS@1Hz payload=360B + load=25%: rate=0.04 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- WS@1Hz payload=360B + load=50%: rate=0.03 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- WS@1Hz payload=360B + load=50%: rate=0.03 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- WS@2Hz payload=360B: rate=0.07 in [1.00, 3.00] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- WS@2Hz payload=360B: rate=0.07 in [1.00, 3.00] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- WS@2Hz payload=360B + load=25%: rate=0.07 in [1.00, 3.00] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- WS@2Hz payload=360B + load=25%: rate=0.06 in [1.00, 3.00] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- WS@2Hz payload=360B + load=50%: rate=0.05 in [1.00, 3.00] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- WS@2Hz payload=360B + load=50%: rate=0.05 in [1.00, 3.00] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@0.5Hz payload=360B: rate=0.02 in [0.25, 0.75] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@0.5Hz payload=360B: rate=0.02 in [0.25, 0.75] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@0.5Hz payload=360B + load=25%: rate=0.02 in [0.25, 0.75] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@0.5Hz payload=360B + load=25%: rate=0.02 in [0.25, 0.75] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@0.5Hz payload=360B + load=50%: rate=0.02 in [0.25, 0.75] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@0.5Hz payload=360B + load=50%: rate=0.02 in [0.25, 0.75] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@1Hz payload=360B: rate=0.04 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@1Hz payload=360B: rate=0.04 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@1Hz payload=360B + load=25%: rate=0.04 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@1Hz payload=360B + load=25%: rate=0.03 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@1Hz payload=360B + load=50%: rate=0.03 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@1Hz payload=360B + load=50%: rate=0.03 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@2Hz payload=360B: rate=0.07 in [1.00, 3.00] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@2Hz payload=360B: rate=0.07 in [1.00, 3.00] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@2Hz payload=360B + load=25%: rate=0.06 in [1.00, 3.00] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@2Hz payload=360B + load=25%: rate=0.06 in [1.00, 3.00] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@2Hz payload=360B + load=50%: rate=0.05 in [1.00, 3.00] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@2Hz payload=360B + load=50%: rate=0.06 in [1.00, 3.00] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)


## Walidacja wiarygodności i poprawności

Brak pliku validation.txt dla ostatniego runu.

- Rate OK: 0% (0/36)
- Payload OK: 100% (36/36)
- Minimalna liczba próbek n(used): 158
- Średni względny CI95: Rate ≈ 820%, Bytes/s ≈ 820%

Uwaga: FAIL wynika głównie z odchyleń Rate od oczekiwanych Hz. To spodziewane, jeśli źródło danych (Arduino/MQTT) publikuje ~1 Hz niezależnie od ustawień nominalnych. Payload przechodzi (OK) we wszystkich scenariuszach.



## Zwycięzcy (per scenariusz)

Dla każdej kombinacji Hz/obciążenia/liczby klientów wskazano najlepszą metodę w kluczowych kategoriach.

### Zwycięzcy — Hz=0.5|Load=0|Clients=0
- Częstość [#/s]: WS (WS@0.5Hz payload=360B) (≈ 0.03)
- Jitter [ms]: WS (WS@0.5Hz payload=360B) (≈ 53.9)
- Staleness [ms]: WS (WS@0.5Hz payload=360B) (≈ 1003.0)
- CPU [%]: WS (WS@0.5Hz payload=360B) (≈ 0.7)
- RSS [MB]: WS (WS@0.5Hz payload=360B) (≈ 176.7)

### Zwycięzcy — Hz=0.5|Load=25|Clients=0
- Częstość [#/s]: WS (WS@0.5Hz payload=360B + load=25%) (≈ 0.02)
- Jitter [ms]: WS (WS@0.5Hz payload=360B + load=25%) (≈ 163.2)
- Staleness [ms]: WS (WS@0.5Hz payload=360B + load=25%) (≈ 1011.2)
- CPU [%]: WS (WS@0.5Hz payload=360B + load=25%) (≈ 2.7)
- RSS [MB]: WS (WS@0.5Hz payload=360B + load=25%) (≈ 200.4)

### Zwycięzcy — Hz=0.5|Load=50|Clients=0
- Częstość [#/s]: WS (WS@0.5Hz payload=360B + load=50%) (≈ 0.02)
- Jitter [ms]: WS (WS@0.5Hz payload=360B + load=50%) (≈ 169.4)
- Staleness [ms]: WS (WS@0.5Hz payload=360B + load=50%) (≈ 1107.8)
- CPU [%]: WS (WS@0.5Hz payload=360B + load=50%) (≈ 3.5)
- RSS [MB]: WS (WS@0.5Hz payload=360B + load=50%) (≈ 192.5)

### Zwycięzcy — Hz=1|Load=0|Clients=0
- Częstość [#/s]: WS (WS@1Hz payload=360B) (≈ 0.04)
- Jitter [ms]: WS (WS@1Hz payload=360B) (≈ 59.6)
- Staleness [ms]: WS (WS@1Hz payload=360B) (≈ 564.0)
- CPU [%]: WS (WS@1Hz payload=360B) (≈ 0.5)
- RSS [MB]: WS (WS@1Hz payload=360B) (≈ 181.6)

### Zwycięzcy — Hz=1|Load=25|Clients=0
- Częstość [#/s]: WS (WS@1Hz payload=360B + load=25%) (≈ 0.04)
- Jitter [ms]: WS (WS@1Hz payload=360B + load=25%) (≈ 188.1)
- Staleness [ms]: WS (WS@1Hz payload=360B + load=25%) (≈ 574.7)
- CPU [%]: WS (WS@1Hz payload=360B + load=25%) (≈ 3.2)
- RSS [MB]: WS (WS@1Hz payload=360B + load=25%) (≈ 200.4)

### Zwycięzcy — Hz=1|Load=50|Clients=0
- Częstość [#/s]: WS (WS@1Hz payload=360B + load=50%) (≈ 0.03)
- Jitter [ms]: WS (WS@1Hz payload=360B + load=50%) (≈ 209.5)
- Staleness [ms]: WS (WS@1Hz payload=360B + load=50%) (≈ 627.6)
- CPU [%]: WS (WS@1Hz payload=360B + load=50%) (≈ 7.1)
- RSS [MB]: WS (WS@1Hz payload=360B + load=50%) (≈ 198.5)

### Zwycięzcy — Hz=2|Load=0|Clients=0
- Częstość [#/s]: WS (WS@2Hz payload=360B) (≈ 0.07)
- Jitter [ms]: WS (WS@2Hz payload=360B) (≈ 109.2)
- Staleness [ms]: WS (WS@2Hz payload=360B) (≈ 334.6)
- CPU [%]: WS (WS@2Hz payload=360B) (≈ 0.7)
- RSS [MB]: WS (WS@2Hz payload=360B) (≈ 186.9)

### Zwycięzcy — Hz=2|Load=25|Clients=0
- Częstość [#/s]: WS (WS@2Hz payload=360B + load=25%) (≈ 0.07)
- Jitter [ms]: WS (WS@2Hz payload=360B + load=25%) (≈ 172.2)
- Staleness [ms]: WS (WS@2Hz payload=360B + load=25%) (≈ 352.8)
- CPU [%]: WS (WS@2Hz payload=360B + load=25%) (≈ 3.3)
- RSS [MB]: WS (WS@2Hz payload=360B + load=25%) (≈ 200.7)

### Zwycięzcy — Hz=2|Load=50|Clients=0
- Częstość [#/s]: WS (WS@2Hz payload=360B + load=50%) (≈ 0.05)
- Jitter [ms]: WS (WS@2Hz payload=360B + load=50%) (≈ 263.5)
- Staleness [ms]: WS (WS@2Hz payload=360B + load=50%) (≈ 332.5)
- CPU [%]: WS (WS@2Hz payload=360B + load=50%) (≈ 7.4)
- RSS [MB]: WS (WS@2Hz payload=360B + load=50%) (≈ 201.2)

### Zwycięzcy — Hz=0.5|Load=0|Clients=1
- Częstość [#/s]: POLLING (HTTP@0.5Hz payload=360B) (≈ 0.02)
- Jitter [ms]: POLLING (HTTP@0.5Hz payload=360B) (≈ 66.1)
- Staleness [ms]: POLLING (HTTP@0.5Hz payload=360B) (≈ 1008.0)
- CPU [%]: POLLING (HTTP@0.5Hz payload=360B) (≈ 0.9)
- RSS [MB]: POLLING (HTTP@0.5Hz payload=360B) (≈ 178.9)

### Zwycięzcy — Hz=0.5|Load=25|Clients=1
- Częstość [#/s]: POLLING (HTTP@0.5Hz payload=360B + load=25%) (≈ 0.02)
- Jitter [ms]: POLLING (HTTP@0.5Hz payload=360B + load=25%) (≈ 111.0)
- Staleness [ms]: POLLING (HTTP@0.5Hz payload=360B + load=25%) (≈ 1007.6)
- CPU [%]: POLLING (HTTP@0.5Hz payload=360B + load=25%) (≈ 1.6)
- RSS [MB]: POLLING (HTTP@0.5Hz payload=360B + load=25%) (≈ 200.5)

### Zwycięzcy — Hz=0.5|Load=50|Clients=1
- Częstość [#/s]: POLLING (HTTP@0.5Hz payload=360B + load=50%) (≈ 0.02)
- Jitter [ms]: POLLING (HTTP@0.5Hz payload=360B + load=50%) (≈ 131.5)
- Staleness [ms]: POLLING (HTTP@0.5Hz payload=360B + load=50%) (≈ 1071.3)
- CPU [%]: POLLING (HTTP@0.5Hz payload=360B + load=50%) (≈ 7.2)
- RSS [MB]: POLLING (HTTP@0.5Hz payload=360B + load=50%) (≈ 195.2)

### Zwycięzcy — Hz=1|Load=0|Clients=1
- Częstość [#/s]: POLLING (HTTP@1Hz payload=360B) (≈ 0.04)
- Jitter [ms]: POLLING (HTTP@1Hz payload=360B) (≈ 175.4)
- Staleness [ms]: POLLING (HTTP@1Hz payload=360B) (≈ 520.0)
- CPU [%]: POLLING (HTTP@1Hz payload=360B) (≈ 0.8)
- RSS [MB]: POLLING (HTTP@1Hz payload=360B) (≈ 186.7)

### Zwycięzcy — Hz=1|Load=25|Clients=1
- Częstość [#/s]: POLLING (HTTP@1Hz payload=360B + load=25%) (≈ 0.04)
- Jitter [ms]: POLLING (HTTP@1Hz payload=360B + load=25%) (≈ 184.6)
- Staleness [ms]: POLLING (HTTP@1Hz payload=360B + load=25%) (≈ 576.0)
- CPU [%]: POLLING (HTTP@1Hz payload=360B + load=25%) (≈ 3.9)
- RSS [MB]: POLLING (HTTP@1Hz payload=360B + load=25%) (≈ 201.0)

### Zwycięzcy — Hz=1|Load=50|Clients=1
- Częstość [#/s]: POLLING (HTTP@1Hz payload=360B + load=50%) (≈ 0.03)
- Jitter [ms]: POLLING (HTTP@1Hz payload=360B + load=50%) (≈ 335.5)
- Staleness [ms]: POLLING (HTTP@1Hz payload=360B + load=50%) (≈ 559.1)
- CPU [%]: POLLING (HTTP@1Hz payload=360B + load=50%) (≈ 6.6)
- RSS [MB]: POLLING (HTTP@1Hz payload=360B + load=50%) (≈ 201.2)

### Zwycięzcy — Hz=2|Load=0|Clients=1
- Częstość [#/s]: POLLING (HTTP@2Hz payload=360B) (≈ 0.07)
- Jitter [ms]: POLLING (HTTP@2Hz payload=360B) (≈ 131.3)
- Staleness [ms]: POLLING (HTTP@2Hz payload=360B) (≈ 327.6)
- CPU [%]: POLLING (HTTP@2Hz payload=360B) (≈ 0.8)
- RSS [MB]: POLLING (HTTP@2Hz payload=360B) (≈ 187.1)

### Zwycięzcy — Hz=2|Load=25|Clients=1
- Częstość [#/s]: POLLING (HTTP@2Hz payload=360B + load=25%) (≈ 0.06)
- Jitter [ms]: POLLING (HTTP@2Hz payload=360B + load=25%) (≈ 166.6)
- Staleness [ms]: POLLING (HTTP@2Hz payload=360B + load=25%) (≈ 326.3)
- CPU [%]: POLLING (HTTP@2Hz payload=360B + load=25%) (≈ 2.8)
- RSS [MB]: POLLING (HTTP@2Hz payload=360B + load=25%) (≈ 188.9)

### Zwycięzcy — Hz=2|Load=50|Clients=1
- Częstość [#/s]: POLLING (HTTP@2Hz payload=360B + load=50%) (≈ 0.06)
- Jitter [ms]: POLLING (HTTP@2Hz payload=360B + load=50%) (≈ 270.6)
- Staleness [ms]: POLLING (HTTP@2Hz payload=360B + load=50%) (≈ 370.7)
- CPU [%]: POLLING (HTTP@2Hz payload=360B + load=50%) (≈ 3.6)
- RSS [MB]: POLLING (HTTP@2Hz payload=360B + load=50%) (≈ 201.2)

### Podsumowanie globalne (średnio)
- Rate: WS 0.04 /s vs HTTP 0.04 /s
- Jitter: WS 186.6 ms vs HTTP 208.6 ms (niżej lepiej)
- Staleness: WS 674 ms vs HTTP 670 ms (niżej lepiej)
- CPU: WS 3.7% vs HTTP 3.4% (niżej lepiej)
- RSS: WS 193.9 MB vs HTTP 193.9 MB (niżej lepiej)



## Wnioski — wizualne porównanie


### Wnioski — porównanie WS vs HTTP wg obciążenia


| Obciążenie [%] | Rate WS [/s] | Rate HTTP [/s] | Jitter WS [ms] | Jitter HTTP [ms] | Staleness WS [ms] | Staleness HTTP [ms] | ELU p99 WS [ms] | ELU p99 HTTP [ms] | CPU WS [%] | CPU HTTP [%] | RSS WS [MB] | RSS HTTP [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | **0.05** | 0.04 | **102.9** | 151.5 | 645 | **637** | **368.8** | 454.6 | **0.8** | 0.9 | **183.2** | 184.5 |
| 25 | **0.04** | 0.04 | 199.0 | **191.1** | **672** | 680 | 559.6 | **557.0** | 3.4 | **3.2** | 200.6 | **197.6** |
| 50 | **0.04** | 0.03 | **257.8** | 283.3 | 704 | **693** | 729.5 | **717.3** | 6.9 | **6.2** | **197.9** | 199.5 |


### Wnioski — porównanie WS vs HTTP wg liczby klientów


| Klienci | Rate WS [/s] | Rate HTTP [/s] | Jitter WS [ms] | Jitter HTTP [ms] | Staleness WS [ms] | Staleness HTTP [ms] | ELU p99 WS [ms] | ELU p99 HTTP [ms] | CPU WS [%] | CPU HTTP [%] | RSS WS [MB] | RSS HTTP [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 0.04 | — | 186.6 | — | 674 | — | 552.6 | — | 3.7 | — | 193.9 | — |
| 1 | — | 0.04 | — | 208.6 | — | 670 | — | 576.3 | — | 3.4 | — | 193.9 |


### Wnioski — krótkie podsumowanie (WS vs HTTP)

- Średnio (ten run): Rate — WS 0.04 /s vs HTTP 0.04 /s
- Średnio: Jitter — WS 186.6 ms vs HTTP 208.6 ms (niżej = stabilniej)
- Średnio: Staleness — WS 674 ms vs HTTP 670 ms (niżej = świeżej)
- Średnio: CPU — WS 3.7% vs HTTP 3.4% (niżej = lżej)


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
