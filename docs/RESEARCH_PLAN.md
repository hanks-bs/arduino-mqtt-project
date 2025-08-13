# Plan badań (skrót)

Odnośniki: [Hipotezy](./RESEARCH_HYPOTHESES.md) • [Aspekt badawczy](./ASPEKT_BADAWCZY.md) • [Glosariusz](./GLOSARIUSZ.md)

Cel: porównać dwa wzorce transportu danych telemetrycznych do klienta: WebSocket (push, broadcast) vs HTTP polling (pull, cykliczne żądania) pod kątem świeżości danych, stabilności interwałów, kosztu sieci i zużycia zasobów procesu.

## Zakres i hipotezy

Hipotezy szczegółowe oraz uzasadnienia znajdują się w `RESEARCH_HYPOTHESES.md`. Ten dokument utrzymuje tylko minimalny plan wykonawczy.

## Metryki główne

Rate [/s], Bytes/s, ~Payload [B], Jitter [ms], Wiek danych (Staleness) [ms], EL delay p99 [ms], CPU [%], RSS [MB], (opcjonalnie) E2E ingest/emit [ms], egress est. [B/s].

Kryteria jakości (krótkie przebiegi): n(used) ≥ 10 oraz względny CI95 (Rate, Bytes/s) < 30% (gdy mniejsze – wyniki stabilne). Przy n<8 traktuj wyniki eksploracyjnie.

## Scenariusze bazowe

S1: WS – 1 klient; S2: WS – N>1 klientów; S3: HTTP – 1 klient; S4: HTTP – N>1; S5: wyższe Hz (2–5) dla oceny narzutu; S6: (planowane) mieszane WS + HTTP.

## Procedura minimalna

1. W katalogu `api` uruchom jedną z komend:

- Szybki sanity: `npm run research:quick`
- Bezpieczny (źródło-limitowany): `npm run research:safe`
- Solidny (pełniejszy CI): `npm run research:robust`
- Pełna macierz: `npm run research:full`

1. Po zakończeniu sprawdź: `api/benchmarks/<ts>/README.md`, `summary.json` oraz sekcję AUTO-RESULTS w `docs/ASPEKT_BADAWCZY.md`.

1. Oceń walidację (validation.txt). Jeśli status WARN z powodu source‑limited, interpretuj Rate ostrożnie (sprawdź Staleness).

## Interpretacja syntetyczna

Porównuj per‑klienta: Rate/cli (wyżej), Jitter/Staleness (niżej), CPU/RSS (niżej). Koszt sieci: HTTP = Bytes/s; WS egress ≈ Rate × Payload × N. Gdy przedziały ufności się nakładają – różnica niejednoznaczna.

## Artefakty i automatyzacja

Każdy run tworzy folder czasowy w `api/benchmarks/`. Dokument badawczy aktualizuje blok AUTO-RESULTS; globalne zestawienie generuje `WYNIKI_ZBIORCZE.md`.

## Glosariusz skrótów

Jitter – zmienność interwałów; Staleness – wiek ostatnich danych; EL delay p99 – 99 percentyl opóźnienia pętli zdarzeń; E2E ingest/emit – czas od źródła do API oraz od źródła do wysłania do klienta.
