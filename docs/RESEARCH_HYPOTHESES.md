# Research hypotheses (WS push vs HTTP polling)

Celem jest porównanie dwóch metod dostarczania danych telemetrycznych do klienta: WebSocket (push) oraz HTTP polling (pull). Poniżej hipotezy oraz sposób ich weryfikacji w projekcie.

## Hipotezy główne

1) H1 — Staleness: WebSocket dostarcza „świeższe” dane (niższy staleness [ms]) niż HTTP polling przy tych samych częstotliwościach nominalnych (0.5–2 Hz), ponieważ nie czeka na okno odpytywania.

2) H2 — Zależność bajtowa: Dla ustalonych ładunków obowiązuje zależność Bytes/s ≈ Rate × Payload zarówno w WS, jak i HTTP. Odchylenie > 30% wskazuje na problem z pomiarem lub duży jitter/trim.

3) H3 — Stabilność interwałów: Jitter [ms] (odchylenie standardowe odstępów) jest niższy dla WS (kontrolowany driver) niż dla HTTP (timery + kolejki event loop).

4) H4 — Koszt zasobów: Narzut CPU i EL delay p99 rośnie wraz z Hz i liczbą klientów. Do 2 Hz obie metody mieszczą się w akceptowalnym zakresie dla pojedynczej instancji API.

5) H5 — Skalowalność po klientach: Wzrost liczby klientów zwiększa koszt CPU i I/O szybciej dla HTTP (koszt request/response per klient) niż dla WS (broadcast). 

## Metryki i kryteria weryfikacji

- Rate [/s], Bytes/s, ~Payload [B]
- Jitter [ms], Staleness [ms]
- EL delay p99 [ms], CPU [%], RSS [MB]
- Wiarygodność: n(used) ≥ 10, względny CI95 < 30% (dla krótkich przebiegów)

## Uwagi metodologiczne

- WS liczy emisje (nie mnożymy przez liczbę klientów); Bytes/s w WS rosną wraz z liczbą klientów (broadcast). 
- HTTP przy 0 klientach nie generuje ruchu — takie wiersze nie są porównywalne z WS i są pomijane w tabelach „WS vs HTTP”.
- Źródło danych (Arduino) zwykle publikuje ~1 Hz. Przy Hz>1 testujemy zdolność transportu i obciążenie serwera, a nie świeżość danych (staleness pozostaje blisko 1000 ms).

## Replikacja

- Skrypt: `api/src/scripts/measurementRunner.ts` (+ orkiestracja PowerShell `api/tools/orchestrate-benchmarks.ps1`).
- Skróty: `npm run research:quick`, `npm run research:safe`, `npm run research:robust`, `npm run research:full`, `npm run research:sanity` (w `api`).
- Sekcja AUTO-RESULTS w `docs/ASPEKT_BADAWCZY.md` aktualizuje się automatycznie po zakończonych runach.
