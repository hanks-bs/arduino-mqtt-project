# Wyniki zbiorcze (agregacja wszystkich uruchomień)

Ten plik jest generowany automatycznie przez skrypt agregujący.

Artefakty:
- API: benchmarks/_aggregate.csv (pełne; nagłówki + wiersze)
- API: benchmarks/combined.csv (alias do powyższego, stabilna nazwa)
- API: benchmarks/_aggregate.json (te same dane w formacie JSON)

Ostatnio dodany katalog: 2025-08-11T21-44-38-121Z
Zakres trybów: ws, polling
Zakres Hz (z etykiet): 0.5, 1, 2
Liczba wierszy: 158

Jak używać:
- Otwórz CSV w Excel/LibreOffice/R/Python.
- Do filtrowania po Hz użyj kolumny 'hz'; po obciążeniu 'loadCpuPct'; po klientach 'clientsHttp/clientsWs'.
 - Nowe pola: relCi95Rate/Bytes (szerokość CI względem średniej), mediany i trimmed mean, bytesPerUnit (~ładunek), achievedRel (osiągnięta relacja avg/expected),
   oraz meta-run: monitorTickMs, durationSec, repeats, pair, fairPayload, sourceLimited.

Utworzono: 2025-08-12T11:00:25.072Z
