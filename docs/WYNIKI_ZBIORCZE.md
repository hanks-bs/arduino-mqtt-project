# Wyniki zbiorcze (agregacja wszystkich uruchomień)

Odnośniki: [Aspekt badawczy](./ASPEKT_BADAWCZY.md) • [Hipotezy](./RESEARCH_HYPOTHESES.md) • [Plan badań](./RESEARCH_PLAN.md) • [Glosariusz](./GLOSARIUSZ.md)

Ten plik jest generowany automatycznie przez skrypt agregujący i przedstawia statystyki zbiorcze ze wszystkich runów.

Artefakty:

- API: benchmarks/\_aggregate.csv (pełne; nagłówki + wiersze)
- API: benchmarks/combined.csv (alias do powyższego, stabilna nazwa)
- API: benchmarks/\_aggregate.json (te same dane w formacie JSON)

Ostatnio dodany katalog: 2025-08-12T18-10-00-610Z
Zakres trybów: ws, polling
Zakres Hz (z etykiet): 0.5, 1, 2
Liczba wierszy: 243

Jak używać:

- Otwórz CSV w Excel/LibreOffice/R/Python.
- Do filtrowania po Hz użyj kolumny 'hz'; po obciążeniu 'loadCpuPct'; po klientach 'clientsHttp/clientsWs'.

Utworzono: 2025-08-12T19:16:09.554Z

## Interpretacja zbiorcza (przewodnik)

- Filtruj scenariusze parami (ta sama: metoda, Hz, payload, N klientów) aby porównywać protokoły.
- Stabilność statystyk: sprawdź względny CI95 (jeśli dostępny w tabelach szczegółowych) – <30% oznacza akceptowalną stabilność krótkiego przebiegu.
- Jeśli różnica w Rate/cli między WS a HTTP <10–15% i CI się nakładają – brak jednoznacznej przewagi szybkości dostarczania (dla source-limited jest to normalne).
- Jitter: duże wartości (>> średniej inter‑arrival) sygnalizują koalescencję timerów lub przeciążenie event loop.
- Staleness: utrzymywanie się ~1000 ms przy nominalnych częstotliwościach >1 Hz oznacza ograniczenie źródła (source-limited) – interpretuj CPU/jitter, nie sam Rate.
- Overhead_ratio_CPU >2 wskazuje na wyraźnie wyższy jednostkowy koszt polling względem push.

## Jakość danych i kontrola spójności

- Relacja spójności: $err_{bytes} = \left|1 - \frac{Bytes/s}{Rate \times Payload}\right|$ – jeśli >0.3, oznacz do inspekcji.
- Puste lub zerowe serie latencji E2E (Ingest/Emit) interpretuj jako brak danych (syntetyczne opóźnienia mogą być bardzo małe); nie wnioskuj o „braku latencji”.
- Przy n (liczebności próbek) < 8 traktuj CI jako orientacyjne – zalecane powtórzenia.
