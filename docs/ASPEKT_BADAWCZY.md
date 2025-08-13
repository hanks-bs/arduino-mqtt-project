# Aspekt badawczy – skrót dokumentacji

Poniżej zebrano zwięzły opis części badawczej projektu: cele, metodologia, metryki, procedury pomiarowe, kryteria oceny oraz mapowanie wyników na dashboard. Dokument opisuje, jak replikować oraz interpretować wyniki.

Odnośniki skrócone: [Glosariusz terminów](./GLOSARIUSZ.md) • [Plan badań](./RESEARCH_PLAN.md) • [Hipotezy](./RESEARCH_HYPOTHESES.md)

## Interpretacja w 10 sekund

- Porównujemy WS (push) vs HTTP (polling) w kategoriach: świeżość (Staleness), stabilność (Jitter), koszty (CPU, Bytes/s), skalowanie (klienci), presja na event loop (EL delay p99 / ELU).
- Fairness: porównuj pary o tym samym nominalnym Hz i payloadzie (sprawdź flagi fair payload, source-limited).
- Per‑client normalizacja: HTTP dzielimy przez N; WS – Rate/cli = Rate, Bytes/cli = Rate×Payload.
- Istotność: szerokość CI95 / średnia < 30% → metryka stabilna; nakładające się CI → różnica niejednoznaczna.
- Gdy Staleness ≈ 1000 ms mimo Hz>1 → ogranicza źródło (source-limited) – ocena Rate jest drugorzędna.
- Jitter duży w HTTP przy wielu klientach = zgrupowania timerów; WS zachowuje niski jitter (pojedynczy harmonogram emisji).

Szybka replikacja (TL;DR):

1. `cd api && yarn install`
1. Uruchom broker/API/klienta: `docker compose up -d --build` (lub lokalnie)
1. Wyłącz emisje live: `POST /api/monitor/live-emit { enabled:false }` (jeśli chcesz izolować)
1. `yarn measure` lub profilowany skrót (`npm run research:full`)
1. `yarn docs:research:update` aktualizuje sekcję AUTO-RESULTS.

W dalszych sekcjach podkreślono warunki rzetelnego porównania i sposób liczenia niepewności.

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

### 2d. Metodologia statystyczna (formuły i założenia)

Niepewność podajemy jako 95% CI dla średnich sesyjnych (po ewentualnym trimowaniu warmup/cooldown).

Definicje na zbiorze n próbek (równomiernie ważonych po trimie). Uproszczenia: próbki traktujemy jako (w przybliżeniu) niezależne w skali jednego ticka monitora – rzeczywista autokorelacja może zawyżać efektywną niepewność (szersze realne CI).

- Średnia: $\bar{x} = \frac{1}{n} \sum_{i=1}^{n} x_i$
- Odchylenie std: $s = \sqrt{\frac{1}{n-1} \sum_{i=1}^{n} (x_i-\bar{x})^2}$
- Błąd standardowy: $SE = \frac{s}{\sqrt{n}}$
- 95% CI (aproks. normalna przy $n\ge 8$): $CI_{95} = 1.96\cdot SE$ → raportujemy jako `± CI95`.

Jeśli n < 8 CI traktuj orientacyjnie (rozrzut może nie być dobrze oszacowany). W raportach safe/quick n bywa małe — dlatego zalecane są powtórzenia (`repeats ≥2`) i dłuższe biegi dla finalnych wniosków. Wartości per-client wynikają z deterministycznej transformacji (dzielenie przez N lub kopiowanie wsRate), więc nie liczymy dla nich osobnych CI (redundancja).

Źródła możliwych błędów:

- Małe n → szerokie CI i niestabilność median / p95.
- Korelacja sąsiednich próbek (tick << charakterystyczny czas zmian) obniża efektywną liczebność (nie korygujemy — uproszczenie).
- Źródło „source-limited” (tempo Arduino/MQTT < nominalnych Hz) zaniża Rate i może zniekształcać porównania — wtedy interpretuj CPU/jitter/staleness, ale nie surowy Rate.

Planowane rozszerzenia (przyszłe): test różnic dwóch średnich (np. t lub bootstrap) oraz estymacja efektu (np. różnica względna + CI) zamiast heurystyki nakładania się przedziałów.

Uzasadnienie użycia normalnej aproksymacji: Centralne Twierdzenie Graniczne zapewnia zbieżność rozkładu średniej do normalnego przy rosnącym n; dla n ≥ ~8–10 i braku silnych outlierów stosujemy faktor 1.96. Dla bardzo małych prób (n<8) przedział traktujemy orientacyjnie (oznaczamy szerokie CI lub ostrzeżenie w walidacji).

### 2e. Warunki rzetelnego porównania (fairness protocol)

Aby porównanie WS vs HTTP było interpretowalne:

1. Ten sam nominalny payload (B) i porównywalny Rate/cli (po normalizacji).
1. Wyłączone lub jednakowo skonfigurowane emisje uboczne (`arduinoData`, `metrics`) podczas pomiarów porównawczych.
1. Jednolity `MONITOR_TICK_MS` i odcięcia warmup/cooldown (albo =0 po obu stronach).
1. Brak zmian konfiguracji systemowej między metodami w obrębie pary (CPU load, liczba klientów).
1. Weryfikacja `fairPayload` i `sourceLimited` (obie flagi powinny być `TAK`/`NIE` symetrycznie — inaczej uważaj przy interpretacji Rate).
1. Normalizacja „per klient” stosowana konsekwentnie: HTTP dzielone przez N, WS — nie dzielone w Rate (broadcast), Bytes/cli = Rate×Payload.
1. Analiza powtórzeń: różnice istotne tylko gdy spójne w każdym rep i w zestawieniach wg obciążenia/klientów.

Jeśli którykolwiek warunek naruszony, wynik traktuj jako eksploracyjny.

### 2f. Instrumentacja E2E (source → ingest → emit)

Definicje znaczków czasowych wykorzystywanych do metryk latencji end‑to‑end:

- sourceTsMs — chwila „źródła” (czas publikacji danych z Arduino / syntetyczny driver ustawia timestamp).
- ingestTsMs — moment przyjęcia/przetworzenia danych przez warstwę API (np. po odbiorze MQTT lub tuż przed przygotowaniem odpowiedzi HTTP).
- emitTsMs — moment faktycznej emisji do klienta (wysłanie wsMsg lub zakończenie odpowiedzi HTTP).

Wyznaczane metryki:

- Ingest E2E [ms] = ingestTsMs − sourceTsMs (transport + kolejka do API),
- Emit E2E [ms] = emitTsMs − sourceTsMs (pełna ścieżka do wypchnięcia/odpowiedzi).

W trybach syntetycznych (sterownik WS / syntetyczny polling) symulujemy minimalne opóźnienia (1–3 ms) aby uzyskać niezerową dystrybucję i CI95, nie zaniżając innych metryk. Przy realnym Arduino/MQTT opóźnienia te będą odzwierciedlały faktyczne czasy przepływu (transport szeregowy, broker, kolejkowanie event loop, emisja).  
Jeśli brak któregokolwiek znacznika (np. puste serie) raport pokazuje „0” (lub w przyszłości „—” po dodaniu guardów) – interpretuj wtedy jako: brak danych, a nie rzeczywiste zero.

Uwagi metodologiczne:

- Krótkie przebiegi i małe n powodują wąskie lub zerowe CI przy bardzo spójnych (syntetycznych) opóźnieniach — to oczekiwane.
- Dla analiz porównawczych ws vs HTTP latencje E2E w środowisku syntetycznym mają mniejszą wagę niż jitter i staleness (te ostatnie lepiej różnicują protokoły).
- Przy przejściu na realny strumień warto zebrać dłuższe serie (≥30 próbek) by CI były bardziej reprezentatywne.

Teoretycznie jitter (odchylenie inter‑arrival) i staleness (wiek danych) to różne aspekty: (1) jitter mierzy stabilność interwałów; (2) staleness mierzy opóźnienie od źródła do konsumenta. Protokół push minimalizuje staleness, ale może mieć niewielki jitter gdy nadaje z jednego zegara. Polling ogranicza minimalne staleness do długości swojego interwału i wprowadza jitter głównie przez koalescencję timerów oraz scheduling.

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

Ostatni run: 2025-08-13T20-03-10-396Z

Status: fair payload: TAK, source-limited: NIE, czas: 6s, tick: 500 ms, repeats: 1

Pliki: [sessions.csv](../api/benchmarks/2025-08-13T20-03-10-396Z/sessions.csv), [summary.json](../api/benchmarks/2025-08-13T20-03-10-396Z/summary.json), [README](../api/benchmarks/2025-08-13T20-03-10-396Z/README.md)

Uwaga: tabele uporządkowane wg: Mode (WS, HTTP) → Hz → Obciążenie → Klienci.

Uwaga (SAFE): krótki przebieg 0.5–1 Hz bez obciążenia; walidacja odchyleń Rate oznaczana jako WARN (nie FAIL), by unikać fałszywych negatywów przy małym n.
Uwaga: Scenariusze z liczbą klientów = 0 mają różną semantykę: WS (push) emituje niezależnie od liczby klientów — per‑client raportujemy Rate/cli = Rate oraz Bytes/cli ≈ Rate×Payload; HTTP (pull) przy 0 klientach nie generuje żądań → pola per‑client są puste (—). Dlatego w porównaniach WS vs HTTP ("Zwycięzcy", tabele WS vs HTTP) wiersze HTTP z N=0 są pomijane.

Uwaga (per klient): kolumny Rate/cli i Bytes/cli pokazują wartości znormalizowane per odbiorcę.

- HTTP: wartości łączne (Rate, Bytes/s) rosną proporcjonalnie do liczby klientów N; per‑client = łączna wartość / N.
- WS (broadcast): Rate/cli ≈ Rate (nie dzielimy przez N); Bytes/cli ≈ Rate × Payload (co odbiera pojedynczy klient). Dla N>0 w pełnej tabeli Bytes/cli może być równoważnie prezentowane jako Bytes/s ÷ N (perspektywa serwera).
- HTTP z N=0: pola per‑client są puste (—).
  Uwaga (WS — egress): kolumna Egress est. szacuje łączny koszt sieci: WS ≈ Rate × Payload × N; HTTP ≈ Bytes/s (już zsumowane po klientach).
  Kluczowe porównania (TL;DR, zwycięzcy, tabele wizualne) stosują Rate/cli: w WS nie dzielimy przez N, w HTTP dzielimy przez N — dzięki temu liczby są porównywalne per użytkownik.

### Jak interpretować wyniki (protokół rzetelnego porównania)

- Porównuj per klienta: Rate/cli (wyżej = lepiej), Jitter i Staleness (niżej = lepiej), CPU i RSS (niżej = lepiej).
- Uwzględnij niepewność: jeśli 95% CI dwóch wartości mocno się pokrywa, traktuj różnicę jako niepewną.
- Progi praktyczne (szybkie kryteria istotności):
  - Rate/cli: różnica ≥ 10–15% i poza nakładaniem się 95% CI.
  - Jitter/Staleness: różnica ≥ 20% (lub ≥ 50 ms gdy wartości są rzędu setek ms).
  - CPU: różnice < 3–5 pp przy niskich obciążeniach to często szum; > 5–7 pp — potencjalnie istotne.
  - RSS: różnice < 10 MB zwykle pomijalne w tym kontekście, chyba że utrzymują się we wszystkich scenariuszach.
- Spójność: uznaj różnicę za „realną”, jeśli powtarza się w obu powtórzeniach oraz w zestawieniach „wg obciążenia” i „wg liczby klientów”.
- Semantyka WS vs HTTP: dla kosztu sieci WS oszacuj egress ≈ Rate × Payload × N (na wszystkich klientów); dla HTTP Bytes/s już zawiera sumę po klientach.

| Label                           |    Mode | Rate/cli [/s] | Bytes/cli [B/s] | Jitter [ms] | Staleness [ms] | CPU [%] | RSS [MB] |
| ------------------------------- | ------: | ------------: | --------------: | ----------: | -------------: | ------: | -------: |
| WS@1Hz payload=360B [rep 1/1]   |      ws |          1.30 |             467 |         3.6 |            417 |     1.8 |    209.0 |
| HTTP@1Hz payload=360B [rep 1/1] | polling |          1.41 |             508 |         2.9 |            312 |     2.1 |    209.1 |

<!-- markdownlint-disable MD033 -->
<details>
<summary>Szczegóły (pełna tabela)</summary>

| Label                           |    Mode | Rate [/s] | Rate/cli [/s] | Bytes/s | Bytes/cli [B/s] | Egress est. [B/s] | ~Payload [B] | Jitter [ms] | Staleness [ms] | ELU p99 [ms] | CPU [%] | RSS [MB] | n (used/total) | Rate OK | Payload OK |
| ------------------------------- | ------: | --------: | ------------: | ------: | --------------: | ----------------: | -----------: | ----------: | -------------: | -----------: | ------: | -------: | :------------: | :-----: | :--------: |
| WS@1Hz payload=360B [rep 1/1]   |      ws |      1.30 |          1.30 |     467 |             467 |                 0 |          360 |         3.6 |            417 |         48.9 |     1.8 |    209.0 |      3/3       |   ✅    |     ✅     |
| HTTP@1Hz payload=360B [rep 1/1] | polling |      1.41 |          1.41 |     508 |             508 |               508 |          360 |         2.9 |            312 |         51.2 |     2.1 |    209.1 |      3/3       |   ✅    |     ✅     |

</details>

Parametry przyjęte w ostatnim runie:

- Metody: ws, polling
- Częstotliwości [Hz]: 1
- Obciążenia CPU [%]: 0
- Czas sesji [s]: 6
- MONITOR_TICK_MS: 500
- Payloady: WS=360B, HTTP=360B
- Klienci: clientsHttp=0, clientsWs=0
- Warmup/Cooldown [s]: 0 / 0
- Repeats: 1

## Uśrednione wyniki wg obciążenia

Uwaga: "Obciążenie" oznacza sztuczne obciążenie CPU procesu podczas sesji (generator w worker_threads). Kolumny /cli to normalizacja per odbiorcę (HTTP: suma/N; WS: Rate/cli≈Rate, Bytes/cli≈Rate×Payload).

### Porównanie wg obciążenia — WebSocket

| Obciążenie | Rate/cli [/s] | Bytes/cli [B/s] | Jitter [ms] | Staleness [ms] | CPU [%] | RSS [MB] |
| ---------: | ------------: | --------------: | ----------: | -------------: | ------: | -------: |
|         0% |          1.30 |             467 |         3.6 |            417 |     1.8 |    209.0 |

### Porównanie wg obciążenia — HTTP polling

| Obciążenie | Rate/cli [/s] | Bytes/cli [B/s] | Jitter [ms] | Staleness [ms] | CPU [%] | RSS [MB] |
| ---------: | ------------: | --------------: | ----------: | -------------: | ------: | -------: |
|         0% |          1.41 |             508 |         2.9 |            312 |     2.1 |    209.1 |

## Uśrednione wyniki wg liczby klientów

Uwaga: "Liczba klientów" to liczba równoległych syntetycznych klientów generowanych wewnętrznie na czas sesji (HTTP: liczbę timerów; WS: efektywną sumaryczną częstość). Kolumny /cli to normalizacja per odbiorcę (HTTP: suma/N; WS: Rate/cli≈Rate, Bytes/cli≈Rate×Payload).

### Zestawienie wg liczby klientów — WebSocket

| Klienci | Rate/cli [/s] | Bytes/cli [B/s] | Jitter [ms] | Staleness [ms] | CPU [%] | RSS [MB] |
| ------: | ------------: | --------------: | ----------: | -------------: | ------: | -------: |
|       0 |          1.30 |             467 |         3.6 |            417 |     1.8 |    209.0 |

### Zestawienie wg liczby klientów — HTTP polling

| Klienci | Rate/cli [/s] | Bytes/cli [B/s] | Jitter [ms] | Staleness [ms] | CPU [%] | RSS [MB] |
| ------: | ------------: | --------------: | ----------: | -------------: | ------: | -------: |
|       1 |          1.41 |             508 |         2.9 |            312 |     2.1 |    209.1 |

## Metrologia (95% CI) — ostatni run

Niepewność średnich estymowana z próbek (tick ~ 500 ms).

| Label                 | n (used/total) | Rate [/s] | CI95 Rate | CI95/avg | σ(rate) | Median Rate | Bytes/s | CI95 Bytes | CI95/avg | σ(bytes) | Median Bytes | Jitter [ms] | CI95 Jitter | σ(jitter) | Stal [ms] | CI95 Stal | σ(stal) | Median Stal | p95 Stal | Ingest E2E [ms] | CI95 Ingest | Emit E2E [ms] | CI95 Emit |
| --------------------- | :------------: | --------: | --------: | -------: | ------: | ----------: | ------: | ---------: | -------: | -------: | -----------: | ----------: | ----------: | --------: | --------: | --------: | ------: | ----------: | -------: | --------------: | ----------: | ------------: | --------: |
| WS@1Hz payload=360B   |      3/3       |      1.30 |    ± 1.04 |      80% |    3.01 |        1.14 |     467 |      ± 374 |      80% |     1082 |          410 |         3.6 |       ± 0.6 |       0.6 |       417 |     ± 338 |     299 |         504 |      662 |               0 |         ± 0 |             0 |       ± 0 |
| HTTP@1Hz payload=360B |      3/3       |      1.41 |    ± 1.24 |      88% |    2.86 |        1.35 |     508 |      ± 445 |      88% |     1030 |          485 |         2.9 |       ± 2.9 |       2.5 |       312 |     ± 306 |     271 |         410 |      520 |               0 |         ± 0 |             0 |       ± 0 |

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

- WS@1Hz payload=360B [rep 1/1]: rate=1.30 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] [N/A w porównaniach]
- HTTP@1Hz payload=360B [rep 1/1]: rate=1.41 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0]

## Walidacja wiarygodności i poprawności

Brak pliku validation.txt dla ostatniego runu.

- Rate OK: 100% (2/2)
- Payload OK: 100% (2/2)
- Minimalna liczba próbek n(used): 3
- Średni względny CI95: Rate ≈ 84%, Bytes/s ≈ 84%

Uwaga: FAIL wynika głównie z odchyleń Rate od oczekiwanych Hz. To spodziewane, jeśli źródło danych (Arduino/MQTT) publikuje ~1 Hz niezależnie od ustawień nominalnych. Payload przechodzi (OK) we wszystkich scenariuszach.

## Wnioski — wizualne porównanie

### Wnioski — porównanie WS vs HTTP wg obciążenia (Rate/cli)

Legenda: Pogrubienia oznaczają korzystniejszą wartość w danej kolumnie (niżej/lepiej lub wyżej/lepiej zgodnie z metryką). Rate/cli — metryka znormalizowana per odbiorcę.

| Obciążenie [%] | Rate/cli WS [/s] | Rate/cli HTTP [/s] | Δ Rate/cli [%] | Jitter WS [ms] | Jitter HTTP [ms] | Staleness WS [ms] | Staleness HTTP [ms] | ELU p99 WS [ms] | ELU p99 HTTP [ms] | CPU WS [%] | CPU HTTP [%] | RSS WS [MB] | RSS HTTP [MB] |
| -------------: | ---------------: | -----------------: | -------------: | -------------: | ---------------: | ----------------: | ------------------: | --------------: | ----------------: | ---------: | -----------: | ----------: | ------------: |
|              0 |             1.30 |           **1.41** |            -8% |            3.6 |          **2.9** |               417 |             **312** |        **48.9** |              51.2 |    **1.8** |          2.1 |   **209.0** |         209.1 |

### Wnioski — porównanie WS vs HTTP wg liczby klientów (Rate/cli)

Legenda: Pogrubienia oznaczają korzystniejszą wartość w danej kolumnie (niżej/lepiej lub wyżej/lepiej zgodnie z metryką). Rate/cli — metryka znormalizowana per odbiorcę.

| Klienci | Rate/cli WS [/s] | Rate/cli HTTP [/s] | Δ Rate/cli [%] | Jitter WS [ms] | Jitter HTTP [ms] | Staleness WS [ms] | Staleness HTTP [ms] | ELU p99 WS [ms] | ELU p99 HTTP [ms] | CPU WS [%] | CPU HTTP [%] | RSS WS [MB] | RSS HTTP [MB] |
| ------: | ---------------: | -----------------: | -------------: | -------------: | ---------------: | ----------------: | ------------------: | --------------: | ----------------: | ---------: | -----------: | ----------: | ------------: |

### Wnioski — krótkie podsumowanie (WS vs HTTP)

- Średnio (ten run): Rate/cli — WS — /s vs HTTP 1.41 /s
- Średnio: Jitter — WS — ms vs HTTP 2.9 ms (niżej = stabilniej)
- Średnio: Staleness — WS — ms vs HTTP 312 ms (niżej = świeżej)
- Średnio: CPU — WS —% vs HTTP 2.1% (niżej = lżej)

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
