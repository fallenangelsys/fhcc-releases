@echo off
REM FHCC Server-Watchdog Installation
REM Kopiert Node + Watchdog nach C:\fhcc-watchdog und registriert Autostart (Startup-Ordner).

setlocal
set "DEST=C:\fhcc-watchdog"
set "SRC=%~dp0"

echo === FHCC Server-Watchdog Installation ===
if not exist "%DEST%" mkdir "%DEST%"

REM --- Node kopieren (falls nicht vorhanden) ---
if not exist "%DEST%\node.exe" (
  for %%N in (
    "C:\Users\pc\Documents\Codex\2026-08-10\work\node-v24.19.0-win-x64\node.exe"
  ) do (
    if exist "%%~N" (
      copy /Y "%%~N" "%DEST%\node.exe" >nul
      echo [OK] node.exe kopiert.
    ) else (
      echo [FEHLER] node.exe nicht gefunden: %%~N
      echo         Bitte node.exe manuell nach %DEST%\node.exe kopieren.
    )
  )
) else (
  echo [OK] node.exe ist bereits vorhanden.
)

REM --- Watchdog-Skript kopieren ---
copy /Y "%SRC%server-watchdog.mjs" "%DEST%\server-watchdog.mjs" >nul
echo [OK] server-watchdog.mjs kopiert.

REM --- Config anlegen (falls nicht vorhanden) ---
if not exist "%DEST%\server-watchdog.json" (
  echo { > "%DEST%\server-watchdog.json"
  echo   "webhookUrl": "" >> "%DEST%\server-watchdog.json"
  echo } >> "%DEST%\server-watchdog.json"
  echo [OK] Config angelegt: %DEST%\server-watchdog.json ^(webhookUrl eintragen!^)
) else (
  echo [OK] Config existiert bereits.
)

REM --- Autostart im Startup-Ordner ---
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "VBS=%STARTUP%\FHCC-Server-Watchdog.vbs"
(
  echo Set WshShell = CreateObject^("WScript.Shell"^)
  echo WshShell.Run """%DEST%\node.exe"" ""%DEST%\server-watchdog.mjs""", 0, False
) > "%VBS%"
echo [OK] Autostart registriert: %VBS%

echo.
echo === Fertig ===
echo 1. Webhook-URL in %DEST%\server-watchdog.json eintragen:
echo    { "webhookUrl": "https://discord.com/api/webhooks/..." }
echo 2. Start: "%DEST%\node.exe" "%DEST%\server-watchdog.mjs"
echo 3. Test: "%DEST%\node.exe" "%DEST%\server-watchdog.mjs" --once
echo.
endlocal
