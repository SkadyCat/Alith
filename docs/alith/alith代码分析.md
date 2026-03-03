# alith 代码分析

## 系统架构

爱丽丝（alith）是一个基于 Node.js 的文档服务系统，运行在 `E:\docs-service`，监听端口 `7439`。

### 核心组成

| 模块 | 文件 | 说明 |
|------|------|------|
| 主服务 | `server.js` | Express 应用入口，挂载所有路由 |
| 对外接口 | `routes/external.js` | `/open` 文档接口（提交、搜索、学习）|
| 工具执行 | `routes/tools.js` | `/tools` Python / PowerShell 执行 |
| Agent 接口 | `routes/agent.js` | `/agent` Copilot CLI 封装 |
| 文件管理 | `server.js` (内联) | `/api` 文件树、读写、渲染 |

---

## 目录结构

```
E:\docs-service\
├── server.js          # 主入口，Express + 静态资源
├── routes/
│   ├── external.js    # /open 接口
│   ├── tools.js       # /tools 接口
│   └── agent.js       # /agent 接口
├── public/            # 前端静态文件
├── docs/              # Markdown 文档根目录
│   └── alith/         # alith 相关文档
├── application/       # 应用目录
├── tools/             # 工具脚本
├── create-alith.js    # alith 初始化脚本
└── package.json
```

---

## 接口层分析

### `/open` — 文档接口（external.js）

- `POST /open/submit`：写入 Markdown 文档到 `docs/` 目录，支持自动建目录与覆盖控制
- `POST /open/search`：全文搜索，支持 `fuzzy` / `words` / `exact` / `regex` 四种模式
- `GET /open/study`：返回使用说明文档原始内容

### `/tools` — 执行工具（tools.js）

- `POST /tools/python`：沙箱执行 Python 代码，返回 stdout / stderr / exitCode
- `POST /tools/shell`：执行 PowerShell 5.1 命令，返回标准输出

### `/agent` — Agent 接口（agent.js）

封装 GitHub Copilot CLI，提供：
- 任务启动 / 停止 / 状态查询
- SSE 实时输出流（`/agent/stream`）
- 历史记录文档管理
- GitHub 认证与 CLI 安装

### `/api` — 文件管理（server.js 内联）

提供文件树、读取、保存、新建、删除、Markdown 渲染等基础文件操作。

---

## 数据流

```
用户请求
  └─► Express Router
        ├─ /open  → external.js → docs/ 文件系统
        ├─ /tools → tools.js   → Python / PowerShell 子进程
        ├─ /agent → agent.js   → Copilot CLI 子进程 + SSE 推流
        └─ /api   → server.js  → docs/ 文件系统
```

---

## 技术栈

- **运行时**: Node.js
- **Web 框架**: Express
- **文档格式**: Markdown（通过 marked 渲染为 HTML）
- **Agent**: GitHub Copilot CLI（claude-sonnet-4.6）
- **执行环境**: PowerShell 5.1 / Python 沙箱

---

## 关键设计特点

1. **文档即数据库**：所有内容以 Markdown 存储在 `docs/`，无需外部数据库
2. **多模式搜索**：fuzzy 子序列匹配 + 正则 + 精确匹配，搜索能力灵活
3. **SSE 实时推流**：Agent 任务输出通过 Server-Sent Events 实时推送到前端
4. **历史记录**：每次 Agent 会话自动写入 `docs/history/` 保留完整执行日志
