<#!
.SYNOPSIS
  Uruchamia kompleksowy benchmark (WS + HTTP polling) z wariantami Hz i obciążenia CPU.

.DESCRIPTION
  Owijka dla "npm run measure" (measurementRunner.ts) odporna na PowerShell/Windows.
  Pozwala ustawić: metody, zestaw Hz, zestaw obciążeń, czas sesji, tick monitora i liczbę klientów.
  Po zakończeniu wypisuje ścieżkę do najnowszego katalogu z artefaktami (benchmarks/<timestamp>/).

.PARAMETER Modes
  Lista metod, np. "ws,polling" (domyślnie: ws,polling)

.PARAMETER Hz
  Lista częstotliwości w Hz, np. "1,2,5" (domyślnie: 1,2)

.PARAMETER Load
  Lista obciążeń CPU w %, np. "0,25,50" (domyślnie: 0,25,50)

.PARAMETER Duration
  Czas trwania pojedynczej sesji (sekundy). Domyślnie 6.

.PARAMETER Tick
  MONITOR_TICK_MS, odstęp próbkowania monitora w milisekundach. Domyślnie 200.

.PARAMETER ClientsHttp
  Liczba syntetycznych klientów HTTP polling. Domyślnie 0.

.PARAMETER ClientsWs
  Liczba syntetycznych klientów WebSocket. Domyślnie 0.

.EXAMPLE
  pwsh -File ./api/tools/run-benchmarks.ps1 -Modes "ws,polling" -Hz "1,2" -Load "0,25,50" -Duration 6 -Tick 200

.EXAMPLE
  # Szybki przebieg bez obciążenia
  pwsh -File ./api/tools/run-benchmarks.ps1 -Load "0" -Duration 3 -Tick 150
#>

[CmdletBinding()]
param(
  [string]$Modes = "ws,polling",
  [string]$Hz = "1,2",
  [string]$Load = "0,25,50",
  [int]$Duration = 6,
  [int]$Tick = 200,
  [int]$ClientsHttp = 0,
  [int]$ClientsWs = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Przejdź do katalogu api/
Push-Location (Join-Path $PSScriptRoot '..')
try {
  Write-Host "[Bench] Start: modes=$Modes; hz=$Hz; load=$Load; dur=${Duration}s; tick=${Tick}ms; cHttp=$ClientsHttp; cWs=$ClientsWs" -ForegroundColor Cyan

  # Zbuduj argumenty CLI dla runnera (unikanie problemów z env w PowerShell)
  $args = @('--', '--modes', $Modes, '--hz', $Hz, '--load', $Load, '--dur', "$Duration", '--tick', "$Tick")
  if ($ClientsHttp -gt 0) { $args += @('--clientsHttp', "$ClientsHttp") }
  if ($ClientsWs -gt 0)   { $args += @('--clientsWs',   "$ClientsWs") }

  # Uruchom benchmark
  & npm.cmd run measure --silent @args
  if ($LASTEXITCODE -ne 0) { Write-Error "Runner zwrócił kod $LASTEXITCODE" }

  # Zaktualizuj dokument badawczy po zakończeniu przebiegu
  & npm.cmd run docs:research:update --silent

  # Znajdź najnowszy folder benchmarków
  $benchDir = Join-Path (Get-Location) 'benchmarks'
  if (Test-Path $benchDir) {
    $last = Get-ChildItem $benchDir -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($null -ne $last) {
      Write-Host "[Bench] Wyniki: $($last.FullName)" -ForegroundColor Green
      # Wypisz kilka kluczowych plików
      $files = @('README.md','summary.json','sessions.csv','by_load.csv')
      foreach ($f in $files) {
        $p = Join-Path $last.FullName $f
        if (Test-Path $p) { Write-Host " - $f: $p" }
      }
    } else {
      Write-Warning "Nie znaleziono nowego katalogu z wynikami w $benchDir"
    }
  } else {
    Write-Warning "Brak katalogu benchmarks/"
  }
}
finally {
  Pop-Location
}
