# alith 代码分析 2

## 路由模块深度分析

### external.js — 文档接口

```
routes/external.js（约 252 行）
```

**主要功能**

| 路由 | 方法 | 核心逻辑 |
|------|------|----------|
| `/open/submit` | POST | `fs.writeFileSync` 写入 docs/，自动 `mkdirSync` 创建目录 |
| `/open/search` | POST | 递归遍历 .md 文件，按 mode 匹配标题/内容，返回得分排序结果 |
| `/open/study` | GET | 读取 `docs/如何使用文档.md` 原始内容 |

**搜索实现细节**

- `fuzzy`：字符逐一匹配，计算命中率得分
- `words`：分词后每词独立检索，全部命中才计入
- `exact`：`toLowerCase().includes()` 简单子串匹配
- `regex`：`new RegExp(q, 'i')` 正则匹配

---

### tools.js — 执行工具

```
routes/tools.js（约 164 行）
```

**执行流程**

```
POST /tools/python
  └─► 调用 tools/python_runner.py（stdin 传入代码）
        └─► 子进程执行 → 捕获 stdout/stderr/exitCode

POST /tools/shell
  └─► 调用 tools/shell_runner.ps1（stdin 传入命令）
        └─► PowerShell 子进程 → 返回 JSON 结构
```

**超时控制**：默认 30s，最大 120s，超时后 kill 子进程，exitCode 返回 -1

---

### agent.js — Agent 接口

```
routes/agent.js（约 669 行）
```

**状态机**

```
idle ──► running ──► done/error
          │
          └──► stopped（手动停止）
```

**SSE 推流机制**

- 客户端连接 `GET /agent/stream`，服务端持有 `res` 对象
- Agent 子进程每产生输出，立即通过 `res.write('data: ...\n\n')` 推送
- 支持事件类型：`output` / `agent-action` / `heartbeat` / `done` / `error`

**历史记录写入**

- 任务结束后追加写入 `docs/history/<historyDoc>.md`
- 包含：任务描述、模型、耗时、退出码、完整输出

---

## server.js 内联 API 分析

`/api` 路由直接内联在 `server.js`（约 301 行），未拆分为独立路由文件。

| 路由 | 功能 | 关键实现 |
|------|------|----------|
| `GET /api/tree` | 文件树 | 递归 `fs.readdirSync` 构建树形 JSON |
| `GET /api/file` | 读文件 | `fs.readFileSync` + marked 渲染 |
| `POST /api/file` | 写文件 | `fs.writeFileSync` |
| `POST /api/create` | 新建文件 | 检测存在后写空文件 |
| `POST /api/mkdir` | 新建目录 | `fs.mkdirSync({ recursive: true })` |
| `DELETE /api/file` | 删除文件 | `fs.unlinkSync` |
| `POST /api/render` | 渲染 MD | 仅 marked 转换，不涉及文件 |

---

## 工具脚本分析

### tools/python_runner.py

- 从 `stdin` 读取完整代码字符串
- 使用 `exec()` 在受限命名空间中执行
- 捕获 `stdout`/`stderr`，以 JSON 格式输出结果

### tools/shell_runner.ps1

- 从 `stdin` 读取 PowerShell 命令
- 使用 `Invoke-Expression` 执行
- 输出封装为 `{ stdout, stderr, exitCode }` JSON

### tools/pwsh.cmd（Shim）

- 转发 `pwsh.exe` 调用到本地内置 `tools/pwsh7/pwsh.exe`
- 解决系统未安装 PowerShell 7 的兼容问题

---

## 启动流程

```
node server.js
  ├── 加载 routes/external.js → 挂载 /open
  ├── 加载 routes/tools.js    → 挂载 /tools
  ├── 加载 routes/agent.js    → 挂载 /agent
  ├── 内联注册 /api 路由
  ├── 挂载 public/ 静态资源
  └── 监听端口 7439
```

---

## 安全边界说明

| 风险点 | 当前处理 |
|--------|----------|
| Python 任意代码执行 | 超时限制（120s），无沙箱隔离 |
| Shell 任意命令执行 | 超时限制（120s），无权限限制 |
| 文件路径遍历 | 路径限定在 `docs/` 目录内 |
| Agent 认证 | 依赖 GitHub OAuth Device Flow |
