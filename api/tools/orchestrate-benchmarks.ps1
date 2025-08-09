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

.EXAMPLE
  pwsh -File ./api/tools/orchestrate-benchmarks.ps1 -Hz "1,2" -Load "0,25,50" -DurationSet "6" -TickSet "200" -ClientsHttpSet "0,3" -ClientsWsSet "0,3" -Repeats 2
#>

[CmdletBinding()]
param(
  [string]$Modes = "ws,polling",
  [string]$Hz = "1,2",
  [string]$Load = "0,25,50",
  [string]$DurationSet = "6",
  [string]$TickSet = "150,200",
  [string]$ClientsHttpSet = "0,3",
  [string]$ClientsWsSet = "0,3",
  [int]$Repeats = 1
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

# Przejdź do katalogu api/
Push-Location (Join-Path $PSScriptRoot '..')
try {
  $benchRoot = Join-Path (Get-Location) 'benchmarks'
  if (-not (Test-Path $benchRoot)) { New-Item -ItemType Directory -Path $benchRoot | Out-Null }
  $indexCsv = Join-Path $benchRoot '_index.csv'
  $allCsv   = Join-Path $benchRoot '_all_summaries.csv'
  if (-not (Test-Path $indexCsv)) {
    'timestampDir,modes,hz,load,durationSec,tickMs,clientsHttp,clientsWs,sessionsCount,wsCount,httpCount,path' | Out-File -FilePath $indexCsv -Encoding utf8
  }
  if (-not (Test-Path $allCsv)) {
    'timestampDir,label,mode,loadCpuPct,count,avgRate,avgBytesRate,avgPayload,avgJitterMs,avgFreshnessMs,avgDelayP99,avgCpu,avgRss,ci95Rate,ci95Bytes,tickMs,durationSec,clientsHttp,clientsWs' | Out-File -FilePath $allCsv -Encoding utf8
  }

  foreach ($dur in $durations) {
    foreach ($tick in $ticks) {
      foreach ($cHttp in $cHttpSet) {
        foreach ($cWs in $cWsSet) {
          for ($r = 1; $r -le [Math]::Max(1,$Repeats); $r++) {
            Write-Host "[Matrix] Run: modes=$Modes; hz=$Hz; load=$Load; dur=${dur}s; tick=${tick}ms; cHttp=$cHttp; cWs=$cWs; rep=$r" -ForegroundColor Cyan
            $args = @('--', '--modes', $Modes, '--hz', $Hz, '--load', $Load, '--dur', "$dur", '--tick', "$tick")
            if ($cHttp -gt 0) { $args += @('--clientsHttp', "$cHttp") }
            if ($cWs -gt 0)   { $args += @('--clientsWs',   "$cWs") }

            & npm.cmd run measure --silent @args
            if ($LASTEXITCODE -ne 0) { Write-Error "Runner zwrócił kod $LASTEXITCODE" }

            # Zaktualizuj dokument badawczy po każdym przebiegu
            & npm.cmd run docs:research:update --silent

            # Pobierz najnowszy katalog z wynikami
            $last = Get-ChildItem $benchRoot -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
            if ($null -eq $last) { Write-Warning 'Brak katalogu wyników'; continue }

            # Wczytaj summary.json
            $summaryPath = Join-Path $last.FullName 'summary.json'
            if (-not (Test-Path $summaryPath)) { Write-Warning "Brak summary.json w $($last.Name)"; continue }
            $json = Get-Content -Raw -Path $summaryPath | ConvertFrom-Json

            # Policz ws/http
            $wsCount = ($json.summaries | Where-Object { $_.mode -eq 'ws' }).Count
            $httpCount = ($json.summaries | Where-Object { $_.mode -eq 'polling' }).Count
            $sessCount = ($json.summaries).Count

            # Dopisz indeks
            $line = @(
              $last.Name,
              '"' + $Modes + '"',
              '"' + $Hz + '"',
              '"' + $Load + '"',
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

  Write-Host "[Matrix] Zakończono. Zbiorcze pliki:" -ForegroundColor Green
  Write-Host " - $indexCsv"
  Write-Host " - $allCsv"
}
finally {
  Pop-Location
}
