# CopilotCli Web Chat -- 搭建与使用完整指南

> 本文记录从零搭建「GitHub Copilot CLI 网页聊天工具」的全过程，涵盖环境配置、功能实现、常见问题及核心要点。

---

## 一、项目概述

**CopilotCli Web Chat** 是一个基于 Node.js / Express 的网页界面，将 GitHub Copilot CLI 包装为可在浏览器中使用的聊天与 Agent 自动化平台。

### 核心功能

| 功能 | 说明 |
|---|---|
| 对话模式 | 多轮对话，支持 17 种 AI 模型切换 |
| Agent 模式 | 自主多步任务（autopilot），SSE 实时流式输出 |
| 工具面板 | 内置 PowerShell + Python 执行器，实时流输出 |
| 长期记忆 | 保存/加载对话记忆，注入上下文 |
| Token 统计 | 实时显示已用/剩余 Token |
| 对话导出 | 一键导出 Markdown 文件 |
| 认证管理 | PAT Token / GitHub 设备码登录双路径 |

---

## 二、技术栈

| 层次 | 技术 |
|---|---|
| 运行时 | Node.js v22.13.1 |
| Web 框架 | Express.js ^5.2.1 + express-session |
| CLI 核心 | @github/copilot npm 包 v0.0.420+ |
| 前端 | 原生 HTML + CSS + JavaScript（无框架） |
| 实时通信 | SSE（Server-Sent Events） |
| 代理 | Clash / 系统代理（127.0.0.1:7890） |

---

## 三、目录结构

```
copilot-web-chat/
├── server.js           # 主服务（约 960 行）
├── routes/
│   └── tools.js        # Shell + Python 工具路由
├── public/
│   ├── index.html      # 页面结构
│   ├── app.js          # 前端逻辑（约 950 行）
│   └── styles.css      # 样式
├── data/
│   └── memories/       # 长期记忆 .md 文件存储
├── .env                # 环境变量
└── runcopilot.bat      # 一键启动脚本
```

---

## 四、环境配置

### 4.1 安装依赖

```bash
npm install express express-session dotenv
```

### 4.2 .env 配置

```env
HTTPS_PROXY=http://127.0.0.1:7890   # 代理（必须）
HTTP_PROXY=http://127.0.0.1:7890
COPILOT_MODEL=                       # 留空=使用默认模型
PORT=3000
APP_USERNAME=admin
APP_PASSWORD=admin123
SESSION_SECRET=your-secret
```

注意：代理配置是关键。Copilot CLI 需要访问 GitHub API，在国内必须配置代理。

### 4.3 dotenv 加载方式（重要）

```javascript
// 必须使用绝对路径，避免 CWD 不同导致 .env 读取失败
require("dotenv").config({ path: require("path").join(__dirname, ".env") });
```

### 4.4 启动服务

```bash
node server.js
# 或双击 runcopilot.bat（自动打开浏览器）
```

---

## 五、Copilot CLI 调用方式

### 5.1 命令检测链

Windows 下 `copilot` 命令可能不在 PATH 中，服务器会按以下顺序检测：

1. 环境变量 `COPILOT_CMD`（用户自定义）
2. `copilot.cmd`（npm 全局安装的 wrapper）
3. node-script 模式（直接 `node npm-loader.js`，最稳定）

```javascript
// node-script 模式示例
const runCmd = process.execPath;  // node.exe
const base   = ["C:\Users\xxx\AppData\Roaming\npm\node_modules\@github\copilot\npm-loader.js"];
```

### 5.2 对话模式调用

```javascript
// 关键参数：-s（--silent，仅输出回复），-p（prompt），--model
const args = ["-s", "-p", promptText, "--model", modelName];
const child = spawn(runCmd, [...base, ...args], { env, timeout: 180000 });
```

注意：`--silent` 长参数在部分版本不识别，必须用 `-s` 短参数。

### 5.3 Agent（Autopilot）模式调用

```javascript
const args = [
  "--no-alt-screen",      // 核心！禁用终端交替屏幕，否则管道无输出
  "--no-color",           // 去掉 ANSI 颜色码
  "--autopilot",          // 自主 Agent 模式
  "--yolo",               // 等同 --allow-all（允许所有工具/路径/URL）
  "--max-autopilot-continues", String(maxCont),
  "--no-ask-user",        // 非交互，Agent 自主决策
  "-p", promptText,
];
```

最关键的修复：必须加 `--no-alt-screen`，否则 CLI 使用终端交替屏幕缓冲区，在 pipe 模式下输出完全不流进 stdout，导致网页界面卡死无响应。

### 5.4 代理传递给子进程

```javascript
const env = { ...process.env };
// 显式复制代理变量，子进程不会自动继承
for (const k of ["HTTP_PROXY","HTTPS_PROXY","http_proxy","https_proxy"]) {
  if (process.env[k]) env[k] = process.env[k];
}
// 兜底：如果没有代理配置，使用默认地址
if (!env.HTTPS_PROXY && !env.HTTP_PROXY) {
  env.HTTPS_PROXY = "http://127.0.0.1:7890";
  env.HTTP_PROXY  = "http://127.0.0.1:7890";
}
```

---

## 六、SSE 实时流架构

Agent 模式和工具执行均使用 SSE（Server-Sent Events）实现实时输出。

### 6.1 服务端广播

```javascript
// 广播给所有订阅客户端，同时缓存历史（供新连接 replay）
function broadcastAgent(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  agentClients.forEach((res) => { if (!res.writableEnded) res.write(payload); });
}
```

### 6.2 前端连接

```javascript
const es = new EventSource("/api/agent/stream");
es.addEventListener("output", (e) => {
  const { text, stream } = JSON.parse(e.data);
  appendLine(text, stream === "stderr" ? "stderr" : "");
});
es.addEventListener("done", (e) => { /* 任务完成 */ });
es.addEventListener("heartbeat", (e) => { /* 进程心跳 */ });
```

### 6.3 心跳机制

```javascript
// 每 3 秒推送进程存活状态 + 已用时间
const heartbeatTimer = setInterval(() => {
  broadcastAgent("heartbeat", {
    elapsedSec: Math.floor((Date.now() - startTime) / 1000),
    alive: agentProcess.exitCode === null,
    pid: agentProcess.pid,
  });
}, 3000);
```

---

## 七、工具接口（routes/tools.js）

挂载在 `/api/tools`，提供 Shell 和 Python 执行能力。

### 7.1 接口列表

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/tools/info | 返回 Shell 类型、Python 版本 |
| POST | /api/tools/shell | 阻塞执行 PowerShell 命令 |
| POST | /api/tools/shell/start | 启动流式 Shell 任务，返回 taskId |
| POST | /api/tools/python | 阻塞执行 Python 代码 |
| POST | /api/tools/python/start | 启动流式 Python 任务，返回 taskId |
| GET | /api/tools/stream/:taskId | SSE 实时流（含历史 replay） |
| DELETE | /api/tools/stream/:taskId | 强制终止任务 |
| GET | /api/tools/tasks | 列出活跃任务 |

### 7.2 Shell 执行示例

```bash
# 阻塞模式
curl -X POST http://localhost:3000/api/tools/shell \
  -H "Content-Type: application/json" \
  -d '{"command":"Get-ChildItem","cwd":"C:\\","timeout":30000}'

# 流式模式：先获取 taskId，再连接 SSE
curl -X POST http://localhost:3000/api/tools/shell/start \
  -d '{"command":"python train.py"}'
# 返回 {"taskId":"abc-123"}
curl http://localhost:3000/api/tools/stream/abc-123
```

### 7.3 Python 执行示例

```bash
# 直接提交代码字符串
curl -X POST http://localhost:3000/api/tools/python \
  -H "Content-Type: application/json" \
  -d '{"code":"import sys\nprint(sys.version)","timeout":10000}'

# 执行已有脚本文件
curl -X POST http://localhost:3000/api/tools/python \
  -d '{"file":"G:\\project\\main.py","cwd":"G:\\project"}'
```

### 7.4 Python 检测顺序

Windows 下依次尝试：python -> python3 -> py

---

## 八、Agent 记忆机制

### 8.1 历史记录注入

每次启动新 Agent 任务时，会自动将最近 N 次（默认 3 次）的任务历史拼接到 prompt 前缀：

```javascript
const AGENT_CONTEXT_TURNS = 3;   // 注入最近 3 次
const AGENT_OUTPUT_TRIM = 3000;  // 每次历史截取前 3000 字符

// 构建 prompt
const contextLines = ["[历史任务上下文]"];
recentHistory.forEach((h) => {
  contextLines.push("任务：" + h.task);
  contextLines.push("输出：" + h.output.slice(0, AGENT_OUTPUT_TRIM));
});
const fullPrompt = contextLines.join("\n") + "\n[当前任务]\n" + task;
```

### 8.2 持久化

任务完成后自动追加到 `data/memories/agent-history.md`：

```javascript
fs.appendFileSync(histFile, "## 任务 #" + n + " - " + timestamp + "\n" + summary, "utf8");
```

### 8.3 长期记忆（对话模式）

```
POST   /api/memory/save    保存当前对话为 .md 文件
GET    /api/memory/list    列出所有记忆
POST   /api/memory/load    加载记忆（注入到下次对话）
POST   /api/memory/unload  卸载记忆
DELETE /api/memory/:name   删除记忆文件
```

---

## 九、已解决的关键问题

| 问题 | 根本原因 | 解决方案 |
|---|---|---|
| --silent 导致进程卡死 | 部分 CLI 版本不识别长参数 | 改用 -s 短参数 |
| 60 秒超时 | 重型模型响应慢 | 调整为 180 秒 |
| .env 读取失败 | CWD 不是项目目录 | path.join(__dirname, ".env") 绝对路径 |
| 代理未传递给子进程 | 子进程不继承父进程环境变量 | 显式复制代理环境变量 + 兜底 7890 |
| Agent 卡死无输出 | CLI 默认使用终端交替屏幕缓冲区，pipe 模式下不输出 | 加 --no-alt-screen 标志 |
| Agent 无历史连续性 | 每次新进程没有上下文 | 构建历史摘要注入 prompt 前缀 |

---

## 十、支持的 AI 模型（共 17 个）

| 厂商 | 模型 | Context 长度 |
|---|---|---|
| OpenAI | gpt-4.1 | 1,047,576 |
| OpenAI | gpt-5.1 / gpt-5.1-codex / gpt-5.2 / gpt-5.3-codex 等 | 200,000 |
| Anthropic | claude-sonnet-4.6 / claude-opus-4.6 / claude-haiku-4.5 等 | 200,000 |
| Google | gemini-3-pro-preview | 1,000,000 |

---

## 十一、API 完整列表

```
# 认证
POST   /api/login
POST   /api/logout
GET    /api/me

# Copilot 状态
GET    /api/copilot/status
GET    /api/copilot/auth-status
GET    /api/copilot/self-check
GET    /api/copilot/models

# 设备登录
POST   /api/copilot/device-login/start
GET    /api/copilot/device-login/status

# 对话
POST   /api/chat
GET    /api/chat/tokens?model=xxx
GET    /api/chat/export

# 记忆
POST   /api/memory/save
GET    /api/memory/list
POST   /api/memory/load
POST   /api/memory/unload
DELETE /api/memory/:name

# Agent
POST   /api/agent/start
POST   /api/agent/stop
GET    /api/agent/stream         (SSE)
GET    /api/agent/status
GET    /api/agent/history
DELETE /api/agent/history

# 工具
GET    /api/tools/info
POST   /api/tools/shell
POST   /api/tools/shell/start
POST   /api/tools/python
POST   /api/tools/python/start
GET    /api/tools/stream/:taskId (SSE)
DELETE /api/tools/stream/:taskId
GET    /api/tools/tasks
```

---

## 十二、快速上手

```bash
# 1. 进入项目目录
cd G:\GameExPro3\CopilotCli\copilot-web-chat

# 2. 安装依赖（首次）
npm install

# 3. 配置代理（.env 文件）
# HTTPS_PROXY=http://127.0.0.1:7890

# 4. 启动服务
node server.js

# 5. 打开浏览器访问 http://localhost:3000
# 默认账号：admin / admin123

# 6. 使用 Agent 模式
# 切换到「Agent」Tab -> 输入任务描述 -> 点击启动 Agent
# 底层命令：--no-alt-screen --autopilot --yolo --no-ask-user
```

---

*文档生成时间：2026-03-01*
