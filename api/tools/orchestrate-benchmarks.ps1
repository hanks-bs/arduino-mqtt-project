<#!
.SYNOPSIS
  Orkiestruje wiele przebiegów benchmarków (WS + HTTP) po macierzy parametrów
  i generuje zbiorcze indeksy CSV z podsumowaniami.

.DESCRIPTION
  Dla każdej kombinacji z DurationSet x TickSet x ClientsHttpSet x ClientsWsSet
  uruchamia measurementRunner z zadanymi zestawami Hz i obciążeń (Load, Hz)
  i po każdym przebiegu dopisuje rekord do:
   - benchmarks/_index.csv (metadane runu)
   - benchmarks/_all_summaries.csv (agregaty z summary.json per sesja)

.PARAMETER Modes
  Metody pomiaru, np. "ws,polling" (domyślnie: ws,polling)

.PARAMETER Hz
  Zestaw częstotliwości, np. "1,2,5" (domyślnie: 1,2)

.PARAMETER Load
  Zestaw obciążeń CPU, np. "0,25,50" (domyślnie: 0,25,50)

.PARAMETER DurationSet
  Zestaw czasów trwania sesji, np. "3,6" (domyślnie: 6)

.PARAMETER TickSet
  Zestaw MONITOR_TICK_MS, np. "150,200" (domyślnie: 200)

.PARAMETER ClientsHttpSet
  Zestaw liczby klientów HTTP, np. "0,3" (domyślnie: 0)

.PARAMETER ClientsWsSet
  Zestaw liczby klientów WS, np. "0,3" (domyślnie: 0)

.PARAMETER Repeats
  Liczba powtórzeń każdej kombinacji (domyślnie: 1)

.PARAMETER LoadWorkersSet
  Zestaw liczby wątków generatora obciążenia CPU (worker_threads), np. "1,2,4" (domyślnie: 1)

.PARAMETER Warmup
  Czas odrzucany na początku sesji (sekundy). Domyślnie 0.5.

.PARAMETER Cooldown
  Czas odrzucany na końcu sesji (sekundy). Domyślnie 0.5.

.PARAMETER Payload
  Wspólny payload [B] dla WS/HTTP (jeśli nie podano specyficznych). Domyślnie 360.

.PARAMETER PayloadWs
  Payload [B] wymuszony dla WS. Nadpisuje Payload.

.PARAMETER PayloadHttp
  Payload [B] wymuszony dla HTTP. Nadpisuje Payload.

.EXAMPLE
  pwsh -File ./api/tools/orchestrate-benchmarks.ps1 -Hz "1,2" -Load "0,25,50" -DurationSet "6" -TickSet "200" -ClientsHttpSet "0,10,25,50" -ClientsWsSet "0,10,25,50" -Repeats 1
#>

[CmdletBinding()]
param(
  [string]$Modes = "ws,polling",
  [string]$Hz = "0.5,1,2,5",
  [string]$Load = "0,25,50",
  [string]$DurationSet = "60",
  [string]$TickSet = "200",
  [string]$ClientsHttpSet = "0,10,25,50",
  [string]$ClientsWsSet = "0,10,25,50",
  [string]$LoadWorkersSet = "1",
  [int]$Repeats = 3,
  [double]$Warmup = 2,
  [double]$Cooldown = 2,
  [int]$CpuSampleMs = 1000,
  [switch]$DisablePidusage,
  [switch]$PairClients,
  [int]$Payload = 360,
  [Nullable[int]]$PayloadWs = $null,
  [Nullable[int]]$PayloadHttp = $null
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Parse-IntList([string]$s) {
  return $s -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^-?\d+$' } | ForEach-Object { [int]$_ }
}

$durations = @(Parse-IntList $DurationSet)
if ($durations.Count -eq 0) { $durations = @(6) }
$ticks     = @(Parse-IntList $TickSet)
if ($ticks.Count -eq 0) { $ticks = @(200) }
$cHttpSet  = @(Parse-IntList $ClientsHttpSet)
if ($cHttpSet.Count -eq 0) { $cHttpSet = @(0) }
$cWsSet    = @(Parse-IntList $ClientsWsSet)
if ($cWsSet.Count -eq 0) { $cWsSet = @(0) }
$wSet      = @(Parse-IntList $LoadWorkersSet)
if ($wSet.Count -eq 0) { $wSet = @(1) }

# Przejdź do katalogu api/
Push-Location (Join-Path $PSScriptRoot '..')
try {
  $benchRoot = Join-Path (Get-Location) 'benchmarks'
  if (-not (Test-Path $benchRoot)) { New-Item -ItemType Directory -Path $benchRoot | Out-Null }
  $indexCsv = Join-Path $benchRoot '_index.csv'
  $allCsv   = Join-Path $benchRoot '_all_summaries.csv'
  if (-not (Test-Path $indexCsv)) {
  'timestampDir,modes,hz,load,loadWorkers,durationSec,tickMs,clientsHttp,clientsWs,sessionsCount,wsCount,httpCount,path' | Out-File -FilePath $indexCsv -Encoding utf8
  }
  if (-not (Test-Path $allCsv)) {
  'timestampDir,label,mode,loadCpuPct,loadWorkers,count,avgRate,avgBytesRate,avgPayload,avgJitterMs,avgFreshnessMs,avgDelayP99,avgCpu,avgRss,ci95Rate,ci95Bytes,tickMs,durationSec,clientsHttp,clientsWs' | Out-File -FilePath $allCsv -Encoding utf8
  }

  foreach ($dur in $durations) {
    foreach ($tick in $ticks) {
      foreach ($w in $wSet) {
  # Utwórz wspólny folder wyjściowy dla całej sesji (sticky)
  $sessionStamp = (Get-Date).ToString('yyyy-MM-ddTHH-mm-ss-fffZ')
  $stickyOut = Join-Path $benchRoot $sessionStamp
  New-Item -ItemType Directory -Path $stickyOut -ErrorAction SilentlyContinue | Out-Null
        if ($PairClients) {
          # Iterate only matching pairs (cHttp == cWs); use intersection, fallback to union if empty
          $cPairs = @()
          $inter = @($cHttpSet | Where-Object { $cWsSet -contains $_ })
          if ($inter.Count -gt 0) {
            $cPairs = @($inter)
          } else {
            $cPairs = @([System.Linq.Enumerable]::Distinct([int[]]@($cHttpSet + $cWsSet)))
          }
          foreach ($c in $cPairs) {
            $cHttp = [int]$c; $cWs = [int]$c
            Write-Host "[Matrix] Run: modes=$Modes; hz=$Hz; load=$Load; workers=$w; dur=${dur}s; tick=${tick}ms; cHttp=$cHttp; cWs=$cWs; repeats=$Repeats (runner)" -ForegroundColor Cyan
              # Ustaw parametry przez ENV (bardziej niezawodne niż przekazywanie flag npm)
              # Uwaga: powtórzenia realizuje measurementRunner (MEASURE_REPEATS); brak pętli po rep w orkiestratorze.
              $prevEnv = @{
                MEASURE_MODES           = $env:MEASURE_MODES
                MEASURE_HZ_SET          = $env:MEASURE_HZ_SET
                MEASURE_LOAD_SET        = $env:MEASURE_LOAD_SET
                MEASURE_DURATION_SEC    = $env:MEASURE_DURATION_SEC
                MONITOR_TICK_MS         = $env:MONITOR_TICK_MS
                MEASURE_CLIENTS_HTTP    = $env:MEASURE_CLIENTS_HTTP
                MEASURE_CLIENTS_WS      = $env:MEASURE_CLIENTS_WS
                MEASURE_WARMUP_SEC      = $env:MEASURE_WARMUP_SEC
                MEASURE_COOLDOWN_SEC    = $env:MEASURE_COOLDOWN_SEC
                MEASURE_REPEATS         = $env:MEASURE_REPEATS
                MEASURE_LOAD_WORKERS    = $env:MEASURE_LOAD_WORKERS
                MONITOR_CPU_SAMPLE_MS   = $env:MONITOR_CPU_SAMPLE_MS
                MONITOR_DISABLE_PIDUSAGE= $env:MONITOR_DISABLE_PIDUSAGE
                MEASURE_PAYLOAD         = $env:MEASURE_PAYLOAD
                MEASURE_PAYLOAD_WS      = $env:MEASURE_PAYLOAD_WS
                MEASURE_PAYLOAD_HTTP    = $env:MEASURE_PAYLOAD_HTTP
              }
              $env:MEASURE_MODES = $Modes
              $env:MEASURE_HZ_SET = $Hz
              $env:MEASURE_LOAD_SET = $Load
              $env:MEASURE_DURATION_SEC = "$dur"
              $env:MONITOR_TICK_MS = "$tick"
              $env:MEASURE_CLIENTS_HTTP = "$cHttp"
              $env:MEASURE_CLIENTS_WS = "$cWs"
              # Ustaw też *_SET, aby runner potraktował je jako zestawy i poprawnie oznaczył etykiety cHttp=/cWs=
              $env:MEASURE_CLIENTS_HTTP_SET = "$cHttp"
              $env:MEASURE_CLIENTS_WS_SET = "$cWs"
              $env:MEASURE_WARMUP_SEC = "$Warmup"
              $env:MEASURE_COOLDOWN_SEC = "$Cooldown"
              $env:MEASURE_REPEATS = "$Repeats"
              $env:MEASURE_LOAD_WORKERS = "$w"
              $env:MEASURE_OUTPUT_DIR = "benchmarks/$sessionStamp"
              # Payloady
              if ($PayloadWs -ne $null) {
                $env:MEASURE_PAYLOAD_WS = "$PayloadWs"
              } else {
                $env:MEASURE_PAYLOAD_WS = "$Payload"
              }
              if ($PayloadHttp -ne $null) {
                $env:MEASURE_PAYLOAD_HTTP = "$PayloadHttp"
              } else {
                $env:MEASURE_PAYLOAD_HTTP = "$Payload"
              }
              $env:MEASURE_PAYLOAD = "$Payload"
              if ($CpuSampleMs -gt 0) { $env:MONITOR_CPU_SAMPLE_MS = "$CpuSampleMs" }
              if ($DisablePidusage) { $env:MONITOR_DISABLE_PIDUSAGE = "1" } else { Remove-Item Env:MONITOR_DISABLE_PIDUSAGE -ErrorAction SilentlyContinue }

              $env:MEASURE_PAIR = "1"
              & npm.cmd run measure --silent -- --clientsHttp $cHttp --clientsWs $cWs

              # Przywróć ENV
              foreach ($k in $prevEnv.Keys) {
                if ($null -eq $prevEnv[$k]) {
                  Remove-Item -Path ("Env:" + $k) -ErrorAction SilentlyContinue
                } else {
                  Set-Item -Path ("Env:" + $k) -Value $prevEnv[$k]
                }
              }
              # Zachowaj znacznik katalogu w indexie (sticky)
              if ($LASTEXITCODE -ne 0) { Write-Error "Runner zwrócił kod $LASTEXITCODE" }

              & npm.cmd run docs:research:update --silent

              $last = Get-Item $stickyOut
              if ($null -eq $last) { Write-Warning 'Brak katalogu wyników'; continue }
              $summaryPath = Join-Path $last.FullName 'summary.json'
              if (-not (Test-Path $summaryPath)) { Write-Warning "Brak summary.json w $($last.Name)"; continue }
              $json = Get-Content -Raw -Path $summaryPath | ConvertFrom-Json
              $wsCount = @($json.summaries | Where-Object { $_.mode -eq 'ws' }).Count
              $httpCount = @($json.summaries | Where-Object { $_.mode -eq 'polling' }).Count
              $sessCount = @($json.summaries).Count
              $line = @(
                $last.Name,
                '"' + $Modes + '"',
                '"' + $Hz + '"',
                '"' + $Load + '"',
                $w,
                $dur,
                $tick,
                $cHttp,
                $cWs,
                $sessCount,
                $wsCount,
                $httpCount,
                '"' + $last.FullName + '"'
              ) -join ','
              Add-Content -Path $indexCsv -Value $line

              foreach ($s in $json.summaries) {
                $row = @(
                  $last.Name,
                  '"' + ($s.label -replace '"','''') + '"',
                  $s.mode,
                  [int]$s.loadCpuPct,
                  $w,
                  [int]$s.count,
                  [string]::Format('{0:F3}',[double]$s.avgRate),
                  [string]::Format('{0:F0}',[double]$s.avgBytesRate),
                  [string]::Format('{0:F0}',[double]$s.avgPayload),
                  [string]::Format('{0:F1}',[double]$s.avgJitterMs),
                  [string]::Format('{0:F0}',[double]$s.avgFreshnessMs),
                  [string]::Format('{0:F1}',[double]$s.avgDelayP99),
                  [string]::Format('{0:F1}',[double]$s.avgCpu),
                  [string]::Format('{0:F1}',[double]$s.avgRss),
                  [string]::Format('{0:F2}',[double]$s.ci95Rate),
                  [string]::Format('{0:F0}',[double]$s.ci95Bytes),
                  $tick,
                  $dur,
                  $cHttp,
                  $cWs
                ) -join ','
                Add-Content -Path $allCsv -Value $row
              }
          }
        }
        else {
          # Utwórz wspólny folder wyjściowy dla całej sesji (sticky)
          $sessionStamp = (Get-Date).ToString('yyyy-MM-ddTHH-mm-ss-fffZ')
          $stickyOut = Join-Path $benchRoot $sessionStamp
          New-Item -ItemType Directory -Path $stickyOut -ErrorAction SilentlyContinue | Out-Null
          foreach ($cHttp in $cHttpSet) {
            foreach ($cWs in $cWsSet) {
              Write-Host "[Matrix] Run: modes=$Modes; hz=$Hz; load=$Load; workers=$w; dur=${dur}s; tick=${tick}ms; cHttp=$cHttp; cWs=$cWs; repeats=$Repeats (runner)" -ForegroundColor Cyan
              # Ustaw parametry przez ENV (bardziej niezawodne niż przekazywanie flag npm)
              # Uwaga: powtórzenia realizuje measurementRunner (MEASURE_REPEATS); brak pętli po rep w orkiestratorze.
              $prevEnv = @{
                MEASURE_MODES           = $env:MEASURE_MODES
                MEASURE_HZ_SET          = $env:MEASURE_HZ_SET
                MEASURE_LOAD_SET        = $env:MEASURE_LOAD_SET
                MEASURE_DURATION_SEC    = $env:MEASURE_DURATION_SEC
                MONITOR_TICK_MS         = $env:MONITOR_TICK_MS
                MEASURE_CLIENTS_HTTP    = $env:MEASURE_CLIENTS_HTTP
                MEASURE_CLIENTS_WS      = $env:MEASURE_CLIENTS_WS
                MEASURE_WARMUP_SEC      = $env:MEASURE_WARMUP_SEC
                MEASURE_COOLDOWN_SEC    = $env:MEASURE_COOLDOWN_SEC
                MEASURE_REPEATS         = $env:MEASURE_REPEATS
                MEASURE_LOAD_WORKERS    = $env:MEASURE_LOAD_WORKERS
                MONITOR_CPU_SAMPLE_MS   = $env:MONITOR_CPU_SAMPLE_MS
                MONITOR_DISABLE_PIDUSAGE= $env:MONITOR_DISABLE_PIDUSAGE
                MEASURE_PAYLOAD         = $env:MEASURE_PAYLOAD
                MEASURE_PAYLOAD_WS      = $env:MEASURE_PAYLOAD_WS
                MEASURE_PAYLOAD_HTTP    = $env:MEASURE_PAYLOAD_HTTP
              }
              $env:MEASURE_MODES = $Modes
              $env:MEASURE_HZ_SET = $Hz
              $env:MEASURE_LOAD_SET = $Load
              $env:MEASURE_DURATION_SEC = "$dur"
              $env:MONITOR_TICK_MS = "$tick"
              $env:MEASURE_CLIENTS_HTTP = "$cHttp"
              $env:MEASURE_CLIENTS_WS = "$cWs"
              # Ustaw też *_SET, aby runner potraktował je jako zestawy i poprawnie oznaczył etykiety cHttp=/cWs=
              $env:MEASURE_CLIENTS_HTTP_SET = "$cHttp"
              $env:MEASURE_CLIENTS_WS_SET = "$cWs"
              $env:MEASURE_WARMUP_SEC = "$Warmup"
              $env:MEASURE_COOLDOWN_SEC = "$Cooldown"
              $env:MEASURE_REPEATS = "$Repeats"
              $env:MEASURE_LOAD_WORKERS = "$w"
              $env:MEASURE_OUTPUT_DIR = "benchmarks/$sessionStamp"
              # Payloady
              if ($PayloadWs -ne $null) {
                $env:MEASURE_PAYLOAD_WS = "$PayloadWs"
              } else {
                $env:MEASURE_PAYLOAD_WS = "$Payload"
              }
              if ($PayloadHttp -ne $null) {
                $env:MEASURE_PAYLOAD_HTTP = "$PayloadHttp"
              } else {
                $env:MEASURE_PAYLOAD_HTTP = "$Payload"
              }
              $env:MEASURE_PAYLOAD = "$Payload"
              if ($CpuSampleMs -gt 0) { $env:MONITOR_CPU_SAMPLE_MS = "$CpuSampleMs" }
              if ($DisablePidusage) { $env:MONITOR_DISABLE_PIDUSAGE = "1" } else { Remove-Item Env:MONITOR_DISABLE_PIDUSAGE -ErrorAction SilentlyContinue }

              & npm.cmd run measure --silent -- --clientsHttp $cHttp --clientsWs $cWs

              # Przywróć ENV
              foreach ($k in $prevEnv.Keys) {
                if ($null -eq $prevEnv[$k]) {
                  Remove-Item -Path ("Env:" + $k) -ErrorAction SilentlyContinue
                } else {
                  Set-Item -Path ("Env:" + $k) -Value $prevEnv[$k]
                }
              }
              if ($LASTEXITCODE -ne 0) { Write-Error "Runner zwrócił kod $LASTEXITCODE" }

              # Zaktualizuj dokument badawczy po każdym przebiegu
              & npm.cmd run docs:research:update --silent

              # Pobierz najnowszy katalog z wynikami
              $last = Get-Item $stickyOut
              if ($null -eq $last) { Write-Warning 'Brak katalogu wyników'; continue }

              # Wczytaj summary.json
              $summaryPath = Join-Path $last.FullName 'summary.json'
              if (-not (Test-Path $summaryPath)) { Write-Warning "Brak summary.json w $($last.Name)"; continue }
              $json = Get-Content -Raw -Path $summaryPath | ConvertFrom-Json

              # Policz ws/http
              $wsCount = @($json.summaries | Where-Object { $_.mode -eq 'ws' }).Count
              $httpCount = @($json.summaries | Where-Object { $_.mode -eq 'polling' }).Count
              $sessCount = @($json.summaries).Count

              # Dopisz indeks
              $line = @(
                $last.Name,
                '"' + $Modes + '"',
                '"' + $Hz + '"',
                '"' + $Load + '"',
                $w,
                $dur,
                $tick,
                $cHttp,
                $cWs,
                $sessCount,
                $wsCount,
                $httpCount,
                '"' + $last.FullName + '"'
              ) -join ','
              Add-Content -Path $indexCsv -Value $line

              # Dopisz wszystkie summaries do all_summaries.csv
              foreach ($s in $json.summaries) {
                $row = @(
                  $last.Name,
                  '"' + ($s.label -replace '"','''') + '"',
                  $s.mode,
                  [int]$s.loadCpuPct,
                  $w,
                  [int]$s.count,
                  [string]::Format('{0:F3}',[double]$s.avgRate),
                  [string]::Format('{0:F0}',[double]$s.avgBytesRate),
                  [string]::Format('{0:F0}',[double]$s.avgPayload),
                  [string]::Format('{0:F1}',[double]$s.avgJitterMs),
                  [string]::Format('{0:F0}',[double]$s.avgFreshnessMs),
                  [string]::Format('{0:F1}',[double]$s.avgDelayP99),
                  [string]::Format('{0:F1}',[double]$s.avgCpu),
                  [string]::Format('{0:F1}',[double]$s.avgRss),
                  [string]::Format('{0:F2}',[double]$s.ci95Rate),
                  [string]::Format('{0:F0}',[double]$s.ci95Bytes),
                  $tick,
                  $dur,
                  $cHttp,
                  $cWs
                ) -join ','
                Add-Content -Path $allCsv -Value $row
              }
          }
        }
        }
      }
    }
  }

  Write-Host "[Matrix] Zakończono. Zbiorcze pliki:" -ForegroundColor Green
  Write-Host " - $indexCsv"
  Write-Host " - $allCsv"
}
finally {
  Pop-Location
}
