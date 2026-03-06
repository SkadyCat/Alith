@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================
echo   Alice (AliceDoc) One-Click Deployment
echo   github.com/SkadyCat/Alith
echo ============================================
echo.

:: ── Check Node.js ────────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js: https://nodejs.org
  pause & exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo [OK] Node.js %NODE_VER%

:: ── Check Git ──────────────────────────────────────────────────
where git >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Git not found. Please install Git: https://git-scm.com
  pause & exit /b 1
)
for /f "tokens=*" %%v in ('git --version') do set GIT_VER=%%v
echo [OK] %GIT_VER%
echo.

:: ── Deploy directory ────────────────────────────────────────────
set DEPLOY_DIR=%~dp0
if exist "%DEPLOY_DIR%server.js" (
  echo [INFO] Already in Alice directory, skipping clone.
  cd /d "%DEPLOY_DIR%"
  goto :deps
)

set TARGET_DIR=%~dp0Alith
echo [INFO] Target directory: %TARGET_DIR%
if exist "%TARGET_DIR%\.git" (
  echo [INFO] Repository exists, running git pull...
  cd /d "%TARGET_DIR%"
  git pull origin master
) else (
  echo [INFO] Cloning repository from GitHub...
  git clone https://github.com/SkadyCat/Alith.git "%TARGET_DIR%"
  if errorlevel 1 (
    echo [ERROR] Clone failed. Check network or GitHub access.
    pause & exit /b 1
  )
  cd /d "%TARGET_DIR%"
)

:deps
echo.
echo [INFO] Installing npm dependencies...
npm install
if errorlevel 1 (
  echo [ERROR] npm install failed.
  pause & exit /b 1
)
echo [OK] npm dependencies installed.

:: ── Create required directories ─────────────────────────────────
echo.
echo [INFO] Initializing directory structure...
if not exist "docs"    mkdir docs
if not exist "docs\history"    mkdir docs\history
if not exist "docs\agent"      mkdir docs\agent
if not exist "docs\application_doc\magicworld" mkdir docs\application_doc\magicworld
if not exist "data"    mkdir data
if not exist "logs"    mkdir logs
if not exist "outputs" mkdir outputs
if not exist "runtime" mkdir runtime
echo [OK] Directories initialized.

:: ── Create MagicWorld config if not exists ──────────────────────
if not exist "docs\application_doc\magicworld\config.json" (
  echo {"publicIp":""} > docs\application_doc\magicworld\config.json
  echo [OK] MagicWorld config file created.
)

:: ── Install PowerShell Core 7 (portable) ────────────────────────
echo.
echo [INFO] Checking PowerShell Core 7 (tools\pwsh7\pwsh.exe)...
if exist "tools\pwsh7\pwsh.exe" (
  echo [OK] PowerShell Core 7 already installed.
) else (
  echo [INFO] PowerShell Core 7 not found. Downloading portable package...
  if not exist "tools" mkdir tools
  if not exist "tools\pwsh7" mkdir tools\pwsh7
  set PWSH_ZIP=%TEMP%\pwsh7.zip
  set PWSH_URL=https://github.com/PowerShell/PowerShell/releases/download/v7.5.0/PowerShell-7.5.0-win-x64.zip
  echo [INFO] Downloading from: !PWSH_URL!
  powershell -NoProfile -Command "try { $p=@{}; if ($env:HTTPS_PROXY) {$p.Proxy=$env:HTTPS_PROXY}; Invoke-WebRequest -Uri '!PWSH_URL!' -OutFile '!PWSH_ZIP!' @p -UseBasicParsing } catch { Write-Host '[ERROR] Download failed:' $_.Exception.Message; exit 1 }"
  if errorlevel 1 (
    echo [WARN] Auto-download failed. Please manually install PowerShell Core 7:
    echo        https://aka.ms/powershell
    echo        Or extract PowerShell-7.x-win-x64.zip to: tools\pwsh7\
  ) else (
    echo [INFO] Extracting...
    powershell -NoProfile -Command "Expand-Archive -Path '!PWSH_ZIP!' -DestinationPath 'tools\pwsh7' -Force"
    if errorlevel 1 (
      echo [WARN] Extraction failed. Please manually extract PowerShell 7 to tools\pwsh7\
    ) else (
      del /q "!PWSH_ZIP!" 2>nul
      echo [OK] PowerShell Core 7 installed to tools\pwsh7\
    )
  )
)

:: ── Install GitHub CLI (gh) ─────────────────────────────────────
echo.
echo [INFO] Checking GitHub CLI (gh)...
where gh >nul 2>&1
if errorlevel 1 (
  echo [INFO] GitHub CLI not found. Attempting to install via winget...
  winget install --id GitHub.cli -e --silent
  if errorlevel 1 (
    echo [WARN] winget install failed. Please install GitHub CLI manually:
    echo        https://cli.github.com/
  ) else (
    echo [OK] GitHub CLI installed.
    :: Refresh PATH
    set "PATH=%PATH%;%LOCALAPPDATA%\Microsoft\WinGet\Packages\GitHub.cli_Microsoft.Winget.Source_8wekyb3d8bbwe\tools"
  )
) else (
  for /f "tokens=*" %%v in ('gh --version 2^>nul') do (
    echo [OK] %%v
    goto :gh_ok
  )
)

:gh_ok
:: ── Install GitHub Copilot CLI extension ─────────────────────────
echo.
echo [INFO] Checking GitHub Copilot extension...
where gh >nul 2>&1
if not errorlevel 1 (
  gh extension list 2>nul | findstr /i "copilot" >nul 2>&1
  if errorlevel 1 (
    echo [INFO] Installing GitHub Copilot extension...
    gh extension install github/gh-copilot 2>nul
    if errorlevel 1 (
      echo [WARN] Copilot extension install failed. You may need to run: gh auth login first.
    ) else (
      echo [OK] GitHub Copilot extension installed.
    )
  ) else (
    echo [OK] GitHub Copilot extension already installed.
  )
  :: ── GitHub Auth check ────────────────────────────────────────
  gh auth status >nul 2>&1
  if errorlevel 1 (
    echo.
    echo [INFO] GitHub authentication required. Running: gh auth login
    gh auth login
  ) else (
    echo [OK] GitHub authentication: already logged in.
  )
) else (
  echo [WARN] gh CLI not available. Skipping Copilot extension setup.
  echo        Install GitHub CLI manually, then run: gh extension install github/gh-copilot
)

:: ── .env hint ──────────────────────────────────────────────────
echo.
if not exist ".env" (
  echo [INFO] To enable COS upload or other keys, create a .env file at:
  echo        %CD%\.env
  echo        Example: SECRET_ID=xxx  SECRET_KEY=yyy  PUBLIC_URL=http://YOUR_IP:7439
)

echo.
echo ============================================
echo   Deployment complete! Starting Alice...
echo   URL: http://localhost:7439
echo ============================================
echo.
node server.js
pause

