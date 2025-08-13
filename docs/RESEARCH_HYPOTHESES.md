# Research hypotheses (WS push vs HTTP polling)

Odnośniki: [Glosariusz](./GLOSARIUSZ.md) • [Plan badań](./RESEARCH_PLAN.md) • [Aspekt badawczy](./ASPEKT_BADAWCZY.md)

Celem jest porównanie dwóch metod dostarczania danych telemetrycznych do klienta: WebSocket (push) oraz HTTP polling (pull). Poniżej hipotezy oraz sposób ich weryfikacji w projekcie.

## Hipotezy główne

1. H1 — Staleness: WebSocket dostarcza „świeższe” dane (niższy staleness [ms]) niż HTTP polling przy tych samych częstotliwościach nominalnych (0.5–2 Hz), ponieważ nie czeka na okno odpytywania.

2. H2 — Zależność bajtowa: Dla ustalonych ładunków obowiązuje zależność $Bytes/s \approx Rate \times Payload$ zarówno w WS, jak i HTTP. Odchylenie względne > 30% wskazuje na problem z pomiarem, nadmierny jitter lub przycięcie (trim) warmup/cooldown.

3. H3 — Stabilność interwałów: Jitter [ms] (odchylenie standardowe odstępów) jest niższy dla WS (kontrolowany driver) niż dla HTTP (timery + kolejki event loop).

4. H4 — Koszt zasobów: Narzut CPU i ELU p99 rośnie wraz z Hz i liczbą klientów. Do 2 Hz obie metody mieszczą się w akceptowalnym zakresie dla pojedynczej instancji API (CPU < ~30%, ELU p99 < ~50 ms w typowych warunkach).

5. H5 — Skalowalność po klientach: Wzrost liczby klientów zwiększa koszt CPU i I/O szybciej dla HTTP (koszt request/response per klient) niż dla WS (broadcast; jeden payload kopiowany do wielu gniazd).

## Metryki i kryteria weryfikacji

- Rate [/s], Bytes/s, ~Payload [B]
- Jitter [ms], Staleness [ms]
- ELU p99 [ms], CPU [%], RSS [MB]
- Egress est. [B/s] (porównanie kosztu sumarycznego sieci)
- Wiarygodność: n(used) ≥ 10, względny CI95 (Rate i Bytes/s) < 30% (dla krótkich przebiegów)

## Uwagi metodologiczne

- WS liczy emisje (nie mnożymy przez liczbę klientów); egress est. ≈ $Rate \times Payload \times N$ (dla N klientów) — obliczane pomocniczo.
- HTTP przy 0 klientach nie generuje ruchu — takie wiersze nie są porównywalne z WS i są pomijane w tabelach „WS vs HTTP”.
- Źródło danych (Arduino) zwykle publikuje ~1 Hz. Przy Hz > 1 testujemy przepustowość warstwy transportowej i narzut, nie świeżość danych (Staleness pozostaje blisko 1000 ms gdy źródło-limitowane).

## Replikacja

- Skrypt: `api/src/scripts/measurementRunner.ts` (+ orkiestracja PowerShell `api/tools/orchestrate-benchmarks.ps1`).
- Skróty: `npm run research:quick`, `npm run research:safe`, `npm run research:robust`, `npm run research:full`, `npm run research:sanity` (w `api`).
- Sekcja AUTO-RESULTS w `docs/ASPEKT_BADAWCZY.md` aktualizuje się automatycznie po zakończonych runach.
