@echo off
setlocal
cd /d "%~dp0"

if not exist node_modules (
  call npm install
  if errorlevel 1 (
    echo Installazione dipendenze fallita.
    pause
    exit /b 1
  )
)

start "Roverpunk Server" /min cmd /c "set PORT=5174&& npm run dev"

echo Attendo l'avvio del server...
:waitloop
timeout /t 1 /nobreak >nul
curl --silent --fail http://localhost:5174/api/state >nul 2>&1
if errorlevel 1 goto waitloop

start "" "http://localhost:5174"

echo Server avviato. Chiudi questa finestra per terminare Roverpunk.
pause >nul

taskkill /fi "WindowTitle eq Roverpunk Server*" /t /f >nul 2>&1
