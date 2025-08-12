# Aspekt badawczy – skrót dokumentacji

Poniżej zebrano zwięzły opis części badawczej projektu: cele, metodologia, metryki, procedury pomiarowe, kryteria oceny oraz mapowanie wyników na dashboard. Dokument opisuje, jak replikować oraz interpretować wyniki.

## Szybki glosariusz (pojęcia kluczowe)

- Rate [/s] — średnia liczba zdarzeń na sekundę (WS: wiadomości; HTTP: żądania).
- Bytes/s — przepustowość bajtowa na sekundę (WS/HTTP odpowiednio). ≈ Rate × ~Payload przy stałym ładunku.
- ~Payload [B] — średni rozmiar ładunku (bajtów) na pojedyncze zdarzenie.
- Bytes/jednostkę (bytesPerUnit) — koszt bajtowy pojedynczego zdarzenia: Bytes/s ÷ Rate.
- Jitter [ms] — zmienność odstępów między zdarzeniami (odchylenie standardowe; niższy = stabilniej).
- Staleness [ms] — „wiek” danych: czas od powstania próbki na źródle do chwili pomiaru; w eksporcie jako dataFreshnessMs. Przybliżenie: staleness_ms ≈ now_ms − sourceTsMs.
- EL delay p99 [ms] — 99. percentyl opóźnień pętli zdarzeń Node.js (większe piki → blokady/GC/I/O).
- CI95 — 95% przedział ufności średniej (tu: 1.96·SE; dla rzadkich zdarzeń fallback Poissona).
- CI95/avg — względna szerokość CI wobec średniej (niżej = stabilniej).
- CPU [%] — średnie obciążenie CPU procesu Node.
- RSS [MB] — pamięć robocza procesu (Resident Set Size).

## 1. Cel i pytania badawcze

Celem jest ilościowe porównanie dwóch sposobów dostarczania danych telemetrycznych z systemu IoT do klienta:

- WebSocket (WS) – transmisja push,
- HTTP Polling – cykliczne odpytywanie (pull).

Kluczowe pytania i hipotezy (H):

- H1: WebSocket (push) zapewnia niższy staleness [ms] niż HTTP polling przy tych samych Hz (0.5–2 Hz), bo dane trafiają „natychmiast” po publikacji, a nie w oknie odpytywania.
- H2: Dla stałego ładunku Bytes/s ≈ Rate × Payload (w obu metodach); odchylenie > 30% wskazuje błąd lub silny jitter/trim.
- H3: Jitter [ms] (stabilność interwałów) jest niższy w WS (sterowany driver) niż w HTTP (timery/kolejki JS).
- H4: Narzut CPU i EL delay p99 rośnie wraz z Hz i liczbą klientów; przy ≤ 2 Hz obie metody mieszczą się w „akceptowalnym” zakresie dla pojedynczej instancji API.
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
- Staleness [ms] (wiek danych): czas od powstania próbki na źródle do chwili pomiaru (niższy = świeższe). W eksporcie jako dataFreshnessMs; przybliżona formuła: staleness_ms ≈ now_ms − sourceTsMs.
- Bytes/jednostkę (bytesPerUnit): relacja Bytes/s do Rate (bytesPerUnit = Bytes/s ÷ Rate); oczekiwane ≈ ~Payload przy stałym ładunku.
- EL delay p99 [ms]: 99. percentyl opóźnienia pętli zdarzeń Node (metryka skorelowana z ELU).
- CPU [%], RSS [MB]: zużycie procesora i pamięci procesu.

Źródło metryk: `api/src/services/ResourceMonitorService.ts`.

Słownik kolumn pliku sessions.csv (pełny opis): zob. „API README” — ../api/README.md.

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
  - `npm run research:quick` — krótki test weryfikacyjny (krótki przebieg) + automatyczna walidacja
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
- EL delay p99 → opóźnienia pętli zdarzeń (niższe = lepiej).
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

Ostatni run: 2025-08-13T00-21-27-561Z

Status: fair payload: TAK, source-limited: NIE, czas: 10s, tick: 200 ms, repeats: 1

Pliki: [sessions.csv](../api/benchmarks/2025-08-13T00-21-27-561Z/sessions.csv), [summary.json](../api/benchmarks/2025-08-13T00-21-27-561Z/summary.json), [README](../api/benchmarks/2025-08-13T00-21-27-561Z/README.md)

Uwaga: tabele uporządkowane wg: Mode (WS, HTTP) → Hz → Obciążenie → Klienci.

Uwaga: Scenariusze z liczbą klientów = 0 mają różną semantykę: WS (push) emituje niezależnie od liczby klientów (mierzymy tempo emisji), natomiast HTTP (pull) przy 0 klientach nie generuje żądań → brak aktywności. Dlatego w porównaniach WS vs HTTP ("Zwycięzcy", tabele WS vs HTTP) takie wiersze są pomijane.

| Label | Mode | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | Staleness [ms] | EL delay p99 [ms] | CPU [%] | RSS [MB] | n (used/total) | Rate OK | Payload OK |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--:|:--:|:--:|
| WS@1Hz payload=360B cWs=10 [rep 1/1] | ws | 1.33 | 479 | 360 | 3.5 | 318 | 35.8 | 1.0 | 209.9 | 3/4 | ✅ | ✅ |
| HTTP@1Hz payload=360B cHttp=10 [rep 1/1] | polling | 9.77 | 3518 | 360 | 278.1 | 544 | 34.4 | 1.0 | 178.9 | 4/6 | ✅ | ✅ |



Parametry przyjęte w ostatnim runie:
- Metody: ws, polling
- Częstotliwości [Hz]: 1
- Obciążenia CPU [%]: 0
- Czas sesji [s]: 10
- MONITOR_TICK_MS: 200
- Payloady: WS=360B, HTTP=360B
- Klienci: clientsHttp=10, clientsWs=10
- Warmup/Cooldown [s]: 2 / 2
- Repeats: 1




## Uśrednione wyniki wg obciążenia

Uwaga: "Obciążenie" oznacza sztuczne obciążenie CPU procesu podczas sesji (generator w worker_threads).

### Porównanie wg obciążenia — WebSocket

| Obciążenie | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | EL delay p99 [ms] | CPU [%] | RSS [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0% | 1.33 | 479 | 360 | 3.5 | 35.8 | 1.0 | 209.9 |

### Porównanie wg obciążenia — HTTP polling

| Obciążenie | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | EL delay p99 [ms] | CPU [%] | RSS [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 0% | 9.77 | 3518 | 360 | 278.1 | 34.4 | 1.0 | 178.9 |





## Uśrednione wyniki wg liczby klientów

Uwaga: "Liczba klientów" to liczba równoległych syntetycznych klientów generowanych wewnętrznie na czas sesji (HTTP: liczbę timerów; WS: efektywną sumaryczną częstość).

### Zestawienie wg liczby klientów — WebSocket

| Klienci | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | EL delay p99 [ms] | CPU [%] | RSS [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 1.33 | 479 | 360 | 3.5 | 35.8 | 1.0 | 209.9 |

### Zestawienie wg liczby klientów — HTTP polling

| Klienci | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | EL delay p99 [ms] | CPU [%] | RSS [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 9.77 | 3518 | 360 | 278.1 | 34.4 | 1.0 | 178.9 |





## Znormalizowane na klienta — wyniki wg liczby klientów

Poniżej metryki przeliczone na jednego klienta. Dla WS (broadcast) tempo na klienta odpowiada tempie emisji; dla HTTP (pull) tempo na klienta ≈ 1 Hz przy Hz=1 i rośnie liniowo wraz z konfiguracją.

### Zestawienie wg liczby klientów — znormalizowane (WebSocket)

| Klienci | Rate/klient [/s] | Bytes/klient [B/s] | ~Payload [B] | Jitter [ms] | EL delay p99 [ms] | CPU/klient [%] | RSS/klient [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 1.330 | 479 | 360 | 3.5 | 35.8 | 0.103 | 20.986 |

### Zestawienie wg liczby klientów — znormalizowane (HTTP polling)

| Klienci | Rate/klient [/s] | Bytes/klient [B/s] | ~Payload [B] | Jitter [ms] | EL delay p99 [ms] | CPU/klient [%] | RSS/klient [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 0.977 | 352 | 360 | 278.1 | 34.4 | 0.096 | 17.889 |





## Metrologia (95% CI) — ostatni run

Niepewność średnich estymowana z próbek (tick ~ 200 ms).

| Label | n (used/total) | Rate [/s] | CI95 Rate | CI95/avg | σ(rate) | Median Rate | Bytes/s | CI95 Bytes | CI95/avg | σ(bytes) | Median Bytes |
|---|:--:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| WS@1Hz payload=360B cWs=10 | 3/4 | 1.33 | ± 0.99 | 74% | 10.65 | 1.15 | 479 | ± 355 | 74% | 3833 | 413 |
| HTTP@1Hz payload=360B cHttp=10 | 4/6 | 9.77 | ± 2.76 | 28% | 2.81 | 10.76 | 3518 | ± 992 | 28% | 1012 | 3874 |



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

- WS@1Hz payload=360B cWs=10 [rep 1/1]: rate=1.33 in [0.50, 1.50] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B cHttp=10 [rep 1/1]: rate=9.77 in [5.00, 15.00] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)


## Walidacja wiarygodności i poprawności

Validation status: WARN
Run: 2025-08-13T00-21-27-561Z

- Rate OK: 100% (2/2)
- Payload OK: 100% (2/2)
- Minimalna liczba próbek n(used): 3
- Średni względny CI95: Rate ≈ 51%, Bytes/s ≈ 51%

Uwaga: FAIL wynika głównie z odchyleń Rate od oczekiwanych Hz. To spodziewane, jeśli źródło danych (Arduino/MQTT) publikuje ~1 Hz niezależnie od ustawień nominalnych. Payload przechodzi (OK) we wszystkich scenariuszach.



## Zwycięzcy (per scenariusz)

Dla każdej kombinacji Hz/obciążenia/liczby klientów wskazano najlepszą metodę w kluczowych kategoriach.

### Zwycięzcy — Hz=1|Load=0|Clients=10
- Częstość [#/s]: POLLING (HTTP@1Hz payload=360B cHttp=10) (≈ 9.77)
- Jitter [ms]: WS (WS@1Hz payload=360B cWs=10) (≈ 3.5)
- Staleness [ms]: WS (WS@1Hz payload=360B cWs=10) (≈ 317.7)
- CPU [%]: POLLING (HTTP@1Hz payload=360B cHttp=10) (≈ 1.0)
- RSS [MB]: POLLING (HTTP@1Hz payload=360B cHttp=10) (≈ 178.9)

### Podsumowanie globalne (średnio)
- Rate: WS 1.33 /s vs HTTP 9.77 /s
- Jitter: WS 3.5 ms vs HTTP 278.1 ms (niżej lepiej)
- Staleness: WS 318 ms vs HTTP 544 ms (niżej lepiej)
- CPU: WS 1.0% vs HTTP 1.0% (niżej lepiej)
- RSS: WS 209.9 MB vs HTTP 178.9 MB (niżej lepiej)



## Wnioski — wizualne porównanie


### Wnioski — porównanie WS vs HTTP wg obciążenia


| Obciążenie [%] | Rate WS [/s] | Rate HTTP [/s] | Jitter WS [ms] | Jitter HTTP [ms] | Staleness WS [ms] | Staleness HTTP [ms] | EL delay p99 WS [ms] | EL delay p99 HTTP [ms] | CPU WS [%] | CPU HTTP [%] | RSS WS [MB] | RSS HTTP [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 1.33 | **9.77** | **3.5** | 278.1 | **318** | 544 | 35.8 | **34.4** | 1.0 | **1.0** | 209.9 | **178.9** |


### Wnioski — porównanie WS vs HTTP wg liczby klientów


| Klienci | Rate WS [/s] | Rate HTTP [/s] | Jitter WS [ms] | Jitter HTTP [ms] | Staleness WS [ms] | Staleness HTTP [ms] | EL delay p99 WS [ms] | EL delay p99 HTTP [ms] | CPU WS [%] | CPU HTTP [%] | RSS WS [MB] | RSS HTTP [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 1.33 | **9.77** | **3.5** | 278.1 | **318** | 544 | 35.8 | **34.4** | 1.0 | **1.0** | 209.9 | **178.9** |


### Wnioski — krótkie podsumowanie (WS vs HTTP)

- Średnio (ten run): Rate — WS 1.33 /s vs HTTP 9.77 /s
- Średnio: Jitter — WS 3.5 ms vs HTTP 278.1 ms (niżej = stabilniej)
- Średnio: Staleness — WS 318 ms vs HTTP 544 ms (niżej = świeżej)
- Średnio: CPU — WS 1.0% vs HTTP 1.0% (niżej = lżej)


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
- EL delay p99 [ms] — 99. percentyl opóźnień pętli zdarzeń (większe piki wskazują blokady/GC/I/O).
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
