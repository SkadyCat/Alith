@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ╔══════════════════════════════════════════╗
echo ║       爱丽丝 (AliceDoc) 一键部署         ║
echo ║   来自 github.com/SkadyCat/Alith         ║
echo ╚══════════════════════════════════════════╝
echo.

:: ── 检查 Node.js ────────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node.js (https://nodejs.org)
  pause & exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo [OK] Node.js %NODE_VER%

:: ── 检查 Git ──────────────────────────────────────────────────
where git >nul 2>&1
if errorlevel 1 (
  echo [错误] 未检测到 Git，请先安装 Git (https://git-scm.com)
  pause & exit /b 1
)
for /f "tokens=*" %%v in ('git --version') do set GIT_VER=%%v
echo [OK] %GIT_VER%
echo.

:: ── 部署目录（默认当前目录下的 Alith 文件夹）────────────────────
set DEPLOY_DIR=%~dp0
:: 如果本脚本已在 docs-service 目录，则直接使用
if exist "%DEPLOY_DIR%server.js" (
  echo [INFO] 检测到已在爱丽丝目录，跳过克隆。
  cd /d "%DEPLOY_DIR%"
  goto :deps
)

:: 否则克隆仓库
set TARGET_DIR=%~dp0Alith
echo [INFO] 目标目录: %TARGET_DIR%
if exist "%TARGET_DIR%\.git" (
  echo [INFO] 仓库已存在，执行 git pull...
  cd /d "%TARGET_DIR%"
  git pull origin master
) else (
  echo [INFO] 正在从 GitHub 克隆仓库...
  git clone https://github.com/SkadyCat/Alith.git "%TARGET_DIR%"
  if errorlevel 1 (
    echo [错误] 克隆失败，请检查网络或 GitHub 访问
    pause & exit /b 1
  )
  cd /d "%TARGET_DIR%"
)

:deps
echo.
echo [INFO] 正在安装 npm 依赖...
npm install
if errorlevel 1 (
  echo [错误] npm install 失败
  pause & exit /b 1
)
echo [OK] 依赖安装完成

:: ── 创建必要目录 ─────────────────────────────────────────────────
echo.
echo [INFO] 初始化目录结构...
if not exist "docs"    mkdir docs
if not exist "docs\history"    mkdir docs\history
if not exist "docs\agent"      mkdir docs\agent
if not exist "docs\application_doc\magicworld" mkdir docs\application_doc\magicworld
if not exist "data"    mkdir data
if not exist "logs"    mkdir logs
if not exist "outputs" mkdir outputs
if not exist "runtime" mkdir runtime
echo [OK] 目录初始化完成

:: ── 创建 MagicWorld 配置文件（若不存在）─────────────────────────
if not exist "docs\application_doc\magicworld\config.json" (
  echo {"publicIp":""} > docs\application_doc\magicworld\config.json
  echo [OK] 已创建 MagicWorld 配置文件
)

:: ── 提示配置 .env ──────────────────────────────────────────────
echo.
if not exist ".env" (
  echo [提示] 若需 COS 图片上传或其他密钥，请在以下位置创建 .env 文件：
  echo        %CD%\.env
  echo        内容示例：SECRET_ID=xxx  SECRET_KEY=yyy  PUBLIC_URL=http://你的公网IP:7439
)

echo.
echo ╔══════════════════════════════════════════╗
echo ║   部署完成！正在启动爱丽丝...            ║
echo ║   访问地址: http://localhost:7439        ║
echo ╚══════════════════════════════════════════╝
echo.
node server.js
pause
