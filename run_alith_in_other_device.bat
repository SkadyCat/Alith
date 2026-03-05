@echo off
cd /d %~dp0

echo ===== 启动 爱丽丝 (其他设备模式，无需 frpc) =====

:: ── 检查 7439 端口占用 ──────────────────────────────────────
echo 正在检查端口占用 (7439)...
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

:: ── 启动 SDXL Service（端口 8189）───────────────────────────
echo 正在检查 SDXL Service (8189)...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":8189 "') do (
  echo   SDXL Service 已在运行 PID=%%a，跳过启动。
  goto skip_sdxl
)
echo   正在启动 SDXL Service...
start "SDXL-Service" /min cmd /c "E:\AIGC\Flux\backend\venv\Scripts\python.exe E:\docs-service\application\sdxl-service\main.py"
:skip_sdxl

echo.
echo 正在启动 爱丽丝...
echo 访问地址: http://localhost:7439
echo 按 Ctrl+C 停止服务
echo.
node server.js
echo.
echo 服务已退出（退出码: %ERRORLEVEL%）
pause
