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
Ostatni run: 2025-08-14T15-59-23-271Z

Status: fair payload: TAK, source-limited: NIE, czas: 40s, tick: 200 ms, repeats: 2

Pliki: [sessions.csv](../api/benchmarks/2025-08-14T15-59-23-271Z/sessions.csv), [summary.json](../api/benchmarks/2025-08-14T15-59-23-271Z/summary.json), [README](../api/benchmarks/2025-08-14T15-59-23-271Z/README.md)

Uwaga: tabele uporządkowane wg: Mode (WS, HTTP) → Hz → Obciążenie → Klienci.

Uwaga: Scenariusze z liczbą klientów = 0 mają różną semantykę: WS (push) emituje niezależnie od liczby klientów — per‑client raportujemy Rate/cli = Rate oraz Bytes/cli ≈ Rate×Payload; HTTP (pull) przy 0 klientach nie generuje żądań → pola per‑client są puste (—). Dlatego w porównaniach WS vs HTTP ("Zwycięzcy", tabele WS vs HTTP) wiersze HTTP z N=0 są pomijane.

Uwaga (per klient): kolumny Rate/cli i Bytes/cli pokazują wartości znormalizowane per odbiorcę.
- HTTP: wartości łączne (Rate, Bytes/s) rosną proporcjonalnie do liczby klientów N; per‑client = łączna wartość / N.
- WS (broadcast): Rate/cli ≈ Rate (nie dzielimy przez N); Bytes/cli ≈ Rate × Payload (co odbiera pojedynczy klient). Dla N>0 w pełnej tabeli Bytes/cli może być równoważnie prezentowane jako Bytes/s ÷ N (perspektywa serwera).
- HTTP z N=0: pola per‑client są puste (—).
Uwaga (WS — egress): kolumna Egress est. szacuje łączny koszt sieci: WS ≈ Rate × Payload × N; HTTP ≈ Bytes/s (już zsumowane po klientach).
Kluczowe porównania (TL;DR, zwycięzcy, tabele wizualne) stosują Rate/cli: w WS nie dzielimy przez N, w HTTP dzielimy przez N — dzięki temu liczby są porównywalne per użytkownik.

### TL;DR — szybkie porównanie WS vs HTTP (per klient)

- Porównuj per klienta: Rate/cli i Bytes/cli; WS: Bytes/cli ≈ Rate × Payload; egress ≈ Rate × Payload × N.
- Ten run (średnio): Rate/cli — WS — /s vs HTTP 0.99 /s; Jitter — WS — ms vs HTTP 3.9 ms; Staleness — WS — ms vs HTTP 498 ms; CPU — WS —% vs HTTP 37.3%.
- Gdy 95% CI (Metrologia) nakładają się, uznawaj różnice za niejednoznaczne.

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

| Label | Mode | Rate/cli [/s] | Bytes/cli [B/s] | Jitter [ms] | Staleness [ms] | CPU [%] | RSS [MB] |
|---|---:|---:|---:|---:|---:|---:|---:|
| WS@1Hz payload=360B [rep 1/2] | ws | 0.97 | 348 | 6.0 | 503 | 2.8 | 187.6 |
| WS@1Hz payload=360B [rep 2/2] | ws | 1.01 | 363 | 13.0 | 477 | 1.7 | 183.9 |
| WS@1Hz payload=360B + load=25% [rep 1/2] | ws | 1.01 | 362 | 7.6 | 565 | 24.6 | 196.4 |
| WS@1Hz payload=360B + load=25% [rep 2/2] | ws | 0.97 | 349 | 5.8 | 522 | 25.6 | 196.6 |
| WS@1Hz payload=360B + load=50% [rep 1/2] | ws | 1.00 | 358 | 4.8 | 517 | 48.8 | 196.8 |
| WS@1Hz payload=360B + load=50% [rep 2/2] | ws | 1.00 | 361 | 9.8 | 546 | 49.3 | 197.3 |
| WS@1Hz payload=360B + load=75% [rep 1/2] | ws | 1.01 | 364 | 1.1 | 503 | 74.6 | 197.8 |
| WS@1Hz payload=360B + load=75% [rep 2/2] | ws | 1.01 | 363 | 5.3 | 498 | 73.5 | 198.4 |
| HTTP@1Hz payload=360B [rep 1/2] | polling | 0.98 | 351 | 6.2 | 511 | 1.7 | 184.1 |
| HTTP@1Hz payload=360B [rep 2/2] | polling | 0.99 | 355 | 3.3 | 532 | 1.7 | 184.4 |
| HTTP@1Hz payload=360B + load=25% [rep 1/2] | polling | 1.01 | 364 | 2.8 | 511 | 25.2 | 196.2 |
| HTTP@1Hz payload=360B + load=25% [rep 2/2] | polling | 0.97 | 350 | 6.8 | 549 | 24.6 | 196.8 |
| HTTP@1Hz payload=360B + load=50% [rep 1/2] | polling | 0.97 | 350 | 0.7 | 487 | 49.7 | 197.6 |
| HTTP@1Hz payload=360B + load=50% [rep 2/2] | polling | 0.99 | 358 | 5.3 | 466 | 48.7 | 197.8 |
| HTTP@1Hz payload=360B + load=75% [rep 1/2] | polling | 1.00 | 362 | 5.1 | 465 | 73.6 | 198.8 |
| HTTP@1Hz payload=360B + load=75% [rep 2/2] | polling | 1.01 | 362 | 1.0 | 460 | 73.0 | 198.9 |

<details>
<summary>Szczegóły (pełna tabela)</summary>

| Label | Mode | Rate [/s] | Rate/cli [/s] | Bytes/s | Bytes/cli [B/s] | Egress est. [B/s] | ~Payload [B] | Jitter [ms] | Staleness [ms] | ELU p99 [ms] | CPU [%] | RSS [MB] | n (used/total) | Rate OK | Payload OK |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--:|:--:|:--:|
| WS@1Hz payload=360B [rep 1/2] | ws | 0.97 | 0.97 | 348 | 348 | 0 | 360 | 6.0 | 503 | 42.6 | 2.8 | 187.6 | 29/35 | ✅ | ✅ |
| WS@1Hz payload=360B [rep 2/2] | ws | 1.01 | 1.01 | 363 | 363 | 0 | 360 | 13.0 | 477 | 37.9 | 1.7 | 183.9 | 29/36 | ✅ | ✅ |
| WS@1Hz payload=360B + load=25% [rep 1/2] | ws | 1.01 | 1.01 | 362 | 362 | 0 | 360 | 7.6 | 565 | 35.1 | 24.6 | 196.4 | 29/37 | ✅ | ✅ |
| WS@1Hz payload=360B + load=25% [rep 2/2] | ws | 0.97 | 0.97 | 349 | 349 | 0 | 360 | 5.8 | 522 | 33.7 | 25.6 | 196.6 | 29/36 | ✅ | ✅ |
| WS@1Hz payload=360B + load=50% [rep 1/2] | ws | 1.00 | 1.00 | 358 | 358 | 0 | 360 | 4.8 | 517 | 43.1 | 48.8 | 196.8 | 29/36 | ✅ | ✅ |
| WS@1Hz payload=360B + load=50% [rep 2/2] | ws | 1.00 | 1.00 | 361 | 361 | 0 | 360 | 9.8 | 546 | 34.1 | 49.3 | 197.3 | 29/36 | ✅ | ✅ |
| WS@1Hz payload=360B + load=75% [rep 1/2] | ws | 1.01 | 1.01 | 364 | 364 | 0 | 360 | 1.1 | 503 | 36.2 | 74.6 | 197.8 | 28/35 | ✅ | ✅ |
| WS@1Hz payload=360B + load=75% [rep 2/2] | ws | 1.01 | 1.01 | 363 | 363 | 0 | 360 | 5.3 | 498 | 38.5 | 73.5 | 198.4 | 28/36 | ✅ | ✅ |
| HTTP@1Hz payload=360B [rep 1/2] | polling | 0.98 | 0.98 | 351 | 351 | 351 | 360 | 6.2 | 511 | 33.3 | 1.7 | 184.1 | 30/36 | ✅ | ✅ |
| HTTP@1Hz payload=360B [rep 2/2] | polling | 0.99 | 0.99 | 355 | 355 | 355 | 360 | 3.3 | 532 | 33.9 | 1.7 | 184.4 | 29/37 | ✅ | ✅ |
| HTTP@1Hz payload=360B + load=25% [rep 1/2] | polling | 1.01 | 1.01 | 364 | 364 | 364 | 360 | 2.8 | 511 | 32.6 | 25.2 | 196.2 | 29/37 | ✅ | ✅ |
| HTTP@1Hz payload=360B + load=25% [rep 2/2] | polling | 0.97 | 0.97 | 350 | 350 | 350 | 360 | 6.8 | 549 | 43.5 | 24.6 | 196.8 | 29/37 | ✅ | ✅ |
| HTTP@1Hz payload=360B + load=50% [rep 1/2] | polling | 0.97 | 0.97 | 350 | 350 | 350 | 360 | 0.7 | 487 | 42.3 | 49.7 | 197.6 | 29/36 | ✅ | ✅ |
| HTTP@1Hz payload=360B + load=50% [rep 2/2] | polling | 0.99 | 0.99 | 358 | 358 | 358 | 360 | 5.3 | 466 | 33.8 | 48.7 | 197.8 | 28/36 | ✅ | ✅ |
| HTTP@1Hz payload=360B + load=75% [rep 1/2] | polling | 1.00 | 1.00 | 362 | 362 | 362 | 360 | 5.1 | 465 | 49.4 | 73.6 | 198.8 | 29/35 | ✅ | ✅ |
| HTTP@1Hz payload=360B + load=75% [rep 2/2] | polling | 1.01 | 1.01 | 362 | 362 | 362 | 360 | 1.0 | 460 | 38.6 | 73.0 | 198.9 | 28/35 | ✅ | ✅ |

</details>

Parametry przyjęte w ostatnim runie:
- Metody: ws, polling
- Częstotliwości [Hz]: 1
- Obciążenia CPU [%]: 0, 25, 50, 75
- Czas sesji [s]: 40
- MONITOR_TICK_MS: 200
- Payloady: WS=360B, HTTP=360B
- Klienci: clientsHttp=0, clientsWs=0
- Warmup/Cooldown [s]: 4 / 4
- Repeats: 2

## Uśrednione wyniki wg obciążenia

Uwaga: "Obciążenie" oznacza sztuczne obciążenie CPU procesu podczas sesji (generator w worker_threads). Kolumny /cli to normalizacja per odbiorcę (HTTP: suma/N; WS: Rate/cli≈Rate, Bytes/cli≈Rate×Payload).

### Porównanie wg obciążenia — WebSocket

| Obciążenie | Rate/cli [/s] | Bytes/cli [B/s] | Jitter [ms] | Staleness [ms] | CPU [%] | RSS [MB] |
|---:|---:|---:|---:|---:|---:|---:|
| 0% | 0.99 | 356 | 9.5 | 490 | 2.3 | 185.7 |
| 25% | 0.99 | 355 | 6.7 | 543 | 25.1 | 196.5 |
| 50% | 1.00 | 359 | 7.3 | 531 | 49.1 | 197.1 |
| 75% | 1.01 | 363 | 3.2 | 501 | 74.0 | 198.1 |

### Porównanie wg obciążenia — HTTP polling

| Obciążenie | Rate/cli [/s] | Bytes/cli [B/s] | Jitter [ms] | Staleness [ms] | CPU [%] | RSS [MB] |
|---:|---:|---:|---:|---:|---:|---:|
| 0% | 0.98 | 353 | 4.8 | 522 | 1.7 | 184.3 |
| 25% | 0.99 | 357 | 4.8 | 530 | 24.9 | 196.5 |
| 50% | 0.98 | 354 | 3.0 | 476 | 49.2 | 197.7 |
| 75% | 1.01 | 362 | 3.0 | 462 | 73.3 | 198.8 |

## Uśrednione wyniki wg liczby klientów

Uwaga: "Liczba klientów" to liczba równoległych syntetycznych klientów generowanych wewnętrznie na czas sesji (HTTP: liczbę timerów; WS: efektywną sumaryczną częstość). Kolumny /cli to normalizacja per odbiorcę (HTTP: suma/N; WS: Rate/cli≈Rate, Bytes/cli≈Rate×Payload).

### Zestawienie wg liczby klientów — WebSocket

| Klienci | Rate/cli [/s] | Bytes/cli [B/s] | Jitter [ms] | Staleness [ms] | CPU [%] | RSS [MB] |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 1.00 | 358 | 6.7 | 516 | 37.6 | 194.3 |

### Zestawienie wg liczby klientów — HTTP polling

| Klienci | Rate/cli [/s] | Bytes/cli [B/s] | Jitter [ms] | Staleness [ms] | CPU [%] | RSS [MB] |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0.99 | 356 | 3.9 | 498 | 37.3 | 194.3 |

## Metrologia (95% CI) — ostatni run

Niepewność średnich estymowana z próbek (tick ~ 200 ms).

| Label | n (used/total) | Rate [/s] | CI95 Rate | CI95/avg | σ(rate) | Median Rate | Bytes/s | CI95 Bytes | CI95/avg | σ(bytes) | Median Bytes | Jitter [ms] | CI95 Jitter | σ(jitter) | Stal [ms] | CI95 Stal | σ(stal) | Median Stal | p95 Stal | Ingest E2E [ms] | CI95 Ingest | Emit E2E [ms] | CI95 Emit |
|---|:--:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| WS@1Hz payload=360B | 29/35 | 0.97 | ± 0.08 | 9% | 0.23 | 0.91 | 348 | ± 30 | 9% | 83 | 327 | 6.0 | ± 1.0 | 2.8 | 503 | ± 101 | 277 | 509 | 926 | 1 | ± 0 | 15 | ± 2 |
| WS@1Hz payload=360B | 29/36 | 1.01 | ± 0.10 | 10% | 0.28 | 0.92 | 363 | ± 37 | 10% | 102 | 332 | 13.0 | ± 1.3 | 3.5 | 477 | ± 106 | 292 | 474 | 965 | 1 | ± 0 | 16 | ± 2 |
| WS@1Hz payload=360B + load=25% | 29/37 | 1.01 | ± 0.11 | 11% | 0.29 | 0.92 | 362 | ± 38 | 11% | 105 | 332 | 7.6 | ± 0.5 | 1.3 | 565 | ± 114 | 314 | 613 | 988 | 1 | ± 0 | 15 | ± 1 |
| WS@1Hz payload=360B + load=25% | 29/36 | 0.97 | ± 0.09 | 9% | 0.24 | 0.91 | 349 | ± 31 | 9% | 86 | 327 | 5.8 | ± 0.2 | 0.7 | 522 | ± 106 | 290 | 501 | 926 | 1 | ± 0 | 15 | ± 1 |
| WS@1Hz payload=360B + load=50% | 29/36 | 1.00 | ± 0.10 | 10% | 0.27 | 0.91 | 358 | ± 35 | 10% | 97 | 327 | 4.8 | ± 0.7 | 2.0 | 517 | ± 108 | 298 | 504 | 970 | 1 | ± 0 | 15 | ± 1 |
| WS@1Hz payload=360B + load=50% | 29/36 | 1.00 | ± 0.10 | 10% | 0.28 | 0.91 | 361 | ± 36 | 10% | 100 | 327 | 9.8 | ± 1.0 | 2.7 | 546 | ± 115 | 317 | 628 | 997 | 1 | ± 0 | 15 | ± 0 |
| WS@1Hz payload=360B + load=75% | 28/35 | 1.01 | ± 0.12 | 12% | 0.31 | 0.90 | 364 | ± 42 | 12% | 113 | 322 | 1.1 | ± 0.4 | 1.2 | 503 | ± 112 | 301 | 490 | 970 | 1 | ± 0 | 15 | ± 1 |
| WS@1Hz payload=360B + load=75% | 28/36 | 1.01 | ± 0.12 | 12% | 0.32 | 0.88 | 363 | ± 42 | 12% | 114 | 318 | 5.3 | ± 0.7 | 1.8 | 498 | ± 115 | 309 | 508 | 945 | 1 | ± 0 | 15 | ± 1 |
| HTTP@1Hz payload=360B | 30/36 | 0.98 | ± 0.08 | 9% | 0.23 | 0.92 | 351 | ± 30 | 9% | 84 | 332 | 6.2 | ± 0.5 | 1.3 | 511 | ± 99 | 277 | 479 | 969 | 15 | ± 1 | 0 | ± 0 |
| HTTP@1Hz payload=360B | 29/37 | 0.99 | ± 0.08 | 9% | 0.23 | 0.92 | 355 | ± 30 | 9% | 83 | 332 | 3.3 | ± 0.4 | 1.1 | 532 | ± 108 | 295 | 549 | 950 | 15 | ± 1 | 0 | ± 0 |
| HTTP@1Hz payload=360B + load=25% | 29/37 | 1.01 | ± 0.10 | 10% | 0.29 | 0.92 | 364 | ± 37 | 10% | 103 | 332 | 2.8 | ± 0.7 | 2.0 | 511 | ± 119 | 327 | 519 | 985 | 15 | ± 1 | 0 | ± 0 |
| HTTP@1Hz payload=360B + load=25% | 29/37 | 0.97 | ± 0.09 | 9% | 0.23 | 0.91 | 350 | ± 31 | 9% | 84 | 327 | 6.8 | ± 0.7 | 2.0 | 549 | ± 106 | 290 | 581 | 952 | 15 | ± 1 | 0 | ± 0 |
| HTTP@1Hz payload=360B + load=50% | 29/36 | 0.97 | ± 0.09 | 9% | 0.23 | 0.91 | 350 | ± 31 | 9% | 84 | 327 | 0.7 | ± 0.0 | 0.1 | 487 | ± 98 | 269 | 485 | 947 | 15 | ± 0 | 0 | ± 0 |
| HTTP@1Hz payload=360B + load=50% | 28/36 | 0.99 | ± 0.10 | 10% | 0.28 | 0.91 | 358 | ± 37 | 10% | 100 | 327 | 5.3 | ± 0.7 | 1.8 | 466 | ± 111 | 299 | 447 | 954 | 15 | ± 0 | 0 | ± 0 |
| HTTP@1Hz payload=360B + load=75% | 29/35 | 1.00 | ± 0.11 | 11% | 0.29 | 0.90 | 362 | ± 38 | 11% | 105 | 322 | 5.1 | ± 0.4 | 1.1 | 465 | ± 102 | 280 | 409 | 985 | 15 | ± 1 | 0 | ± 0 |
| HTTP@1Hz payload=360B + load=75% | 28/35 | 1.01 | ± 0.12 | 12% | 0.31 | 0.88 | 362 | ± 42 | 12% | 112 | 318 | 1.0 | ± 0.3 | 0.7 | 460 | ± 109 | 295 | 428 | 970 | 15 | ± 1 | 0 | ± 0 |

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

- WS@1Hz payload=360B [rep 1/2]: rate=0.97 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s) [N/A w porównaniach]
- WS@1Hz payload=360B [rep 2/2]: rate=1.01 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s) [N/A w porównaniach]
- WS@1Hz payload=360B + load=25% [rep 1/2]: rate=1.01 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s) [N/A w porównaniach]
- WS@1Hz payload=360B + load=25% [rep 2/2]: rate=0.97 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s) [N/A w porównaniach]
- WS@1Hz payload=360B + load=50% [rep 1/2]: rate=1.00 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s) [N/A w porównaniach]
- WS@1Hz payload=360B + load=50% [rep 2/2]: rate=1.00 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s) [N/A w porównaniach]
- WS@1Hz payload=360B + load=75% [rep 1/2]: rate=1.01 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s) [N/A w porównaniach]
- WS@1Hz payload=360B + load=75% [rep 2/2]: rate=1.01 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s) [N/A w porównaniach]
- HTTP@1Hz payload=360B [rep 1/2]: rate=0.98 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@1Hz payload=360B [rep 2/2]: rate=0.99 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@1Hz payload=360B + load=25% [rep 1/2]: rate=1.01 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@1Hz payload=360B + load=25% [rep 2/2]: rate=0.97 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@1Hz payload=360B + load=50% [rep 1/2]: rate=0.97 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@1Hz payload=360B + load=50% [rep 2/2]: rate=0.99 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@1Hz payload=360B + load=75% [rep 1/2]: rate=1.00 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)
- HTTP@1Hz payload=360B + load=75% [rep 2/2]: rate=1.01 in [0.50, 1.50] (c=1); bytesPerUnit=360.0 in [180.0, 540.0] (trim: warmup=4s, cooldown=4s)

## Walidacja wiarygodności i poprawności

Brak pliku validation.txt dla ostatniego runu.

- Rate OK: 100% (16/16)
- Payload OK: 100% (16/16)
- Minimalna liczba próbek n(used): 28
- Średni względny CI95: Rate ≈ 10%, Bytes/s ≈ 10%

Uwaga: FAIL wynika głównie z odchyleń Rate od oczekiwanych Hz. To spodziewane, jeśli źródło danych (Arduino/MQTT) publikuje ~1 Hz niezależnie od ustawień nominalnych. Payload przechodzi (OK) we wszystkich scenariuszach.

## Zwycięzcy (per scenariusz)

Dla każdej kombinacji Hz/obciążenia/liczby klientów wskazano najlepszą metodę w kluczowych kategoriach.

### Zwycięzcy — Hz=1|Load=0|Clients=1
- Częstość [#/s] (per klient): POLLING (HTTP@1Hz payload=360B) (≈ 0.99)
- Jitter [ms]: POLLING (HTTP@1Hz payload=360B) (≈ 3.3)
- Staleness [ms]: POLLING (HTTP@1Hz payload=360B) (≈ 511.3)
- CPU [%]: POLLING (HTTP@1Hz payload=360B) (≈ 1.7)
- RSS [MB]: POLLING (HTTP@1Hz payload=360B) (≈ 184.1)

### Zwycięzcy — Hz=1|Load=25|Clients=1
- Częstość [#/s] (per klient): POLLING (HTTP@1Hz payload=360B + load=25%) (≈ 1.01)
- Jitter [ms]: POLLING (HTTP@1Hz payload=360B + load=25%) (≈ 2.8)
- Staleness [ms]: POLLING (HTTP@1Hz payload=360B + load=25%) (≈ 511.2)
- CPU [%]: POLLING (HTTP@1Hz payload=360B + load=25%) (≈ 24.6)
- RSS [MB]: POLLING (HTTP@1Hz payload=360B + load=25%) (≈ 196.2)

### Zwycięzcy — Hz=1|Load=50|Clients=1
- Częstość [#/s] (per klient): POLLING (HTTP@1Hz payload=360B + load=50%) (≈ 0.99)
- Jitter [ms]: POLLING (HTTP@1Hz payload=360B + load=50%) (≈ 0.7)
- Staleness [ms]: POLLING (HTTP@1Hz payload=360B + load=50%) (≈ 466.3)
- CPU [%]: POLLING (HTTP@1Hz payload=360B + load=50%) (≈ 48.7)
- RSS [MB]: POLLING (HTTP@1Hz payload=360B + load=50%) (≈ 197.6)

### Zwycięzcy — Hz=1|Load=75|Clients=1
- Częstość [#/s] (per klient): POLLING (HTTP@1Hz payload=360B + load=75%) (≈ 1.01)
- Jitter [ms]: POLLING (HTTP@1Hz payload=360B + load=75%) (≈ 1.0)
- Staleness [ms]: POLLING (HTTP@1Hz payload=360B + load=75%) (≈ 459.5)
- CPU [%]: POLLING (HTTP@1Hz payload=360B + load=75%) (≈ 73.0)
- RSS [MB]: POLLING (HTTP@1Hz payload=360B + load=75%) (≈ 198.8)

### Podsumowanie globalne (średnio)
- Rate/cli: WS — /s vs HTTP 0.99 /s
- Jitter: WS — ms vs HTTP 3.9 ms (niżej lepiej)
- Staleness: WS — ms vs HTTP 498 ms (niżej lepiej)
- CPU: WS —% vs HTTP 37.3% (niżej lepiej)
- RSS: WS — MB vs HTTP 194.3 MB (niżej lepiej)

## Wnioski — wizualne porównanie

### Wnioski — porównanie WS vs HTTP wg obciążenia (Rate/cli)

Legenda: Pogrubienia oznaczają korzystniejszą wartość w danej kolumnie (niżej/lepiej lub wyżej/lepiej zgodnie z metryką). Rate/cli — metryka znormalizowana per odbiorcę.

| Obciążenie [%] | Rate/cli WS [/s] | Rate/cli HTTP [/s] | Δ Rate/cli [%] | Jitter WS [ms] | Jitter HTTP [ms] | Staleness WS [ms] | Staleness HTTP [ms] | ELU p99 WS [ms] | ELU p99 HTTP [ms] | CPU WS [%] | CPU HTTP [%] | RSS WS [MB] | RSS HTTP [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | **0.99** | 0.98 | 1% | 9.5 | **4.8** | **490** | 522 | 40.3 | **33.6** | 2.3 | **1.7** | 185.7 | **184.3** |
| 25 | 0.99 | **0.99** | -0% | 6.7 | **4.8** | 543 | **530** | **34.4** | 38.1 | 25.1 | **24.9** | 196.5 | **196.5** |
| 50 | **1.00** | 0.98 | 2% | 7.3 | **3.0** | 531 | **476** | 38.6 | **38.1** | **49.1** | 49.2 | **197.1** | 197.7 |
| 75 | **1.01** | 1.01 | 0% | 3.2 | **3.0** | 501 | **462** | **37.4** | 44.0 | 74.0 | **73.3** | **198.1** | 198.8 |

### Wnioski — porównanie WS vs HTTP wg liczby klientów (Rate/cli)

Legenda: Pogrubienia oznaczają korzystniejszą wartość w danej kolumnie (niżej/lepiej lub wyżej/lepiej zgodnie z metryką). Rate/cli — metryka znormalizowana per odbiorcę.

| Klienci | Rate/cli WS [/s] | Rate/cli HTTP [/s] | Δ Rate/cli [%] | Jitter WS [ms] | Jitter HTTP [ms] | Staleness WS [ms] | Staleness HTTP [ms] | ELU p99 WS [ms] | ELU p99 HTTP [ms] | CPU WS [%] | CPU HTTP [%] | RSS WS [MB] | RSS HTTP [MB] |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|

### Wnioski — krótkie podsumowanie (WS vs HTTP)

- Średnio (ten run): Rate/cli — WS — /s vs HTTP 0.99 /s
- Średnio: Jitter — WS — ms vs HTTP 3.9 ms (niżej = stabilniej)
- Średnio: Staleness — WS — ms vs HTTP 498 ms (niżej = świeżej)
- Średnio: CPU — WS —% vs HTTP 37.3% (niżej = lżej)

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
