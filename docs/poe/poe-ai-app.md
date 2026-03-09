# POE AI 画面分析器

**应用地址**: http://localhost:7439/agent/poe-ai/  
**后端 API**: http://localhost:7788  
**状态**: ✅ 已部署运行

## 功能
- 10fps 实时画面捕获 (mss)
- OpenCV 自动检测 HP/法力百分比
- 药水槽状态检测（5个）
- moondream 视觉 AI 每5秒自动分析游戏画面
- deepseek 文字 AI 提供战术建议（备用）
- SSE 实时推送状态到前端
- 「立即分析」按钮触发即时 AI 分析
- 「校准检测」按钮验证 HP/MP 检测区域

## 文件路径
- 前端: G:\GameExPro3\Alith\application\poe-ai\index.html
- 后端: G:\GameExPro3\Alith\application\poe-ai\poe_ai_server.py
- 日志: G:\GameExPro3\Alith\runtime\poe_ai_server.log
- PID: G:\GameExPro3\Alith\runtime\poe_ai_pid.txt

## 启动后端
```powershell
# 通过 Alith service shell:
 = Start-Process -FilePath "E:\python\python.exe" `
  -ArgumentList "G:\GameExPro3\Alith\application\poe-ai\poe_ai_server.py" `
  -PassThru -NoNewWindow `
  -RedirectStandardOutput "G:\GameExPro3\Alith\runtime\poe_ai_server.log" `
  -RedirectStandardError "G:\GameExPro3\Alith\runtime\poe_ai_server_err.log"
```

## 已安装模型
- moondream:latest (~1.8GB) — 视觉分析
- deepseek-31-7b:latest (3.1GB) — 文字建议

## POE1 UI 检测区域 (5120x1440)
- HP 球: 左下角 (约 6% 宽, 89.5% 高)
- 法力球: 右下角 (约 94.2% 宽, 89.5% 高)
- 药水槽: 底部 12%-30% 位置