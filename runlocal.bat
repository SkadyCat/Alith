@echo off
cd /d %~dp0

echo ===== AliceDoc - Local Mode =====

:: Kill process occupying port 7439
echo Checking port 7439...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":7439 "') do (
  echo   Killing PID %%a
  taskkill /PID %%a /F >nul 2>&1
)

timeout /t 1 /nobreak >nul

echo.
echo Starting AliceDoc local mode...
echo URL: http://localhost:7439
echo Press Ctrl+C to stop.
echo.
node server.js
echo.
echo Service exited.
pause
