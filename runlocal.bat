@echo off
chcp 65001 >nul
cd /d %~dp0

echo ===== 爱丽丝 本地模式启动 =====

:: ── 关闭已占用 7439 端口的进程 ─────────────────────────────────
echo 正在检查端口占用 (7439)...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":7439 "') do (
  echo   终止占用进程 PID=%%a
  taskkill /PID %%a /F >nul 2>&1
)

:: ── 关闭已有的 node server.js 进程（同目录）────────────────────
for /f "tokens=1" %%a in ('wmic process where "CommandLine like '%%docs-service%%server.js%%'" get ProcessId 2^>nul ^| findstr /r "[0-9][0-9]*"') do (
  echo   终止已有 node 进程 PID=%%a
  taskkill /PID %%a /F >nul 2>&1
)

timeout /t 1 /nobreak >nul

echo.
echo 正在启动爱丽丝（本地模式）...
echo 访问地址: http://localhost:7439
echo 按 Ctrl+C 停止服务
echo.
node server.js
echo.
echo 服务已退出（退出码: %ERRORLEVEL%）
pause
