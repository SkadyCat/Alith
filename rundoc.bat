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

:: ── 启动 Flux 后端（端口 8331）──────────────────────────────
echo 正在检查 Flux 后端 (8331)...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8331 "') do (
  echo   Flux 后端已在运行 PID=%%a，跳过启动。
  goto skip_flux
)
echo   正在启动 Flux 后端...
start "Flux-Backend" /min cmd /c "E:\AIGC\Flux\backend\venv\Scripts\python.exe E:\AIGC\Flux\backend\main.py"
:skip_flux

:: ── 启动 ComfyUI Service（端口 8188）────────────────────────
echo 正在检查 ComfyUI Service (8188)...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8188 "') do (
  echo   ComfyUI Service 已在运行 PID=%%a，跳过启动。
  goto skip_comfyui
)
echo   正在启动 ComfyUI Service...
start "ComfyUI-Service" /min cmd /c "E:\AIGC\Flux\backend\venv\Scripts\python.exe E:\docs-service\application\comfyui-service\main.py"
:skip_comfyui

:: ── 启动 SDXL Service（端口 8189，CivitAI 模型）────────────────
echo 正在检查 SDXL Service (8189)...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8189 "') do (
  echo   SDXL Service 已在运行 PID=%%a，跳过启动。
  goto skip_sdxl
)
echo   正在启动 SDXL Service...
start "SDXL-Service" /min cmd /c "E:\AIGC\Flux\backend\venv\Scripts\python.exe E:\docs-service\application\sdxl-service\main.py"
:skip_sdxl

:: ── 本机 Clash 代理（其他设备无需此变量）────────────────────
set CLASH_PROXY=http://127.0.0.1:7890

echo 正在启动 DocSpace...
echo 访问地址: http://localhost:7439
echo 按 Ctrl+C 停止服务
echo.
node server.js
echo.
echo 服务已退出（退出码: %ERRORLEVEL%）
pause
