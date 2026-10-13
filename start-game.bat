@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js has not been installed. Please install Node.js 18+ first.
  pause
  exit /b 1
)
echo.
echo POKER MAZE ONLINE - Open http://localhost:3000 in your browser
echo Keep this window open while players are connected.
echo.
start "" "http://localhost:3000"
node server.js
pause
