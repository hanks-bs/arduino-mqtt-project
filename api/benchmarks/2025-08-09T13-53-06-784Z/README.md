# Raport pomiarów — 2025-08-09T13-53-06-784Z

Ten folder zawiera surowe próbki (CSV) oraz podsumowanie z wstępną oceną.

- Plik CSV: ./sessions.csv
- Podsumowanie JSON: ./summary.json

## Podsumowanie (średnie)

| Label | Mode | Rate [/s] | Bytes/s | ~Payload [B] | Jitter [ms] | Świeżość [ms] | EL p99 [ms] | CPU [%] | RSS [MB] | Rate OK | Payload OK |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--:|:--:|
| WS@1Hz payload=360B | ws | 0.70 | 253 | 270 | 17.2 | 614 | 48.9 | 1.2 | 196.2 | ✅ | ✅ |
| WS@2Hz payload=360B | ws | 0.91 | 327 | 360 | 444.9 | 413 | 49.4 | 2.1 | 196.4 | ❌ | ✅ |
| HTTP@1Hz payload=420B | polling | 0.41 | 174 | 350 | 0.3 | 719 | 50.0 | 9.4 | 182.9 | ❌ | ✅ |
| HTTP@2Hz payload=420B | polling | 0.83 | 347 | 350 | 280.2 | 426 | 48.8 | 2.3 | 174.8 | ❌ | ✅ |

Legenda: Rate OK / Payload OK — wstępna ocena względem oczekiwań (±50%).

## Jak czytać wyniki i powiązanie z dashboardem


- Częstość (Rate) — odpowiada wykresom częstości WS/HTTP w dashboardzie.
- Bytes/s i ~Payload — odpowiada wykresom przepustowości i średniego rozmiaru ładunku.
- Jitter — odpowiada wskaźnikowi stabilności sygnału (niższy lepszy). 
- Świeżość danych — czas od ostatniego odczytu (niższy lepszy, WS zwykle świeższy niż HTTP).
- EL p99 — opóźnienie pętli zdarzeń (korelacja z responsywnością backendu).
- CPU/RSS — metryki systemowe w panelu zasobów.


## Słownik kolumn CSV


- sessionId — identyfikator sesji
- label — etykieta (zawiera Hz i payload użyte do oczekiwań)
- mode — 'ws' lub 'polling'
- startedAt/finishedAt — znaczniki czasu
- sampleIndex/ts — indeks i czas próbki
- cpu — obciążenie procesu Node [%]
- rssMB/heapUsedMB — pamięć (RSS, sterta)
- elu — Event Loop Utilization (0..1)
- elDelayP99Ms — opóźnienie pętli zdarzeń (p99) [ms]
- httpReqRate/wsMsgRate — częstość żądań/wiadomości [/s]
- httpBytesRate/wsBytesRate — przepustowość [B/s]
- httpAvgBytesPerReq/wsAvgBytesPerMsg — średni ładunek [B]
- httpJitterMs/wsJitterMs — zmienność odstępów (stddev) [ms]
- dataFreshnessMs — świeżość danych (czas od ostatniego pomiaru) [ms]


## Parametry i założenia


- Czas pojedynczej sesji: ~6s (+bufor). 
- WS: sterownik o stałej częstotliwości (wsFixedRateHz).
- HTTP: symulacja odpowiedzi (onHttpResponse) z określonym payloadem.
- Emisje na żywo: wyłączone na czas pomiarów (izolacja), kontrola przez ResourceMonitor.


## Uwagi i wnioski wstępne

- WS@1Hz payload=360B: rate=0.70 in [0.50, 1.50]; bytesPerUnit=360.0 in [180.0, 540.0]
- WS@2Hz payload=360B: rate=0.91 in [1.00, 3.00]; bytesPerUnit=360.0 in [180.0, 540.0]
- HTTP@1Hz payload=420B: rate=0.41 in [0.50, 1.50]; bytesPerUnit=420.0 in [210.0, 630.0]
- HTTP@2Hz payload=420B: rate=0.83 in [1.00, 3.00]; bytesPerUnit=420.0 in [210.0, 630.0]
