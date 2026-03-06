@echo off
cd /d %~dp0

:: ── 终止旧的 node 进程（占用 7439）──────────────────────────
echo 正在检查端口 7439...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":7439 "') do (
  echo   终止旧 node 进程 PID=%%a...
  taskkill /PID %%a /F >nul 2>&1
)

:: ── 终止旧的 frpc 进程 ───────────────────────────────────────
echo 正在重启 frpc...
taskkill /IM frpc.exe /F >nul 2>&1
for /f "tokens=1" %%a in ('wmic process where "CommandLine like '%%run_frp.bat%%'" get ProcessId 2^>nul ^| findstr /r "[0-9][0-9]*"') do (
  taskkill /PID %%a /F >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: ── 启动 frpc（最小化后台窗口）──────────────────────────────
start "frp" /min cmd /c "E:\AIWorkFlow\run_frp.bat"
echo   frpc 已启动。

:: ── 设置代理环境变量 ─────────────────────────────────────────
set CLASH_PROXY=http://127.0.0.1:7890

:: ── 启动 DocSpace 服务 ───────────────────────────────────────
echo.
echo 正在启动 DocSpace (port 7439)...
echo 访问地址: http://localhost:7439
echo 按 Ctrl+C 停止服务
echo.
node server.js
echo.
echo 服务已退出（退出码: %ERRORLEVEL%）
pause
