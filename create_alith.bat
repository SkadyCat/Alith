@echo off
cd /d E:\docs-service\application
mkdir alith
cd alith
(
echo # Alith — 爱丽丝代码结构分析
echo.
echo ^> 本文档由爱丽丝自动生成，描述 `docs-service` 系统（爱丽丝）的完整代码结构与架构关系。
echo.
echo ## 项目概述
echo.
echo 爱丽丝是一个基于 Node.js + Express 的文档服务系统，运行在 `E:\docs-service`，端口 `7439`。
echo 核心能力：
echo - 📄 Markdown 文档管理（CRUD）
echo - 🤖 CopilotCli Agent 自主执行任务
echo - 🔍 全文搜索
echo - 🐍 Python / PowerShell 工具执行
echo.
echo ## 代码结构
echo.
echo ```
echo docs-service/
echo ├── server.js          # 主入口：Express 应用初始化、文档 CRUD API
echo ├── package.json       # 依赖声明（express, marked, highlight.js）
echo ├── rundoc.bat         # Windows 快速启动脚本
echo ├── routes/
echo │   ├── agent.js       # /agent  — CopilotCli Agent 控制路由
echo │   ├── external.js    # /open   — 对外开放接口（提交/搜索/学习）
echo │   └── tools.js       # /tools  — Python 和 Shell 执行工具
echo ├── public/
echo │   ├── index.html     # 前端单页应用
echo │   ├── app.js         # 前端逻辑（编辑器、文件树、SSE）
echo │   └── style.css      # UI 样式
echo ├── tools/
echo │   ├── python_runner.py   # Python 代码沙箱执行器
echo │   └── shell_runner.ps1   # PowerShell 命令执行器
echo ├── docs/              # 文档存储目录（.md 文件）
echo │   └── history/       # Agent 会话历史文档
echo ├── data/              # 持久化数据（agent-history.md）
echo └── application/       # 应用扩展目录（本目录）
echo     └── alith/         # 爱丽丝代码结构分析
echo ```
echo.
echo ## Mermaid 架构图
echo.
echo 详见 [architecture.md](./architecture.md)
) > README.md
echo Created README.md
pause
