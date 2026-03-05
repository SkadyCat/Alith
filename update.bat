@echo off
chcp 65001 >nul
cd /d %~dp0

echo ===== Alice Update Script =====
echo Pulling latest code from GitHub...
echo.

git pull origin master
if errorlevel 1 (
  echo [ERROR] git pull failed. Check network or Git configuration.
  exit /b 1
)
echo [OK] Code updated.

echo Checking dependency changes...
npm install --prefer-offline
if errorlevel 1 (
  echo [WARN] npm install failed. Dependencies may not be updated.
)
echo [OK] Dependency check complete.

echo.
echo ===== Update complete. Please restart Alice service. =====
