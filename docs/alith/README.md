# Alith — 爱丽丝代码结构分析

> 本文档由爱丽丝自动生成，描述 `docs-service` 系统（爱丽丝）的完整代码结构与架构关系。

## 项目概述

爱丽丝是一个基于 Node.js + Express 的文档服务系统，运行在 `E:\docs-service`，端口 `7439`。

核心能力：

| 能力 | 说明 |
|------|------|
| 📄 文档管理 | Markdown 文档的增删改查（CRUD），左编辑右预览 |
| 🤖 Agent 驱动 | 集成 @github/copilot CLI，以 autopilot 模式自主执行任务 |
| 🔍 全文搜索 | 支持 fuzzy / words / exact / regex 四种搜索模式 |
| 🐍 工具执行 | 安全地执行 Python 代码片段与 PowerShell 命令 |
| 🌐 对外接口 | `/open` 系列 REST API，供外部系统/Agent 集成调用 |

---

## 代码结构

```
docs-service/                       ← 项目根目录
├── server.js                       # 主入口：Express 初始化 + 文档 CRUD API
├── package.json                    # 依赖声明（express, marked, highlight.js, chokidar）
├── rundoc.bat                      # Windows 快速启动脚本
├── create-alith.js                 # 生成本分析文档的脚本
│
├── routes/                         # 路由层（模块化挂载）
│   ├── agent.js                    # /agent  — CopilotCli Agent 控制
│   ├── external.js                 # /open   — 对外开放接口
│   └── tools.js                    # /tools  — Python & Shell 执行工具
│
├── public/                         # 前端静态资源
│   ├── index.html                  # 单页应用 HTML
│   ├── app.js                      # 前端逻辑（编辑器、文件树、SSE 消费）
│   └── style.css                   # 界面样式
│
├── tools/                          # 后端执行沙箱
│   ├── python_runner.py            # Python 代码执行器（JSON 输出）
│   ├── shell_runner.ps1            # PowerShell 命令执行器（JSON 输出）
│   └── requirements.txt           # Python 依赖
│
├── docs/                           # 文档存储根目录（.md 文件）
│   ├── history/                    # Agent 会话历史文档
│   ├── alith/                      # 本分析文档（当前目录）
│   └── ...                         # 用户文档
│
├── data/                           # 持久化数据
│   └── agent-history.md            # Agent 任务历史追加日志
│
└── application/                    # 应用扩展目录
    └── alith/                      # 本应用（代码分析文档）
```

---

## 模块说明

### server.js — 主入口

- 初始化 Express 应用，监听端口 `7439`
- 挂载三大路由模块：`/open`、`/agent`、`/tools`
- 提供文档 CRUD REST API：

| 接口 | 说明 |
|------|------|
| `GET  /api/tree` | 获取文档目录树 |
| `GET  /api/file?path=` | 读取文件内容（返回 md + html）|
| `POST /api/file` | 保存文件内容 |
| `POST /api/create` | 新建文件 |
| `POST /api/mkdir` | 新建目录 |
| `DELETE /api/file` | 删除文件 |
| `POST /api/render` | 渲染 Markdown 为 HTML |

---

### routes/agent.js — Agent 控制

基于 `@github/copilot` CLI 的 autopilot 模式，通过 SSE 实时输出执行结果。

关键特性：
- **SSE 流式输出**：`GET /agent/stream` 提供实时事件流
- **三层上下文注入**：systemDoc（世界观）、historyDoc（历史会话）、最近3条任务历史
- **ANSI 清理**：正则过滤所有终端控制序列，确保输出纯净
- **心跳机制**：每 3 秒广播 heartbeat 事件，含 elapsed/pid
- **自动保存**：任务结束后可自动保存输出为 .md 文档
- **持久化历史**：每次任务追加写入 `data/agent-history.md`
- **GitHub 认证**：支持 `POST /agent/auth` 触发 Device Flow 认证，自动安装 CLI

支持模型：

| 模型 ID | 名称 | 最大 Token |
|---------|------|-----------|
| (默认) | 默认模型 | 64K |
| gpt-4.1 | GPT-4.1 | 1,047,576 |
| claude-sonnet-4.6 | Claude Sonnet 4.6 | 200K |
| claude-opus-4.6 | Claude Opus 4.6 | 200K |
| claude-haiku-4.5 | Claude Haiku 4.5 | 200K |
| gemini-3-pro-preview | Gemini 3 Pro | 1,000,000 |

---

### routes/external.js — 对外接口

| 接口 | 说明 |
|------|------|
| `POST /open/submit` | 提交/覆盖文档（支持 overwrite 参数）|
| `POST /open/search` | 全文搜索（fuzzy/words/exact/regex 模式）|
| `GET  /open/study` | 返回《如何使用文档》原文 |

搜索特性：
- **四种匹配模式**：fuzzy（子序列）/ words（全词）/ exact（精确）/ regex（正则）
- **字段控制**：可指定搜索 title / content / both
- **相关度排序**：标题命中权重 10 分，内容按词频累加
- **摘要提取**：返回含上下文的摘要片段（最多 3 条）

---

### routes/tools.js — 执行工具

| 接口 | 说明 |
|------|------|
| `POST /tools/python` | 执行 Python 代码片段（通过 python_runner.py）|
| `POST /tools/shell` | 执行 PowerShell 命令（通过 shell_runner.ps1）|

- 超时控制：默认 30s，最长 120s
- 结果统一为 JSON：`{ success, stdout, stderr, exitCode }`

---

## 数据流

```
用户/Agent
    │
    ├─ POST /open/submit  ──────────────► docs/*.md
    │
    ├─ POST /agent/start
    │       │ 注入 systemDoc + historyDoc + 历史上下文
    │       ▼
    │   Copilot CLI (--autopilot --yolo)
    │       │ stdout/stderr 流式
    │       ▼
    │   SSE broadcast ──────────────────► 前端 UI
    │       │ close
    │       ├─► data/agent-history.md    (追加)
    │       ├─► docs/{saveAs}.md         (可选)
    │       └─► docs/history/{doc}.md    (可选)
    │
    └─ POST /tools/python|shell ────────► 执行结果 JSON
```

---

## 依赖清单

| 包名 | 版本 | 用途 |
|------|------|------|
| express | ^5.2.1 | Web 框架 |
| marked | ^17.0.3 | Markdown → HTML 渲染 |
| highlight.js | ^11.11.1 | 代码语法高亮 |
| chokidar | ^5.0.0 | 文件监听（备用）|

---

*详细架构图见 [architecture.md](./architecture.md)*
