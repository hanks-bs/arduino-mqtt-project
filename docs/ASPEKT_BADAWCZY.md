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
  - HTTP: httpBytesRate sumuje odpowiedzi wszystkich klientów (rośnie wraz z N).
  - WS: wsBytesRate dotyczy przepływności emisji po stronie serwera (nie jest mnożony przez liczbę odbiorców).
- ~Payload [B]: wsAvgBytesPerMsg lub httpAvgBytesPerReq.
- Rate/cli [/s], Bytes/cli [B/s]: metryki „per klient” ułatwiające porównania:
  - HTTP: Rate/cli = Rate / N, Bytes/cli = Bytes/s / N (N = liczba klientów HTTP).
  - WS (broadcast): Rate/cli = Rate (ta sama emisja dla wszystkich), Bytes/cli = Bytes/s / N (łączna przepustowość dzielona przez liczbę odbiorców).
  - Gdy N=0 (HTTP: brak żądań, WS: brak odbiorców) pola per‑client są puste.
- Jitter [ms]: odchylenie standardowe odstępów między wiadomościami/odpowiedziami.
- Staleness [ms] (wiek danych): czas od ostatniego odczytu danych (niższy = świeższe).
- ELU p99 [ms]: 99. percentyl opóźnienia pętli zdarzeń Node (metryka skorelowana z ELU).
- CPU [%], RSS [MB]: zużycie procesora i pamięci procesu.

Źródło metryk: `api/src/services/ResourceMonitorService.ts`.

### 2a. Formuły metryk i jak je czytać (WS vs HTTP)

Poniżej zebrano uproszczone formuły i zasady interpretacji. Średnie liczone są po przycięciu próbek (warmup/cooldown) oraz czasowo ważone (rate_i×dt_i) w ramach okna próbkowania monitora.

- Rate [/s]
  - Definicja: liczba zdarzeń na sekundę (WS: wiadomości/s, HTTP: odpowiedzi/s).
  - Obliczenie: avgRate ≈ Σ(rate_i×dt_i) / Σdt_i ≈ liczba_zdarzeń / czas.
- Bytes/s
  - Definicja: łączna przepływność bajtów/s.
  - Obliczenie: avgBytesRate ≈ Σ(bytesRate_i×dt_i) / Σdt_i.
- ~Payload [B]
  - Definicja: średni rozmiar ładunku na zdarzenie.
  - Obliczenie: avgPayload ≈ Bytes/s ÷ Rate.
- Rate/cli [/s] (per odbiorcę)
  - HTTP: Rate/cli = Rate ÷ N (N = liczba klientów HTTP).
  - WS (broadcast): Rate/cli = Rate (nie dzielimy przez N). Każdy klient dostaje ten sam strumień.
- Bytes/cli [B/s] (per odbiorcę)
  - HTTP: Bytes/cli = Bytes/s ÷ N.
  - WS (broadcast): Bytes/cli ≈ Rate × Payload (co dostaje pojedynczy klient). W tabelach pełnych, gdy N>0, równoważnie: Bytes/s ÷ N (perspektywa serwera).
- Egress est. [B/s] (łączny koszt sieci po stronie serwera)
  - WS: Egress ≈ Rate × Payload × N.
  - HTTP: Egress ≈ Bytes/s (wartość już sumuje po klientach).
- Jitter [ms]
  - Definicja: odchylenie standardowe odstępów między zdarzeniami w danym oknie próbki monitora.
  - Interpretacja: niższy = stabilniejsze interwały (mniej „zgrupowań”/przerw).
- Staleness [ms]
  - Definicja: czas „wieku” danych od źródła do momentu pomiaru (niżej = świeższe).
- ELU p99 [ms]
  - Definicja: 99. percentyl opóźnienia pętli zdarzeń (miara presji na event loop; niżej = lepiej).
- CPU [%], RSS [MB]
  - Definicja: średnie zużycie CPU i pamięci procesu Node.js.

Praktyczny skrót:

- Porównuj WS vs HTTP na Rate/cli (per użytkownika), Jitter, Staleness, CPU i RSS.
- Koszt sieci zestawiaj przez Egress est. (WS mnożone ×N; HTTP już zsumowane).

### 2b. Dlaczego jitter w HTTP polling jest wyższy (i rośnie z liczbą klientów)?

Wyniki pokazują, że dla 1 Hz i N=10–50 klientów jitter HTTP bywa rzędu 140–300 ms, gdy w WS ~1–3 ms. To zjawisko wynika z konstrukcji protokołu i runtime:

1. Timery i „faza” wielu klientów (pull):

— Każdy klient polling ma własny timer. Nawet jeśli startują „równolegle”, szybko się rozjeżdżają (drift) lub przeciwnie — zgrupowują (coalescing) w okolice granic ticków systemowych.

— W Node/libuv precyzja timerów i planowanie zadań są ograniczone rozdzielczością zegara i obciążeniem event loop. W efekcie odpowiedzi przychodzą w paczkach, a między paczkami pojawiają się dłuższe przerwy → duże odchylenie interwałów (jitter ↑).

1. Narzut request/response na żądanie:

— Każde żądanie HTTP powoduje przejście pełnego stosu (parsowanie nagłówków, routing, serializacja odpowiedzi). Przy N klientach mamy N niezależnych ścieżek — ich czasy są zmienne, co zwiększa rozrzut interwałów.

1. Jednowątkowy event loop i HOL (head-of-line) w userland:

— Node jest jednowątkowy na poziomie JS. W chwili gdy wiele timerów „odpala się” naraz, ich obsługa konkuruje o pętlę zdarzeń. Kolejność i opóźnienia zależą od aktualnych zadań (I/O, GC), co podbija jitter.

1. Sieć/TCP i opóźnienia „na brzegu”:

— Przy krótkich żądaniach HTTP większą rolę odgrywają niedeterministyczne opóźnienia (delayed ACK, Nagle/flush, buforowanie) niż przy utrzymanej sesji WS, gdzie payload jest pushowany w jednym, wspólnym cyklu.

1. Kontrast z WS (broadcast, push):

— WS ma jeden sterownik emisji (stałe Hz). Serwer publikuje raz i zapis trafia na wszystkie gniazda — harmonogram jest spójny, a praca per klient to głównie kopiowanie bufora, nie osobne timery i routing. Interwały są stabilne → jitter niski.

Wniosek: wzrost N w HTTP zwiększa liczbę niezależnych, niedokładnych timerów i ilość pracy w krytycznym momencie, co naturalnie podnosi jitter. W WS wzrost N nie zwiększa liczby „zegarów” — rośnie koszt kopiowania (CPU/RSS/egress), ale nie chaos interwałów.

Jak ograniczać jitter HTTP (praktyka):

- Zwiększ okres odpytywania (mniejsza presja na event loop),
- Desynchronizuj klientów (dodaj losowy offset do startu),
- Użyj keep-alive i minimalizuj obróbkę per request,
- Rozważ SSE/WS, jeśli stabilność i świeżość danych są priorytetem.

### 2c. Checklist analizy wyników (krok po kroku)

1. Dobierz pary porównań: ta sama częstotliwość @Hz i to samo N (klienci).
1. Sprawdź Rate/cli (per użytkownika): czy wartości są porównywalne (±10–15%)?
1. Oceń Jitter (niżej lepiej) i Staleness (niżej = świeżej):

— HTTP przy N≫1 zwykle ma większy jitter; staleness ~ okres odpytywania.

1. Porównaj CPU i RSS (niżej lepiej). Szukaj trendu rosnącego z N.
1. Oceń koszt sieci: Egress est. — dla WS ≈ Rate×Payload×N; dla HTTP ≈ Bytes/s.
1. Zweryfikuj niepewność: CI95/avg < 30% uznaj za stabilne (dla krótkich biegów).
1. Sprawdź „Metrologia (95% CI)” i „Porównania parowane” — czy różnice są spójne i istotne (nakładanie się CI)?

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

Ostatni run: 2025-08-13T16-44-03-768Z

Status: fair payload: TAK, source-limited: NIE, czas: 30s, tick: 200 ms, repeats: 2

Pliki: [sessions.csv](../api/benchmarks/2025-08-13T16-44-03-768Z/sessions.csv), [summary.json](../api/benchmarks/2025-08-13T16-44-03-768Z/summary.json), [README](../api/benchmarks/2025-08-13T16-44-03-768Z/README.md)

Uwaga: tabele uporządkowane wg: Mode (WS, HTTP) → Hz → Obciążenie → Klienci.

Uwaga: Scenariusze z liczbą klientów = 0 mają różną semantykę: WS (push) emituje niezależnie od liczby klientów — per‑client raportujemy Rate/cli = Rate oraz Bytes/cli ≈ Rate×Payload; HTTP (pull) przy 0 klientach nie generuje żądań → pola per‑client są puste (—). Dlatego w porównaniach WS vs HTTP ("Zwycięzcy", tabele WS vs HTTP) wiersze HTTP z N=0 są pomijane.

Uwaga (per klient): kolumny Rate/cli i Bytes/cli pokazują wartości znormalizowane per odbiorcę.

- HTTP: wartości łączne (Rate, Bytes/s) rosną proporcjonalnie do liczby klientów N; per‑client = łączna wartość / N.
- WS (broadcast): Rate/cli ≈ Rate (nie dzielimy przez N); Bytes/cli ≈ Rate × Payload (co odbiera pojedynczy klient). Dla N>0 w pełnej tabeli Bytes/cli może być równoważnie prezentowane jako Bytes/s ÷ N (perspektywa serwera).
- HTTP z N=0: pola per‑client są puste (—).
  Uwaga (WS — egress): kolumna Egress est. szacuje łączny koszt sieci: WS ≈ Rate × Payload × N; HTTP ≈ Bytes/s (już zsumowane po klientach).
  Kluczowe porównania (TL;DR, zwycięzcy, tabele wizualne) stosują Rate/cli: w WS nie dzielimy przez N, w HTTP dzielimy przez N — dzięki temu liczby są porównywalne per użytkownik.

Przykład interpretacji (ostatni run):

- HTTP (c=50): Rate ≈ 49.97/s → Rate/cli ≈ 1.00/s; Bytes/s ≈ 17990 → Bytes/cli ≈ 360
- WS (c=50): Rate ≈ 1.02/s → Rate/cli ≈ 1.02/s; Bytes/s ≈ 368 → Bytes/cli ≈ 368

### TL;DR — szybkie porównanie WS vs HTTP (per klient)

- Porównuj per klienta: Rate/cli i Bytes/cli; WS: Bytes/cli ≈ Rate × Payload; egress ≈ Rate × Payload × N.
- Ten run (średnio): Rate/cli — WS 1.00 /s vs HTTP 0.99 /s; Jitter — WS 2.3 ms vs HTTP 158.2 ms; Staleness — WS 481 ms vs HTTP 482 ms; CPU — WS 28.7% vs HTTP 25.6%.
- Gdy 95% CI (Metrologia) nakładają się, uznawaj różnice za niejednoznaczne.

### Jak interpretować wyniki (protokół rzetelnego porównania)

- Porównuj per klienta: Rate/cli (wyżej = lepiej), Jitter i Staleness (niżej = lepiej), CPU i RSS (niżej = lepiej).
- Uwzględnij niepewność: jeśli 95% CI dwóch wartości mocno się pokrywa, traktuj różnicę jako niepewną.
- Progi praktyczne (szybkie kryteria istotności):
  - Rate/cli: różnica ≥ 10–15% i poza nakładaniem się 95% CI.
  - Jitter/Staleness: różnica ≥ 20% (lub ≥ 50 ms gdy wartości są rzędu setek ms).
  - CPU: różnice < 3–5 pp przy niskich obciążeniach to często szum; > 5–7 pp — potencjalnie istotne.
  - RSS: różnice < 10 MB zwykle pomijalne w tym kontekście, chyba że utrzymują się we wszystkich scenariuszach.
- Spójność: uznaj różnicę za „realną”, jeśli powtarza się w obu powtórzeniach oraz w agregatach „wg obciążenia” i „wg liczby klientów”.
- Semantyka WS vs HTTP: dla kosztu sieci WS oszacuj egress ≈ Rate × Payload × N (na wszystkich klientów); dla HTTP Bytes/s już zawiera sumę po klientach.

| Label                                               |    Mode | Rate/cli [/s] | Bytes/cli [B/s] | Jitter [ms] | Staleness [ms] | CPU [%] | RSS [MB] |
| --------------------------------------------------- | ------: | ------------: | --------------: | ----------: | -------------: | ------: | -------: |
| WS@1Hz payload=360B cWs=1 [rep 1/2]                 |      ws |          1.08 |             388 |         1.6 |            511 |     3.1 |    201.7 |
| WS@1Hz payload=360B cWs=1 [rep 2/2]                 |      ws |          0.99 |             355 |         7.6 |            492 |     1.0 |    184.3 |
| WS@1Hz payload=360B cWs=10 [rep 1/2]                |      ws |          0.99 |             358 |         0.8 |            462 |     1.4 |    185.1 |
| WS@1Hz payload=360B cWs=10 [rep 2/2]                |      ws |          0.99 |             358 |         0.8 |            526 |     1.7 |    185.5 |
| WS@1Hz payload=360B cWs=25 [rep 1/2]                |      ws |          1.00 |             360 |         1.0 |            493 |     2.2 |    193.0 |
| WS@1Hz payload=360B cWs=25 [rep 2/2]                |      ws |          0.99 |             356 |         1.2 |            450 |     2.0 |    194.6 |
| WS@1Hz payload=360B cWs=50 [rep 1/2]                |      ws |          0.97 |             350 |         1.2 |            496 |     8.3 |    198.1 |
| WS@1Hz payload=360B cWs=50 [rep 2/2]                |      ws |          1.01 |             363 |         2.2 |            460 |     5.9 |    207.4 |
| WS@1Hz payload=360B + load=50% cWs=1 [rep 1/2]      |      ws |          0.99 |             358 |         0.9 |            483 |    47.1 |    222.9 |
| WS@1Hz payload=360B + load=50% cWs=1 [rep 2/2]      |      ws |          0.99 |             356 |         5.4 |            508 |    50.7 |    222.3 |
| WS@1Hz payload=360B + load=50% cWs=10 [rep 1/2]     |      ws |          0.98 |             351 |         1.9 |            566 |    51.3 |    220.1 |
| WS@1Hz payload=360B + load=50% cWs=10 [rep 2/2]     |      ws |          0.99 |             357 |         3.1 |            488 |    51.0 |    223.9 |
| WS@1Hz payload=360B + load=50% cWs=25 [rep 1/2]     |      ws |          1.01 |             363 |         1.7 |            401 |    54.8 |    222.8 |
| WS@1Hz payload=360B + load=50% cWs=25 [rep 2/2]     |      ws |          1.00 |             359 |         1.2 |            524 |    56.9 |    223.6 |
| WS@1Hz payload=360B + load=50% cWs=50 [rep 1/2]     |      ws |          1.02 |             368 |         3.3 |            319 |    60.6 |    228.3 |
| WS@1Hz payload=360B + load=50% cWs=50 [rep 2/2]     |      ws |          1.00 |             361 |         3.0 |            517 |    61.9 |    233.0 |
| HTTP@1Hz payload=360B cHttp=1 [rep 1/2]             | polling |          0.98 |             355 |         3.4 |            445 |     1.0 |    184.5 |
| HTTP@1Hz payload=360B cHttp=1 [rep 2/2]             | polling |          1.01 |             364 |         7.7 |            469 |     1.1 |    184.5 |
| HTTP@1Hz payload=360B cHttp=10 [rep 1/2]            | polling |          1.01 |             362 |       293.0 |            485 |     1.2 |    185.6 |
| HTTP@1Hz payload=360B cHttp=10 [rep 2/2]            | polling |          0.99 |             358 |       292.8 |            516 |     1.1 |    185.7 |
| HTTP@1Hz payload=360B cHttp=25 [rep 1/2]            | polling |          1.00 |             358 |       193.3 |            480 |     0.9 |    196.3 |
| HTTP@1Hz payload=360B cHttp=25 [rep 2/2]            | polling |          0.99 |             358 |       192.8 |            452 |     1.2 |    194.4 |
| HTTP@1Hz payload=360B cHttp=50 [rep 1/2]            | polling |          1.00 |             360 |       140.5 |            478 |     1.5 |    210.5 |
| HTTP@1Hz payload=360B cHttp=50 [rep 2/2]            | polling |          1.01 |             364 |       140.1 |            456 |     1.2 |    210.9 |
| HTTP@1Hz payload=360B + load=50% cHttp=1 [rep 1/2]  | polling |          1.00 |             360 |         4.0 |            449 |    49.7 |    222.8 |
| HTTP@1Hz payload=360B + load=50% cHttp=1 [rep 2/2]  | polling |          0.99 |             357 |         8.3 |            470 |    50.3 |    222.0 |
| HTTP@1Hz payload=360B + load=50% cHttp=10 [rep 1/2] | polling |          0.97 |             349 |       293.1 |            510 |    51.9 |    224.0 |
| HTTP@1Hz payload=360B + load=50% cHttp=10 [rep 2/2] | polling |          1.00 |             360 |       294.7 |            431 |    50.0 |    224.0 |
| HTTP@1Hz payload=360B + load=50% cHttp=25 [rep 1/2] | polling |          0.95 |             342 |       193.7 |            518 |    50.3 |    217.9 |
| HTTP@1Hz payload=360B + load=50% cHttp=25 [rep 2/2] | polling |          1.01 |             362 |       193.3 |            485 |    50.9 |    218.2 |
| HTTP@1Hz payload=360B + load=50% cHttp=50 [rep 1/2] | polling |          0.99 |             357 |       140.4 |            500 |    47.3 |    224.6 |
| HTTP@1Hz payload=360B + load=50% cHttp=50 [rep 2/2] | polling |          0.96 |             347 |       140.5 |            565 |    49.2 |    224.6 |

<details>
<summary>Szczegóły (pełna tabela)</summary>

| Label                                               |    Mode | Rate [/s] | Rate/cli [/s] | Bytes/s | Bytes/cli [B/s] | Egress est. [B/s] | ~Payload [B] | Jitter [ms] | Staleness [ms] | ELU p99 [ms] | CPU [%] | RSS [MB] | n (used/total) | Rate OK | Payload OK |
| --------------------------------------------------- | ------: | --------: | ------------: | ------: | --------------: | ----------------: | -----------: | ----------: | -------------: | -----------: | ------: | -------: | :------------: | :-----: | :--------: |
| WS@1Hz payload=360B cWs=1 [rep 1/2]                 |      ws |      1.08 |          1.08 |     388 |             388 |               388 |          360 |         1.6 |            511 |         34.6 |     3.1 |    201.7 |     14/15      |   ✅    |     ✅     |
| WS@1Hz payload=360B cWs=1 [rep 2/2]                 |      ws |      0.99 |          0.99 |     355 |             355 |               355 |          360 |         7.6 |            492 |         33.4 |     1.0 |    184.3 |     14/16      |   ✅    |     ✅     |
| WS@1Hz payload=360B cWs=10 [rep 1/2]                |      ws |      0.99 |          0.99 |     358 |             358 |              3578 |          360 |         0.8 |            462 |         33.6 |     1.4 |    185.1 |     14/16      |   ✅    |     ✅     |
| WS@1Hz payload=360B cWs=10 [rep 2/2]                |      ws |      0.99 |          0.99 |     358 |             358 |              3578 |          360 |         0.8 |            526 |         36.2 |     1.7 |    185.5 |     15/17      |   ✅    |     ✅     |
| WS@1Hz payload=360B cWs=25 [rep 1/2]                |      ws |      1.00 |          1.00 |     360 |             360 |              8989 |          360 |         1.0 |            493 |         35.1 |     2.2 |    193.0 |     14/17      |   ✅    |     ✅     |
| WS@1Hz payload=360B cWs=25 [rep 2/2]                |      ws |      0.99 |          0.99 |     356 |             356 |              8909 |          360 |         1.2 |            450 |         38.7 |     2.0 |    194.6 |     14/16      |   ✅    |     ✅     |
| WS@1Hz payload=360B cWs=50 [rep 1/2]                |      ws |      0.97 |          0.97 |     350 |             350 |             17516 |          360 |         1.2 |            496 |         34.7 |     8.3 |    198.1 |     14/16      |   ✅    |     ✅     |
| WS@1Hz payload=360B cWs=50 [rep 2/2]                |      ws |      1.01 |          1.01 |     363 |             363 |             18156 |          360 |         2.2 |            460 |         34.8 |     5.9 |    207.4 |     15/17      |   ✅    |     ✅     |
| WS@1Hz payload=360B + load=50% cWs=1 [rep 1/2]      |      ws |      0.99 |          0.99 |     358 |             358 |               358 |          360 |         0.9 |            483 |         37.3 |    47.1 |    222.9 |     14/16      |   ✅    |     ✅     |
| WS@1Hz payload=360B + load=50% cWs=1 [rep 2/2]      |      ws |      0.99 |          0.99 |     356 |             356 |               356 |          360 |         5.4 |            508 |         32.5 |    50.7 |    222.3 |     14/17      |   ✅    |     ✅     |
| WS@1Hz payload=360B + load=50% cWs=10 [rep 1/2]     |      ws |      0.98 |          0.98 |     351 |             351 |              3510 |          360 |         1.9 |            566 |         32.8 |    51.3 |    220.1 |     15/17      |   ✅    |     ✅     |
| WS@1Hz payload=360B + load=50% cWs=10 [rep 2/2]     |      ws |      0.99 |          0.99 |     357 |             357 |              3568 |          360 |         3.1 |            488 |         34.4 |    51.0 |    223.9 |     14/16      |   ✅    |     ✅     |
| WS@1Hz payload=360B + load=50% cWs=25 [rep 1/2]     |      ws |      1.01 |          1.01 |     363 |             363 |              9071 |          360 |         1.7 |            401 |         35.1 |    54.8 |    222.8 |     15/17      |   ✅    |     ✅     |
| WS@1Hz payload=360B + load=50% cWs=25 [rep 2/2]     |      ws |      1.00 |          1.00 |     359 |             359 |              8966 |          360 |         1.2 |            524 |         35.0 |    56.9 |    223.6 |     14/17      |   ✅    |     ✅     |
| WS@1Hz payload=360B + load=50% cWs=50 [rep 1/2]     |      ws |      1.02 |          1.02 |     368 |             368 |             18388 |          360 |         3.3 |            319 |         40.3 |    60.6 |    228.3 |     13/16      |   ✅    |     ✅     |
| WS@1Hz payload=360B + load=50% cWs=50 [rep 2/2]     |      ws |      1.00 |          1.00 |     361 |             361 |             18042 |          360 |         3.0 |            517 |         43.4 |    61.9 |    233.0 |     15/17      |   ✅    |     ✅     |
| HTTP@1Hz payload=360B cHttp=1 [rep 1/2]             | polling |      0.98 |          0.98 |     355 |             355 |               355 |          360 |         3.4 |            445 |         33.3 |     1.0 |    184.5 |     14/16      |   ✅    |     ✅     |
| HTTP@1Hz payload=360B cHttp=1 [rep 2/2]             | polling |      1.01 |          1.01 |     364 |             364 |               364 |          360 |         7.7 |            469 |         33.2 |     1.1 |    184.5 |     14/16      |   ✅    |     ✅     |
| HTTP@1Hz payload=360B cHttp=10 [rep 1/2]            | polling |     10.07 |          1.01 |    3623 |             362 |              3623 |          360 |       293.0 |            485 |         35.0 |     1.2 |    185.6 |     14/17      |   ✅    |     ✅     |
| HTTP@1Hz payload=360B cHttp=10 [rep 2/2]            | polling |      9.93 |          0.99 |    3576 |             358 |              3576 |          360 |       292.8 |            516 |         34.7 |     1.1 |    185.7 |     15/17      |   ✅    |     ✅     |
| HTTP@1Hz payload=360B cHttp=25 [rep 1/2]            | polling |     24.88 |          1.00 |    8958 |             358 |              8958 |          360 |       193.3 |            480 |         33.3 |     0.9 |    196.3 |     15/17      |   ✅    |     ✅     |
| HTTP@1Hz payload=360B cHttp=25 [rep 2/2]            | polling |     24.87 |          0.99 |    8952 |             358 |              8952 |          360 |       192.8 |            452 |         36.2 |     1.2 |    194.4 |     15/17      |   ✅    |     ✅     |
| HTTP@1Hz payload=360B cHttp=50 [rep 1/2]            | polling |     49.97 |          1.00 |   17990 |             360 |             17990 |          360 |       140.5 |            478 |         33.8 |     1.5 |    210.5 |     14/17      |   ✅    |     ✅     |
| HTTP@1Hz payload=360B cHttp=50 [rep 2/2]            | polling |     50.55 |          1.01 |   18198 |             364 |             18198 |          360 |       140.1 |            456 |         33.0 |     1.2 |    210.9 |     15/17      |   ✅    |     ✅     |
| HTTP@1Hz payload=360B + load=50% cHttp=1 [rep 1/2]  | polling |      1.00 |          1.00 |     360 |             360 |               360 |          360 |         4.0 |            449 |         33.9 |    49.7 |    222.8 |     14/17      |   ✅    |     ✅     |
| HTTP@1Hz payload=360B + load=50% cHttp=1 [rep 2/2]  | polling |      0.99 |          0.99 |     357 |             357 |               357 |          360 |         8.3 |            470 |         33.0 |    50.3 |    222.0 |     14/17      |   ✅    |     ✅     |
| HTTP@1Hz payload=360B + load=50% cHttp=10 [rep 1/2] | polling |      9.71 |          0.97 |    3494 |             349 |              3494 |          360 |       293.1 |            510 |         33.3 |    51.9 |    224.0 |     15/17      |   ✅    |     ✅     |
| HTTP@1Hz payload=360B + load=50% cHttp=10 [rep 2/2] | polling |     10.01 |          1.00 |    3602 |             360 |              3602 |          360 |       294.7 |            431 |         34.0 |    50.0 |    224.0 |     14/16      |   ✅    |     ✅     |
| HTTP@1Hz payload=360B + load=50% cHttp=25 [rep 1/2] | polling |     23.78 |          0.95 |    8561 |             342 |              8561 |          360 |       193.7 |            518 |         32.9 |    50.3 |    217.9 |     14/17      |   ✅    |     ✅     |
| HTTP@1Hz payload=360B + load=50% cHttp=25 [rep 2/2] | polling |     25.13 |          1.01 |    9047 |             362 |              9047 |          360 |       193.3 |            485 |         33.5 |    50.9 |    218.2 |     15/17      |   ✅    |     ✅     |
| HTTP@1Hz payload=360B + load=50% cHttp=50 [rep 1/2] | polling |     49.59 |          0.99 |   17852 |             357 |             17852 |          360 |       140.4 |            500 |         33.0 |    47.3 |    224.6 |     14/17      |   ✅    |     ✅     |
| HTTP@1Hz payload=360B + load=50% cHttp=50 [rep 2/2] | polling |     48.23 |          0.96 |   17363 |             347 |             17363 |          360 |       140.5 |            565 |         32.7 |    49.2 |    224.6 |     14/17      |   ✅    |     ✅     |

</details>

Parametry przyjęte w ostatnim runie:

- Metody: ws, polling
- Częstotliwości [Hz]: 1
- Obciążenia CPU [%]: 0, 50
- Czas sesji [s]: 30
- MONITOR_TICK_MS: 200
- Payloady: WS=360B, HTTP=360B
- Klienci: clientsHttp=1, clientsWs=1
- Warmup/Cooldown [s]: 2 / 2
- Repeats: 2

## Uśrednione wyniki wg obciążenia

Uwaga: "Obciążenie" oznacza sztuczne obciążenie CPU procesu podczas sesji (generator w worker_threads). Kolumny /cli to normalizacja per odbiorcę (HTTP: suma/N; WS: Rate/cli≈Rate, Bytes/cli≈Rate×Payload).

### Porównanie wg obciążenia — WebSocket

| Obciążenie | Rate/cli [/s] | Bytes/cli [B/s] | Jitter [ms] | Staleness [ms] | CPU [%] | RSS [MB] |
| ---------: | ------------: | --------------: | ----------: | -------------: | ------: | -------: |
|         0% |          1.00 |             361 |         2.0 |            486 |     3.2 |    193.7 |
|        50% |          1.00 |             359 |         2.6 |            476 |    54.3 |    224.6 |

### Porównanie wg obciążenia — HTTP polling

| Obciążenie | Rate/cli [/s] | Bytes/cli [B/s] | Jitter [ms] | Staleness [ms] | CPU [%] | RSS [MB] |
| ---------: | ------------: | --------------: | ----------: | -------------: | ------: | -------: |
|         0% |          1.00 |             360 |       158.0 |            472 |     1.2 |    194.0 |
|        50% |          0.98 |             354 |       158.5 |            491 |    49.9 |    222.2 |

## Uśrednione wyniki wg liczby klientów

Uwaga: "Liczba klientów" to liczba równoległych syntetycznych klientów generowanych wewnętrznie na czas sesji (HTTP: liczbę timerów; WS: efektywną sumaryczną częstość). Kolumny /cli to normalizacja per odbiorcę (HTTP: suma/N; WS: Rate/cli≈Rate, Bytes/cli≈Rate×Payload).

### Zestawienie wg liczby klientów — WebSocket

| Klienci | Rate/cli [/s] | Bytes/cli [B/s] | Jitter [ms] | Staleness [ms] | CPU [%] | RSS [MB] |
| ------: | ------------: | --------------: | ----------: | -------------: | ------: | -------: |
|       1 |          1.01 |             364 |         3.9 |            498 |    25.5 |    207.8 |
|      10 |          0.99 |             356 |         1.6 |            511 |    26.3 |    203.7 |
|      25 |          1.00 |             359 |         1.3 |            467 |    29.0 |    208.5 |
|      50 |          1.00 |             361 |         2.4 |            448 |    34.2 |    216.7 |

### Zestawienie wg liczby klientów — HTTP polling

| Klienci | Rate/cli [/s] | Bytes/cli [B/s] | Jitter [ms] | Staleness [ms] | CPU [%] | RSS [MB] |
| ------: | ------------: | --------------: | ----------: | -------------: | ------: | -------: |
|       1 |          1.00 |             359 |         5.8 |            458 |    25.5 |    203.4 |
|      10 |          0.99 |             357 |       293.4 |            485 |    26.1 |    204.8 |
|      25 |          0.99 |             355 |       193.3 |            484 |    25.8 |    206.7 |
|      50 |          0.99 |             357 |       140.4 |            500 |    24.8 |    217.7 |

## Metrologia (95% CI) — ostatni run

Niepewność średnich estymowana z próbek (tick ~ 200 ms).

| Label                                     | n (used/total) | Rate [/s] | CI95 Rate | CI95/avg | σ(rate) | Median Rate | Bytes/s | CI95 Bytes | CI95/avg | σ(bytes) | Median Bytes |
| ----------------------------------------- | :------------: | --------: | --------: | -------: | ------: | ----------: | ------: | ---------: | -------: | -------: | -----------: |
| WS@1Hz payload=360B cWs=1                 |     14/15      |      1.08 |    ± 0.41 |      38% |    5.06 |        1.11 |     388 |      ± 146 |      38% |     1821 |          400 |
| WS@1Hz payload=360B cWs=1                 |     14/16      |      0.99 |    ± 0.39 |      39% |    0.23 |        1.08 |     355 |      ± 139 |      39% |       83 |          387 |
| WS@1Hz payload=360B cWs=10                |     14/16      |      0.99 |    ± 0.38 |      38% |    0.20 |        1.04 |     358 |      ± 138 |      38% |       71 |          374 |
| WS@1Hz payload=360B cWs=10                |     15/17      |      0.99 |    ± 0.37 |      38% |    0.23 |        1.11 |     358 |      ± 135 |      38% |       84 |          400 |
| WS@1Hz payload=360B cWs=25                |     14/17      |      1.00 |    ± 0.39 |      39% |    0.23 |        1.10 |     360 |      ± 141 |      39% |       83 |          397 |
| WS@1Hz payload=360B cWs=25                |     14/16      |      0.99 |    ± 0.39 |      39% |    0.24 |        1.10 |     356 |      ± 140 |      39% |       86 |          396 |
| WS@1Hz payload=360B cWs=50                |     14/16      |      0.97 |    ± 0.37 |      38% |    0.20 |        1.05 |     350 |      ± 135 |      38% |       70 |          377 |
| WS@1Hz payload=360B cWs=50                |     15/17      |      1.01 |    ± 0.38 |      38% |    0.24 |        1.12 |     363 |      ± 137 |      38% |       86 |          404 |
| WS@1Hz payload=360B + load=50% cWs=1      |     14/16      |      0.99 |    ± 0.39 |      39% |    0.24 |        1.11 |     358 |      ± 140 |      39% |       87 |          401 |
| WS@1Hz payload=360B + load=50% cWs=1      |     14/17      |      0.99 |    ± 0.39 |      39% |    0.24 |        1.10 |     356 |      ± 140 |      39% |       85 |          396 |
| WS@1Hz payload=360B + load=50% cWs=10     |     15/17      |      0.98 |    ± 0.37 |      38% |    0.26 |        1.12 |     351 |      ± 135 |      38% |       93 |          403 |
| WS@1Hz payload=360B + load=50% cWs=10     |     14/16      |      0.99 |    ± 0.39 |      39% |    0.24 |        1.10 |     357 |      ± 140 |      39% |       87 |          398 |
| WS@1Hz payload=360B + load=50% cWs=25     |     15/17      |      1.01 |    ± 0.38 |      38% |    0.24 |        1.13 |     363 |      ± 137 |      38% |       85 |          406 |
| WS@1Hz payload=360B + load=50% cWs=25     |     14/17      |      1.00 |    ± 0.39 |      39% |    0.23 |        1.11 |     359 |      ± 141 |      39% |       84 |          399 |
| WS@1Hz payload=360B + load=50% cWs=50     |     13/16      |      1.02 |    ± 0.40 |      39% |    0.16 |        1.08 |     368 |      ± 144 |      39% |       58 |          387 |
| WS@1Hz payload=360B + load=50% cWs=50     |     15/17      |      1.00 |    ± 0.38 |      38% |    0.23 |        1.11 |     361 |      ± 136 |      38% |       83 |          399 |
| HTTP@1Hz payload=360B cHttp=1             |     14/16      |      0.98 |    ± 0.39 |      39% |    0.24 |        1.10 |     355 |      ± 139 |      39% |       85 |          395 |
| HTTP@1Hz payload=360B cHttp=1             |     14/16      |      1.01 |    ± 0.39 |      38% |    0.20 |        1.08 |     364 |      ± 140 |      38% |       71 |          389 |
| HTTP@1Hz payload=360B cHttp=10            |     14/17      |     10.07 |    ± 1.28 |      13% |    2.44 |       11.22 |    3623 |      ± 461 |      13% |      880 |         4038 |
| HTTP@1Hz payload=360B cHttp=10            |     15/17      |      9.93 |    ± 1.13 |      11% |    2.23 |       11.02 |    3576 |      ± 407 |      11% |      805 |         3966 |
| HTTP@1Hz payload=360B cHttp=25            |     15/17      |     24.88 |    ± 2.88 |      12% |    5.69 |       27.69 |    8958 |     ± 1036 |      12% |     2048 |         9969 |
| HTTP@1Hz payload=360B cHttp=25            |     15/17      |     24.87 |    ± 2.86 |      11% |    5.64 |       27.50 |    8952 |     ± 1028 |      11% |     2031 |         9899 |
| HTTP@1Hz payload=360B cHttp=50            |     14/17      |     49.97 |    ± 6.25 |      13% |   11.93 |       55.69 |   17990 |     ± 2249 |      13% |     4293 |        20050 |
| HTTP@1Hz payload=360B cHttp=50            |     15/17      |     50.55 |    ± 5.89 |      12% |   11.64 |       55.47 |   18198 |     ± 2120 |      12% |     4190 |        19969 |
| HTTP@1Hz payload=360B + load=50% cHttp=1  |     14/17      |      1.00 |    ± 0.39 |      39% |    0.24 |        1.12 |     360 |      ± 141 |      39% |       88 |          404 |
| HTTP@1Hz payload=360B + load=50% cHttp=1  |     14/17      |      0.99 |    ± 0.39 |      39% |    0.24 |        1.10 |     357 |      ± 140 |      39% |       85 |          398 |
| HTTP@1Hz payload=360B + load=50% cHttp=10 |     15/17      |      9.71 |    ± 1.30 |      13% |    2.58 |       11.08 |    3494 |      ± 469 |      13% |      927 |         3990 |
| HTTP@1Hz payload=360B + load=50% cHttp=10 |     14/16      |     10.01 |    ± 1.26 |      13% |    2.40 |       11.19 |    3602 |      ± 452 |      13% |      863 |         4030 |
| HTTP@1Hz payload=360B + load=50% cHttp=25 |     14/17      |     23.78 |    ± 3.43 |      14% |    6.54 |       27.60 |    8561 |     ± 1234 |      14% |     2355 |         9938 |
| HTTP@1Hz payload=360B + load=50% cHttp=25 |     15/17      |     25.13 |    ± 2.93 |      12% |    5.79 |       27.74 |    9047 |     ± 1054 |      12% |     2083 |         9988 |
| HTTP@1Hz payload=360B + load=50% cHttp=50 |     14/17      |     49.59 |    ± 6.13 |      12% |   11.71 |       54.98 |   17852 |     ± 2207 |      12% |     4214 |        19794 |
| HTTP@1Hz payload=360B + load=50% cHttp=50 |     14/17      |     48.23 |    ± 6.78 |      14% |   12.94 |       55.47 |   17363 |     ± 2440 |      14% |     4657 |        19968 |

## E2E latency (źródło→ingest→emit) [ms]

| Label                                     | Src→Ingest avg | Src→Ingest p95 | Ingest→Emit avg | Ingest→Emit p95 | Src→Emit avg | Src→Emit p95 |
| ----------------------------------------- | -------------: | -------------: | --------------: | --------------: | -----------: | -----------: |
| WS@1Hz payload=360B cWs=1                 |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| WS@1Hz payload=360B cWs=1                 |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| WS@1Hz payload=360B cWs=10                |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| WS@1Hz payload=360B cWs=10                |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| WS@1Hz payload=360B cWs=25                |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| WS@1Hz payload=360B cWs=25                |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| WS@1Hz payload=360B cWs=50                |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| WS@1Hz payload=360B cWs=50                |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| WS@1Hz payload=360B + load=50% cWs=1      |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| WS@1Hz payload=360B + load=50% cWs=1      |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| WS@1Hz payload=360B + load=50% cWs=10     |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| WS@1Hz payload=360B + load=50% cWs=10     |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| WS@1Hz payload=360B + load=50% cWs=25     |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| WS@1Hz payload=360B + load=50% cWs=25     |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| WS@1Hz payload=360B + load=50% cWs=50     |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| WS@1Hz payload=360B + load=50% cWs=50     |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| HTTP@1Hz payload=360B cHttp=1             |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| HTTP@1Hz payload=360B cHttp=1             |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| HTTP@1Hz payload=360B cHttp=10            |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| HTTP@1Hz payload=360B cHttp=10            |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| HTTP@1Hz payload=360B cHttp=25            |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| HTTP@1Hz payload=360B cHttp=25            |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| HTTP@1Hz payload=360B cHttp=50            |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| HTTP@1Hz payload=360B cHttp=50            |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| HTTP@1Hz payload=360B + load=50% cHttp=1  |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| HTTP@1Hz payload=360B + load=50% cHttp=1  |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| HTTP@1Hz payload=360B + load=50% cHttp=10 |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| HTTP@1Hz payload=360B + load=50% cHttp=10 |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| HTTP@1Hz payload=360B + load=50% cHttp=25 |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| HTTP@1Hz payload=360B + load=50% cHttp=25 |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| HTTP@1Hz payload=360B + load=50% cHttp=50 |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |
| HTTP@1Hz payload=360B + load=50% cHttp=50 |            0.0 |            0.0 |             0.0 |             0.0 |          0.0 |          0.0 |

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

## Porównania parowane (WS vs HTTP, per klient, z Δ i istotnością)

Legenda: Δ% = (WS−HTTP)/HTTP·100%; Istotność (95% CI): "sig" gdy przedziały [mean±CI] dla Rate/cli nie nachodzą się (dla HTTP CI skalowane 1/N).

| Scenariusz | Rate/cli WS [/s] | Rate/cli HTTP [/s] | Δ Rate/cli [%] | Istotność (95% CI) | Jitter WS [ms] | Jitter HTTP [ms] | Δ Jitter [%] | Staleness WS [ms] | Staleness HTTP [ms] | Δ Stal. [%] | CPU WS [%] | CPU HTTP [%] | Δ CPU [pp] | RSS WS [MB] | RSS HTTP [MB] | Δ RSS [MB] |
| ---------- | ---------------: | -----------------: | -------------: | :----------------: | -------------: | ---------------: | -----------: | ----------------: | ------------------: | ----------: | ---------: | -----------: | ---------: | ----------: | ------------: | ---------- | ----- | ---- |
| Hz=1       |           Load=0 |          Clients=1 |           0.99 |        1.01        |            -2% |               ns |          7.6 |               7.7 |                 -2% |         492 |        469 |           5% |        1.0 |         1.1 |          -0.1 | 184.3      | 184.5 | -0.1 |
| Hz=1       |           Load=0 |         Clients=10 |           0.99 |        0.99        |             0% |               ns |          0.8 |             292.8 |               -100% |         526 |        516 |           2% |        1.7 |         1.1 |           0.5 | 185.5      | 185.7 | -0.2 |
| Hz=1       |           Load=0 |         Clients=25 |           0.99 |        0.99        |            -0% |               ns |          1.2 |             192.8 |                -99% |         450 |        452 |          -1% |        2.0 |         1.2 |           0.8 | 194.6      | 194.4 | 0.2  |
| Hz=1       |           Load=0 |         Clients=50 |           1.01 |        1.01        |            -0% |               ns |          2.2 |             140.1 |                -98% |         460 |        456 |           1% |        5.9 |         1.2 |           4.7 | 207.4      | 210.9 | -3.6 |
| Hz=1       |          Load=50 |          Clients=1 |           0.99 |        0.99        |            -0% |               ns |          5.4 |               8.3 |                -35% |         508 |        470 |           8% |       50.7 |        50.3 |           0.4 | 222.3      | 222.0 | 0.3  |
| Hz=1       |          Load=50 |         Clients=10 |           0.99 |        1.00        |            -1% |               ns |          3.1 |             294.7 |                -99% |         488 |        431 |          13% |       51.0 |        50.0 |           1.0 | 223.9      | 224.0 | -0.1 |
| Hz=1       |          Load=50 |         Clients=25 |           1.00 |        1.01        |            -1% |               ns |          1.2 |             193.3 |                -99% |         524 |        485 |           8% |       56.9 |        50.9 |           5.9 | 223.6      | 218.2 | 5.5  |
| Hz=1       |          Load=50 |         Clients=50 |           1.00 |        0.96        |             4% |               ns |          3.0 |             140.5 |                -98% |         517 |        565 |          -8% |       61.9 |        49.2 |          12.8 | 233.0      | 224.6 | 8.4  |

## Wnioski (syntetyczne)

- WS@1Hz payload=360B cWs=1 [rep 1/2]: rate=1.08 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B cWs=1 [rep 2/2]: rate=0.99 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B cWs=10 [rep 1/2]: rate=0.99 in [0.50, 1.50] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B cWs=10 [rep 2/2]: rate=0.99 in [0.50, 1.50] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B cWs=25 [rep 1/2]: rate=1.00 in [0.50, 1.50] (c=25); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B cWs=25 [rep 2/2]: rate=0.99 in [0.50, 1.50] (c=25); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B cWs=50 [rep 1/2]: rate=0.97 in [0.50, 1.50] (c=50); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B cWs=50 [rep 2/2]: rate=1.01 in [0.50, 1.50] (c=50); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B + load=50% cWs=1 [rep 1/2]: rate=0.99 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B + load=50% cWs=1 [rep 2/2]: rate=0.99 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B + load=50% cWs=10 [rep 1/2]: rate=0.98 in [0.50, 1.50] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B + load=50% cWs=10 [rep 2/2]: rate=0.99 in [0.50, 1.50] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B + load=50% cWs=25 [rep 1/2]: rate=1.01 in [0.50, 1.50] (c=25); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B + load=50% cWs=25 [rep 2/2]: rate=1.00 in [0.50, 1.50] (c=25); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B + load=50% cWs=50 [rep 1/2]: rate=1.02 in [0.50, 1.50] (c=50); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- WS@1Hz payload=360B + load=50% cWs=50 [rep 2/2]: rate=1.00 in [0.50, 1.50] (c=50); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B cHttp=1 [rep 1/2]: rate=0.98 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B cHttp=1 [rep 2/2]: rate=1.01 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B cHttp=10 [rep 1/2]: rate=10.07 in [5.00, 15.00] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B cHttp=10 [rep 2/2]: rate=9.93 in [5.00, 15.00] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B cHttp=25 [rep 1/2]: rate=24.88 in [12.50, 37.50] (c=25); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B cHttp=25 [rep 2/2]: rate=24.87 in [12.50, 37.50] (c=25); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B cHttp=50 [rep 1/2]: rate=49.97 in [25.00, 75.00] (c=50); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B cHttp=50 [rep 2/2]: rate=50.55 in [25.00, 75.00] (c=50); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B + load=50% cHttp=1 [rep 1/2]: rate=1.00 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B + load=50% cHttp=1 [rep 2/2]: rate=0.99 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B + load=50% cHttp=10 [rep 1/2]: rate=9.71 in [5.00, 15.00] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B + load=50% cHttp=10 [rep 2/2]: rate=10.01 in [5.00, 15.00] (c=10); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B + load=50% cHttp=25 [rep 1/2]: rate=23.78 in [12.50, 37.50] (c=25); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B + load=50% cHttp=25 [rep 2/2]: rate=25.13 in [12.50, 37.50] (c=25); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B + load=50% cHttp=50 [rep 1/2]: rate=49.59 in [25.00, 75.00] (c=50); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)
- HTTP@1Hz payload=360B + load=50% cHttp=50 [rep 2/2]: rate=48.23 in [25.00, 75.00] (c=50); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=2s, cooldown=2s)

## Walidacja wiarygodności i poprawności

Brak pliku validation.txt dla ostatniego runu.

- Rate OK: 100% (32/32)
- Payload OK: 100% (32/32)
- Minimalna liczba próbek n(used): 13
- Średni względny CI95: Rate ≈ 29%, Bytes/s ≈ 29%

Uwaga: FAIL wynika głównie z odchyleń Rate od oczekiwanych Hz. To spodziewane, jeśli źródło danych (Arduino/MQTT) publikuje ~1 Hz niezależnie od ustawień nominalnych. Payload przechodzi (OK) we wszystkich scenariuszach.

## Zwycięzcy (per scenariusz)

Dla każdej kombinacji Hz/obciążenia/liczby klientów wskazano najlepszą metodę w kluczowych kategoriach.

### Zwycięzcy — Hz=1|Load=0|Clients=1

- Częstość [#/s] (per klient): WS (WS@1Hz payload=360B cWs=1) (≈ 1.08)
- Jitter [ms]: WS (WS@1Hz payload=360B cWs=1) (≈ 1.6)
- Staleness [ms]: POLLING (HTTP@1Hz payload=360B cHttp=1) (≈ 445.2)
- CPU [%]: POLLING (HTTP@1Hz payload=360B cHttp=1) (≈ 1.0)
- RSS [MB]: WS (WS@1Hz payload=360B cWs=1) (≈ 184.3)

### Zwycięzcy — Hz=1|Load=0|Clients=10

- Częstość [#/s] (per klient): POLLING (HTTP@1Hz payload=360B cHttp=10) (≈ 1.01)
- Jitter [ms]: WS (WS@1Hz payload=360B cWs=10) (≈ 0.8)
- Staleness [ms]: WS (WS@1Hz payload=360B cWs=10) (≈ 462.1)
- CPU [%]: POLLING (HTTP@1Hz payload=360B cHttp=10) (≈ 1.1)
- RSS [MB]: WS (WS@1Hz payload=360B cWs=10) (≈ 185.1)

### Zwycięzcy — Hz=1|Load=0|Clients=25

- Częstość [#/s] (per klient): WS (WS@1Hz payload=360B cWs=25) (≈ 1.00)
- Jitter [ms]: WS (WS@1Hz payload=360B cWs=25) (≈ 1.0)
- Staleness [ms]: WS (WS@1Hz payload=360B cWs=25) (≈ 449.9)
- CPU [%]: POLLING (HTTP@1Hz payload=360B cHttp=25) (≈ 0.9)
- RSS [MB]: WS (WS@1Hz payload=360B cWs=25) (≈ 193.0)

### Zwycięzcy — Hz=1|Load=0|Clients=50

- Częstość [#/s] (per klient): POLLING (HTTP@1Hz payload=360B cHttp=50) (≈ 1.01)
- Jitter [ms]: WS (WS@1Hz payload=360B cWs=50) (≈ 1.2)
- Staleness [ms]: POLLING (HTTP@1Hz payload=360B cHttp=50) (≈ 456.1)
- CPU [%]: POLLING (HTTP@1Hz payload=360B cHttp=50) (≈ 1.2)
- RSS [MB]: WS (WS@1Hz payload=360B cWs=50) (≈ 198.1)

### Zwycięzcy — Hz=1|Load=50|Clients=1

- Częstość [#/s] (per klient): POLLING (HTTP@1Hz payload=360B + load=50% cHttp=1) (≈ 1.00)
- Jitter [ms]: WS (WS@1Hz payload=360B + load=50% cWs=1) (≈ 0.9)
- Staleness [ms]: POLLING (HTTP@1Hz payload=360B + load=50% cHttp=1) (≈ 448.6)
- CPU [%]: WS (WS@1Hz payload=360B + load=50% cWs=1) (≈ 47.1)
- RSS [MB]: POLLING (HTTP@1Hz payload=360B + load=50% cHttp=1) (≈ 222.0)

### Zwycięzcy — Hz=1|Load=50|Clients=10

- Częstość [#/s] (per klient): POLLING (HTTP@1Hz payload=360B + load=50% cHttp=10) (≈ 1.00)
- Jitter [ms]: WS (WS@1Hz payload=360B + load=50% cWs=10) (≈ 1.9)
- Staleness [ms]: POLLING (HTTP@1Hz payload=360B + load=50% cHttp=10) (≈ 431.2)
- CPU [%]: POLLING (HTTP@1Hz payload=360B + load=50% cHttp=10) (≈ 50.0)
- RSS [MB]: WS (WS@1Hz payload=360B + load=50% cWs=10) (≈ 220.1)

### Zwycięzcy — Hz=1|Load=50|Clients=25

- Częstość [#/s] (per klient): WS (WS@1Hz payload=360B + load=50% cWs=25) (≈ 1.01)
- Jitter [ms]: WS (WS@1Hz payload=360B + load=50% cWs=25) (≈ 1.2)
- Staleness [ms]: WS (WS@1Hz payload=360B + load=50% cWs=25) (≈ 400.6)
- CPU [%]: POLLING (HTTP@1Hz payload=360B + load=50% cHttp=25) (≈ 50.3)
- RSS [MB]: POLLING (HTTP@1Hz payload=360B + load=50% cHttp=25) (≈ 217.9)

### Zwycięzcy — Hz=1|Load=50|Clients=50

- Częstość [#/s] (per klient): WS (WS@1Hz payload=360B + load=50% cWs=50) (≈ 1.02)
- Jitter [ms]: WS (WS@1Hz payload=360B + load=50% cWs=50) (≈ 3.0)
- Staleness [ms]: WS (WS@1Hz payload=360B + load=50% cWs=50) (≈ 318.8)
- CPU [%]: POLLING (HTTP@1Hz payload=360B + load=50% cHttp=50) (≈ 47.3)
- RSS [MB]: POLLING (HTTP@1Hz payload=360B + load=50% cHttp=50) (≈ 224.6)

### Podsumowanie globalne (średnio)

- Rate/cli: WS 1.00 /s vs HTTP 0.99 /s
- Jitter: WS 2.3 ms vs HTTP 158.2 ms (niżej lepiej)
- Staleness: WS 481 ms vs HTTP 482 ms (niżej lepiej)
- CPU: WS 28.7% vs HTTP 25.6% (niżej lepiej)
- RSS: WS 209.2 MB vs HTTP 208.1 MB (niżej lepiej)

## Wnioski — wizualne porównanie

### Wnioski — porównanie WS vs HTTP wg obciążenia (Rate/cli)

Legenda: Pogrubienia oznaczają korzystniejszą wartość w danej kolumnie (niżej/lepiej lub wyżej/lepiej zgodnie z metryką). Rate/cli — metryka znormalizowana per odbiorcę.

| Obciążenie [%] | Rate/cli WS [/s] | Rate/cli HTTP [/s] | Δ Rate/cli [%] | Jitter WS [ms] | Jitter HTTP [ms] | Staleness WS [ms] | Staleness HTTP [ms] | ELU p99 WS [ms] | ELU p99 HTTP [ms] | CPU WS [%] | CPU HTTP [%] | RSS WS [MB] | RSS HTTP [MB] |
| -------------: | ---------------: | -----------------: | -------------: | -------------: | ---------------: | ----------------: | ------------------: | --------------: | ----------------: | ---------: | -----------: | ----------: | ------------: |
|              0 |         **1.00** |               1.00 |             0% |        **2.0** |            158.0 |               486 |             **472** |            35.1 |          **34.1** |        3.2 |      **1.2** |   **193.7** |         194.0 |
|             50 |         **1.00** |               0.98 |             1% |        **2.6** |            158.5 |           **476** |                 491 |            36.4 |          **33.3** |       54.3 |     **49.9** |       224.6 |     **222.2** |

### Wnioski — porównanie WS vs HTTP wg liczby klientów (Rate/cli)

Legenda: Pogrubienia oznaczają korzystniejszą wartość w danej kolumnie (niżej/lepiej lub wyżej/lepiej zgodnie z metryką). Rate/cli — metryka znormalizowana per odbiorcę.

| Klienci | Rate/cli WS [/s] | Rate/cli HTTP [/s] | Δ Rate/cli [%] | Jitter WS [ms] | Jitter HTTP [ms] | Staleness WS [ms] | Staleness HTTP [ms] | ELU p99 WS [ms] | ELU p99 HTTP [ms] | CPU WS [%] | CPU HTTP [%] | RSS WS [MB] | RSS HTTP [MB] |
| ------: | ---------------: | -----------------: | -------------: | -------------: | ---------------: | ----------------: | ------------------: | --------------: | ----------------: | ---------: | -----------: | ----------: | ------------: |
|       1 |         **1.01** |               1.00 |             2% |        **3.9** |              5.8 |               498 |             **458** |            34.4 |          **33.3** |   **25.5** |         25.5 |       207.8 |     **203.4** |
|      10 |             0.99 |           **0.99** |            -0% |        **1.6** |            293.4 |               511 |             **485** |            34.3 |          **34.2** |       26.3 |     **26.1** |   **203.7** |         204.8 |
|      25 |         **1.00** |               0.99 |             1% |        **1.3** |            193.3 |           **467** |                 484 |            36.0 |          **34.0** |       29.0 |     **25.8** |       208.5 |     **206.7** |
|      50 |         **1.00** |               0.99 |             1% |        **2.4** |            140.4 |           **448** |                 500 |            38.3 |          **33.1** |       34.2 |     **24.8** |   **216.7** |         217.7 |

### Wnioski — krótkie podsumowanie (WS vs HTTP)

- Średnio (ten run): Rate/cli — WS 1.00 /s vs HTTP 0.99 /s
- Średnio: Jitter — WS 2.3 ms vs HTTP 158.2 ms (niżej = stabilniej)
- Średnio: Staleness — WS 481 ms vs HTTP 482 ms (niżej = świeżej)
- Średnio: CPU — WS 28.7% vs HTTP 25.6% (niżej = lżej)

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
