@echo off
cd /d %~dp0
echo 正在启动重启服务 (端口 8033)...
start "restart-server" /min "C:\Program Files\nodejs\node.exe" restart-server.js
echo 重启服务已启动: http://localhost:8033
echo   POST /restart — 重启爱丽丝
echo   GET  /status  — 状态检查
