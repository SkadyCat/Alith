# CopilotCli Agent 功能说明

DocSpace 集成了 CopilotCli 的 Agent（Autopilot）模式，可以让 AI 自主完成多步任务，并将结果实时流式输出到网页。

---

## 一、如何使用 Agent 面板

1. 点击右上角 **Agent** 按钮，打开 Agent 侧面板
2. 在文本框中输入任务描述（自然语言）
3. 可选：在"保存为文档"输入框填写路径，任务完成后自动保存结果
4. 点击 **启动 Agent**，实时查看输出
5. 随时点击 **停止** 终止任务

---

## 二、底层技术

### 关键 CLI 参数

| 参数 | 作用 |
|---|---|
| `--no-alt-screen` | **必须**，禁用终端交替屏幕缓冲区，pipe 模式才能正常输出 |
| `--autopilot` | 启用 Agent 自主模式 |
| `--yolo` | 允许 Agent 自主执行所有操作（等同 --allow-all） |
| `--no-ask-user` | 非交互模式，Agent 自主决策不询问用户 |
| `--no-color` | 去掉 ANSI 颜色码，输出纯文本 |
| `--max-autopilot-continues N` | 最大自主继续轮次（默认 10） |
| `-p "任务描述"` | 任务 prompt |

### 实时流

采用 **SSE（Server-Sent Events）** 将 Agent 进程的 stdout/stderr 实时推送到浏览器：

```
GET /agent/stream   ← 浏览器建立 SSE 长连接
POST /agent/start   ← 启动 Agent 子进程
```

新连接自动 replay 已缓存的历史输出（最多 500 条消息），不会错过任何内容。

### 历史上下文注入

每次任务启动时，自动将最近 3 次任务的执行摘要注入到 prompt 前缀，提升 Agent 的连续性：

```
[历史任务上下文]
任务：...
输出摘要：...
---
[当前任务]
你输入的任务
```

---

## 三、接口列表

所有 Agent 接口挂载在 `/agent` 下：

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/agent/stream` | SSE 实时流（自动 replay） |
| `POST` | `/agent/start` | 启动 Agent 任务 |
| `POST` | `/agent/stop` | 强制停止 Agent |
| `GET` | `/agent/status` | 查询当前状态 |
| `GET` | `/agent/history` | 历史记录列表 |
| `DELETE` | `/agent/history` | 清除历史 |
| `GET` | `/agent/detect` | 检测 Copilot CLI 是否可用 |

### POST `/agent/start` 参数

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|:---:|:---:|---|
| `task` | string | ✅ | — | 任务描述 |
| `maxContinues` | number | — | `10` | 最大自主继续轮次 |
| `saveAs` | string | — | — | 完成后保存为文档，如 `output/result` |
| `useHistory` | boolean | — | `true` | 是否注入历史上下文 |

---

## 四、环境配置

### 安装 Copilot CLI

```bash
npm install -g @github/copilot
```

### 代理配置（国内必须）

在系统环境变量或启动前设置：

```bash
set HTTPS_PROXY=http://127.0.0.1:7890
set HTTP_PROXY=http://127.0.0.1:7890
```

或创建 `.env` 文件（需安装 dotenv）：

```env
HTTPS_PROXY=http://127.0.0.1:7890
HTTP_PROXY=http://127.0.0.1:7890
```

### 自定义 CLI 路径

```bash
set COPILOT_CMD=C:\path\to\copilot.cmd
```

---

## 五、示例任务

```
扫描 docs 目录下的所有文档，生成一份按主题分类的索引
```

```
阅读 如何使用文档.md 并用英文写一份简洁的 README
```

```
检查 server.js 和 routes/ 下的代码，找出潜在的安全问题并给出修复建议
```
