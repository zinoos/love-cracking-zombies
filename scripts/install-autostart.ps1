# Sorgt dafuer, dass der Waechter nach jeder Anmeldung von selbst startet.
#
# Ohne das laeuft nach einem Neustart des PCs weder Spielserver noch Tunnel,
# und auf der Webseite steht wieder "Kein Spielserver erreichbar".
#
# Der Eintrag landet im Autostart-Ordner des angemeldeten Benutzers. Die
# Aufgabenplanung waere die sauberere Loesung, verlangt aber Adminrechte -
# der Autostart-Ordner kommt ohne aus.
#
#   Einrichten:   powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
#   Entfernen:    powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Entfernen

param([switch]$Entfernen)

$Projekt   = Split-Path -Parent $PSScriptRoot
$Autostart = [Environment]::GetFolderPath('Startup')
$Datei     = Join-Path $Autostart 'NeonStrike-Waechter.cmd'

if ($Entfernen) {
  if (Test-Path $Datei) { Remove-Item $Datei -Force; Write-Host "Autostart entfernt: $Datei" }
  else { Write-Host 'Kein Autostart-Eintrag vorhanden.' }
  exit 0
}

$Node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $Node) { Write-Error 'node wurde nicht gefunden - Node.js installieren.'; exit 1 }
if (-not (Test-Path (Join-Path $Projekt 'scripts\watchdog.js'))) {
  Write-Error "watchdog.js fehlt in $Projekt"; exit 1
}

# Zugangsdaten fuer die Bestenliste mitgeben. Fehlen sie, laeuft der Server
# zwar, speichert Sterne und Gold aber nur in der lokalen Datei.
$Schluessel = $env:GOOGLE_SERVICE_ACCOUNT_FILE
if (-not $Schluessel -or -not (Test-Path $Schluessel)) {
  Write-Warning 'GOOGLE_SERVICE_ACCOUNT_FILE ist nicht gesetzt - Bestenliste laeuft ueber die lokale Datei.'
  $Schluessel = $null
}

$Zeilen = @(
  '@echo off',
  'rem Startet den Neon-Strike-Waechter im Hintergrund (automatisch erzeugt)',
  "cd /d `"$Projekt`"",
  'set FIREBASE_PROJECT_ID=nosershooter'
)
if ($Schluessel) { $Zeilen += "set GOOGLE_SERVICE_ACCOUNT_FILE=$Schluessel" }
# Ohne cmd-Wrapper und ohne Umleitung: die verschachtelten Anfuehrungszeichen
# hat cmd falsch zerlegt. Der Waechter schreibt sein Protokoll selbst.
$Zeilen += "start `"NeonStrike`" /min `"$Node`" scripts\watchdog.js"

Set-Content -Path $Datei -Value $Zeilen -Encoding ASCII

Write-Host "Autostart eingerichtet: $Datei"
Write-Host 'Er greift ab der naechsten Anmeldung. Jetzt sofort starten mit:'
Write-Host "  `"$Datei`""
