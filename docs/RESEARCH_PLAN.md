# Plan badań i hipotezy

Celem badań jest porównanie transportu danych telemetrycznych do klienta: WebSocket (push) vs HTTP polling (pull).

## Hipotezy

- H1: WS ma niższy staleness [ms] niż HTTP przy tych samych Hz (0.5–2 Hz).
- H2: Bytes/s ≈ Rate × Payload dla obu metod (stały ładunek).
- H3: Jitter [ms] jest niższy dla WS (driver) niż HTTP (timery).
- H4: CPU i ELU p99 pozostają akceptowalne do 2 Hz; rosną wraz z Hz i N klientów.
- H5: Skalowanie po liczbie klientów jest korzystniejsze dla WS (broadcast) niż HTTP (koszt per request).

## Metryki i kryteria

- Rate [/s] (wyżej lepiej), Bytes/s, ~Payload [B].
- Jitter [ms], Staleness [ms] (niżej lepiej).
- ELU p99 [ms], CPU [%], RSS [MB] (niżej lepiej).
- Wiarygodność: n(used) ≥ 10; CI95/średnia < 30% (praktyczne kryterium dla krótkich przebiegów).

## Scenariusze

- S1–S4: WS/HTTP × {1 klient, N klientów} (pokryte runnerem).
- S5: ≥ 4 Hz (wymaga flag), S6: mix WS/HTTP (do rozważenia).

## Procedura

- Uruchamiaj z katalogu `api`:
  - Szybko: `npm run research:quick`
  - Bezpiecznie: `npm run research:safe`
  - Pełna macierz: `npm run research:full`
- Wyniki: `api/benchmarks/<timestamp>/{sessions.csv, summary.json, README.md}`.
- Auto-aktualizacja: sekcja AUTO-RESULTS w `docs/ASPEKT_BADAWCZY.md`.

## Prezentacja wyników

- W raporcie per run (README) i w dokumencie badawczym wskazujemy zwycięzców per kategoria (rate, jitter, staleness, CPU, RSS) oraz krótkie porównanie WS vs HTTP.
