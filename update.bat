@echo off
chcp 65001 >nul
cd /d %~dp0

echo ===== 爱丽丝 更新脚本 =====
echo 正在从 GitHub 拉取最新代码...
echo.

git pull origin master
if errorlevel 1 (
  echo [错误] git pull 失败，请检查网络连接或 Git 配置
  exit /b 1
)
echo [OK] 代码已更新

echo 正在检查依赖变更...
npm install --prefer-offline
if errorlevel 1 (
  echo [警告] npm install 失败，依赖可能未更新
)
echo [OK] 依赖检查完成

echo.
echo ===== 更新完成，请重启爱丽丝服务 =====
