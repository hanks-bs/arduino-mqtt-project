# Glosariusz terminów (PL/EN)

| Termin (PL)                      | English                 | Uwagi / Kontekst / Wzór                                                                                     |
| -------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| statystyki zbiorcze              | aggregated statistics   | Średnie, mediany, percentyle, przedziały ufności (CI)                                                       |
| zestawienia wg obciążenia        | load-wise summaries     | Uśrednienie wyników per poziom sztucznego obciążenia CPU                                                    |
| zestawienia wg klientów          | client-wise summaries   | Uśrednienie per liczba klientów (N)                                                                         |
| częstość (Rate)                  | event rate              | $Rate = \frac{\sum events}{czas}$ lub aproks. ważona: $\bar r = \frac{\sum r_i\,dt_i}{\sum dt_i}$           |
| Bytes/s                          | throughput              | $Bytes/s \approx Rate \times Payload$ (kontrola spójności)                                                  |
| ~Payload                         | payload size            | Średni rozmiar ładunku: $Payload = \frac{Bytes/s}{Rate}$ (gdy Rate>0)                                       |
| jitter                           | jitter                  | Odchylenie std. odstępów inter‑arrival: $j = \sqrt{\frac{1}{m-1}\sum (\Delta t_i-\overline{\Delta t})^2}$   |
| staleness (wiek danych)          | staleness / freshness   | $Staleness = t_{obserwacji} - t_{ostatniego\_źródła}$ (niżej=świeższe)                                      |
| percentyl p (np. p95)            | percentile              | $p$‑ty percentyl = wartość porządku $k=\lceil p\cdot n \rceil$ po posortowaniu prób (definicja uproszczona) |
| mediana                          | median                  | 50. percentyl; odporna na outliery                                                                          |
| odchylenie standardowe           | standard deviation      | $s = \sqrt{\tfrac{1}{n-1}\sum (x_i-\bar x)^2}$                                                              |
| błąd standardowy                 | standard error (SE)     | $SE = s/\sqrt{n}$                                                                                           |
| CI95                             | 95% confidence interval | Dla dużego n: $CI_{95} = 1.96\cdot SE$ (normalna aproksymacja)                                              |
| ELU (Event Loop Utilization)     | event loop utilization  | $ELU = \frac{active\_time}{active\_time + idle\_time}$ (wg Node perf_hooks)                                 |
| EL delay p99                     | event loop delay p99    | 99. percentyl opóźnienia pętli zdarzeń (miara presji)                                                       |
| CPU_per_msg_WS / req_HTTP        | unit CPU cost           | $CPU\_per\_msg = \frac{CPU\%}{Rate_{WS}}$, analogicznie $CPU\_per\_req = \frac{CPU\%}{Rate_{HTTP}}$         |
| Overhead_ratio_CPU               | overhead ratio          | $\frac{CPU\_per\_req\_{HTTP}}{CPU\_per\_msg\_{WS}}$ > 1 → polling mniej efektywny                           |
| egress (szac.)                   | egress (estimated)      | WS: $Egress \approx Rate \times Payload \times N$ ; HTTP: $Egress \approx Bytes/s$                          |
| Rate/cli                         | per‑client rate         | HTTP: $Rate/N$; WS (broadcast): $Rate$                                                                      |
| Bytes/cli                        | per‑client bytes        | HTTP: $(Bytes/s)/N$; WS: $Rate\times Payload$ (równoważnie $(Bytes/s)/N$ przy N>0)                          |
| source-limited                   | source-limited          | Mierzony Rate < zadeklarowany bo źródło publikuje wolniej (~1 Hz)                                           |
| transport-limited                | transport-limited       | Degradacja przy wzroście Hz/klientów (spadek jakości metryk, wzrost opóźnień)                               |
| fair payload                     | fair payload            | Ładunek dostarczony w tolerancji (domyślnie ±50%)                                                           |
| efektywna liczebność ($n_{eff}$) | effective sample size   | Przy autokorelacji $n_{eff} < n$; tu przyjmujemy uproszczenie $n_{eff}=n$ (możliwe rozszerzenie)            |
| broadcast (złożoność)            | broadcast complexity    | WS emisja: O(N) kopiowania bufora; HTTP: O(N) pełnych request/response (wyższy narzut stały)                |
| trimming (warmup/cooldown)       | trimming                | Usunięcie próbek początkowych/końcowych dla stabilizacji statystyk                                          |
| p95 (percentyl 95)               | 95th percentile         | Wartość poniżej której znajduje się 95% próbek (miara sporadycznych pików)                                  |
| Jitter-Stability ratio           | jitter-stability ratio  | $\frac{jitter}{\overline{\Delta t}}$ – relatywna niestabilność interwałów (opcjonalna metryka)              |
| Staleness ratio                  | staleness ratio         | $Staleness/\overline{\Delta t_{źródła}}$ – wykrywa ograniczenie źródła (≈1 gdy source-limited)              |

Aktualizacja terminologii: dotychczasowe wystąpienia słowa "agregaty" zostały zastąpione formami "statystyki zbiorcze" lub "zestawienia" zależnie od kontekstu (opis sekcji vs. nazwy tabel).
