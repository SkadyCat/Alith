@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================
echo   Alice (AliceDoc) One-Click Setup
echo   github.com/SkadyCat/Alith
echo ============================================
echo.

:: --- Check Node.js (required) ---
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is required. Install from: https://nodejs.org
  pause & exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo [OK] Node.js !NODE_VER!

:: --- Check Git ---
where git >nul 2>&1
if errorlevel 1 (
  echo [WARN] Git not found. Install from: https://git-scm.com
) else (
  for /f "tokens=*" %%v in ('git --version') do echo [OK] %%v
)
echo.

:: --- Deploy directory ---
set DEPLOY_DIR=%~dp0
if exist "%DEPLOY_DIR%server.js" (
  echo [INFO] Already in Alice directory.
  cd /d "%DEPLOY_DIR%"
  goto :deps
)

set TARGET_DIR=%~dp0Alith
echo [INFO] Target directory: !TARGET_DIR!
where git >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Git is required to clone. Please install Git.
  pause & exit /b 1
)
if exist "!TARGET_DIR!\.git" (
  echo [INFO] Repository exists, running git pull...
  cd /d "!TARGET_DIR!"
  git pull origin master
) else (
  echo [INFO] Cloning from GitHub...
  git clone https://github.com/SkadyCat/Alith.git "!TARGET_DIR!"
  if errorlevel 1 (
    echo [ERROR] Clone failed. Check network or GitHub access.
    pause & exit /b 1
  )
  cd /d "!TARGET_DIR!"
)

:deps
echo.
echo [INFO] Installing npm dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo [WARN] npm install had errors, continuing anyway...
)
echo [OK] npm step done.

:: --- Create required directories ---
echo.
echo [INFO] Initializing directories...
for %%d in (docs docs\history docs\agent data logs outputs runtime) do (
  if not exist "%%d" mkdir "%%d"
)
if not exist "docs\application_doc\magicworld" mkdir "docs\application_doc\magicworld"
if not exist "docs\application_doc\magicworld\config.json" (
  echo {"publicIp":""} > "docs\application_doc\magicworld\config.json"
)
echo [OK] Directories ready.

:: --- PowerShell Core 7 (required by Copilot CLI) ---
echo.
echo [INFO] Checking PowerShell Core 7...
if exist "tools\pwsh7\pwsh.exe" (
  echo [OK] PowerShell Core 7 found.
  goto :pwsh_done
)
if not exist "tools" mkdir tools
if not exist "tools\pwsh7" mkdir tools\pwsh7
echo [INFO] Downloading PowerShell 7.5.0 portable (~100MB)...
set PWSH_ZIP=!TEMP!\pwsh7_setup.zip
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'https://github.com/PowerShell/PowerShell/releases/download/v7.5.0/PowerShell-7.5.0-win-x64.zip' -OutFile '!PWSH_ZIP!' -UseBasicParsing; exit 0 } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 (
  echo [WARN] Download failed. Install PowerShell Core 7 manually: https://aka.ms/powershell
  echo        Or extract zip to tools\pwsh7\
  goto :pwsh_done
)
powershell -NoProfile -Command "Expand-Archive -Path '!PWSH_ZIP!' -DestinationPath 'tools\pwsh7' -Force"
if errorlevel 1 (
  echo [WARN] Extraction failed. Please extract PowerShell 7 to tools\pwsh7\ manually.
) else (
  del /q "!PWSH_ZIP!" 2>nul
  echo [OK] PowerShell Core 7 installed.
)
:pwsh_done

:: --- Embedded Python 3.11 ---
echo.
echo [INFO] Checking embedded Python...
if exist "tools\python\python.exe" (
  echo [OK] Embedded Python found at tools\python\
  goto :python_done
)
if not exist "tools" mkdir tools
echo [INFO] Downloading Python 3.11 embeddable (~12MB)...
set PY_ZIP=!TEMP!\python-embed.zip
powershell -NoProfile -Command "$proxy=$env:HTTPS_PROXY; $wc=New-Object Net.WebClient; if($proxy){$wc.Proxy=New-Object Net.WebProxy($proxy)}; try{$wc.DownloadFile('https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip','!PY_ZIP!');exit 0}catch{Write-Host $_.Exception.Message;exit 1}"
if errorlevel 1 (
  echo [WARN] Python download failed. /tools/python endpoint will use system python.
  goto :python_done
)
echo [INFO] Extracting Python...
powershell -NoProfile -Command "Expand-Archive -Path '!PY_ZIP!' -DestinationPath 'tools\python' -Force"
del /q "!PY_ZIP!" 2>nul
:: Enable pip (uncomment 'import site' in ._pth file)
powershell -NoProfile -Command "(Get-Content 'tools\python\python311._pth' -Raw) -replace '#import site','import site' | Set-Content 'tools\python\python311._pth'"
:: Download and run get-pip.py
echo [INFO] Installing pip...
powershell -NoProfile -Command "$proxy=$env:HTTPS_PROXY; $wc=New-Object Net.WebClient; if($proxy){$wc.Proxy=New-Object Net.WebProxy($proxy)}; $wc.DownloadFile('https://bootstrap.pypa.io/get-pip.py','tools\python\get-pip.py')"
tools\python\python.exe tools\python\get-pip.py --no-warn-script-location -q
if errorlevel 1 (
  echo [WARN] pip install failed. Python tools may not work fully.
  goto :python_done
)
:: Install requirements
if exist "tools\requirements.txt" (
  echo [INFO] Installing Python dependencies...
  tools\python\Scripts\pip.exe install -r tools\requirements.txt -q --no-warn-script-location
  if errorlevel 1 (
    echo [WARN] Some Python packages failed to install.
  ) else (
    echo [OK] Python dependencies installed.
  )
)
echo [OK] Embedded Python ready at tools\python\
:python_done

:: --- GitHub CLI ---
echo.
echo [INFO] Checking GitHub CLI (gh)...
where gh >nul 2>&1
if errorlevel 1 (
  echo [INFO] GitHub CLI not found. Trying winget...
  winget install --id GitHub.cli -e --silent >nul 2>&1
  if errorlevel 1 (
    echo [WARN] Could not install gh. Install manually: https://cli.github.com/
    goto :gh_done
  )
  echo [OK] GitHub CLI installed.
  set "PATH=!PATH!;!LOCALAPPDATA!\Microsoft\WinGet\Packages\GitHub.cli_Microsoft.Winget.Source_8wekyb3d8bbwe\tools"
) else (
  for /f "tokens=*" %%v in ('gh --version 2^>nul') do (
    echo [OK] %%v
    goto :gh_check_ext
  )
)

:gh_check_ext
where gh >nul 2>&1
if errorlevel 1 goto :gh_done

:: --- Copilot extension ---
echo [INFO] Checking Copilot extension...
gh extension list 2>nul | findstr /i "copilot" >nul 2>&1
if errorlevel 1 (
  gh extension install github/gh-copilot 2>nul
  if errorlevel 1 (
    echo [WARN] Copilot install failed. Run: gh auth login then gh extension install github/gh-copilot
  ) else (
    echo [OK] Copilot extension installed.
  )
) else (
  echo [OK] Copilot extension present.
)

:: --- GitHub auth ---
gh auth status >nul 2>&1
if errorlevel 1 (
  echo [INFO] GitHub auth needed. Running: gh auth login
  gh auth login
) else (
  echo [OK] GitHub authenticated.
)
:gh_done

echo.
if not exist ".env" (
  echo [INFO] Optional: create .env for COS/API keys at !CD!\.env
)

echo.
echo ============================================
echo   Setup complete!  Starting Alice...
echo   URL: http://localhost:7439
echo ============================================
echo.
node server.js
pause
