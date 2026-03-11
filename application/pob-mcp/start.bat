@echo off
cd /d G:\GameExPro3\Alith\application\pob-mcp
echo Starting PoB Analysis HTTP Server on port 7892...
echo Endpoints: /builds /summary /skills /items /tree /stats /analyze
E:\python\python.exe pob_http_server.py 7892
pause
