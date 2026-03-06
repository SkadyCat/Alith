@echo off
chcp 65001 >nul
cd /d %~dp0

echo ===================================
echo   Alice Update Script
echo ===================================
echo.

:: 检查 git 是否可用
where git >nul 2>&1
if errorlevel 1 (
  echo [ERROR] git 未找到，请先安装 Git 并添加到 PATH。
  goto :end
)

echo [1/3] 从 GitHub 拉取最新代码（冲突时以 master 为准）...
git fetch origin
if errorlevel 1 (
  echo [ERROR] git fetch 失败，请检查网络或 Git 配置。
  goto :end
)

:: 以 origin/master 为准，强制覆盖本地（包括冲突文件）
git reset --hard origin/master
if errorlevel 1 (
  echo [ERROR] git reset 失败。
  goto :end
)
echo [OK] 代码已更新到最新 master 版本。
echo.

echo [2/3] 检查依赖变更...
npm install --prefer-offline
if errorlevel 1 (
  echo [WARN] npm install 失败，依赖可能未更新，但不影响运行。
) else (
  echo [OK] 依赖检查完成。
)
echo.

echo [3/3] 更新完成！
echo.
echo ===================================
echo   请重启 Alice 服务以应用更新
echo   运行 rundoc.bat 重启
echo ===================================

:end
echo.
pause
