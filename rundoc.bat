@echo off
cd /d %~dp0

:: ── 关闭旧的 frpc.exe 和 run_frp.bat 相关进程 ─────────────
echo 正在重启 frp...

:: 1. 直接按名称 kill frpc.exe（最可靠）
taskkill /IM frpc.exe /F >nul 2>&1

:: 2. kill 残留的 cmd 进程（run_frp.bat 外壳）
for /f "tokens=1" %%a in ('wmic process where "CommandLine like '%%run_frp.bat%%'" get ProcessId 2^>nul ^| findstr /r "[0-9][0-9]*"') do (
  echo   终止旧 frp 进程 PID=%%a
  taskkill /PID %%a /F >nul 2>&1
)

:: 稍等进程完全退出
timeout /t 2 /nobreak >nul

:: ── 重新启动 run_frp.bat（最小化新窗口，后台运行）─────────
start "frp" /min cmd /c "E:\AIWorkFlow\run_frp.bat"
echo   frp 已重新启动。

:: ── 检查 7439 端口占用 ──────────────────────────────────────
echo 正在检查端口占用...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":7439 "') do (
  echo 发现占用进程 PID=%%a，正在终止...
  taskkill /PID %%a /F >nul 2>&1
)

echo 正在启动 DocSpace...
echo 访问地址: http://localhost:7439
echo 按 Ctrl+C 停止服务
echo.
node server.js
echo.
echo 服务已退出（退出码: %ERRORLEVEL%）
pause

:: ── 检查 7439 端口占用 ──────────────────────────────────────
echo 正在检查端口占用...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":7439 "') do (
  echo 发现占用进程 PID=%%a，正在终止...
  taskkill /PID %%a /F >nul 2>&1
)

echo 正在启动 DocSpace...
echo 访问地址: http://localhost:7439
echo 按 Ctrl+C 停止服务
echo.
node server.js
echo.
echo 服务已退出（退出码: %ERRORLEVEL%）
pause
