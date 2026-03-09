@echo off
chcp 65001 > nul
setlocal

set "SCRIPT_DIR=%~dp0"
set "ALITH_DIR=%SCRIPT_DIR%..\..\"
set "PYTHON=%ALITH_DIR%tools\python\python.exe"
set "AGENT_SCRIPT=%SCRIPT_DIR%py_agent.py"

echo.
echo ================================================
echo   PyAgent - Python Singleton Socket Server
echo   Port: 7441  /  Alith: http://127.0.0.1:7439
echo ================================================
echo.

:: 检查 Python 是否存在
if not exist "%PYTHON%" (
    echo [错误] 找不到内置 Python: %PYTHON%
    echo 请确保 tools\python\python.exe 存在
    pause
    exit /b 1
)

:: 检查端口是否已占用（说明 PyAgent 已在运行）
netstat -ano | findstr "127.0.0.1:7441" | findstr "LISTENING" > nul 2>&1
if %errorlevel% == 0 (
    echo [警告] PyAgent 已在运行（端口 7441 已被占用）
    echo 如需重启，请先关闭已有进程。
    pause
    exit /b 0
)

echo [启动] 正在启动 PyAgent...
"%PYTHON%" "%AGENT_SCRIPT%"

echo.
echo [PyAgent 已退出]
pause
