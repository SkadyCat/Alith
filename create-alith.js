const fs = require('fs');
const path = require('path');

// Create directory
const dirPath = 'E:/docs-service/application/alith';
fs.mkdirSync(dirPath, { recursive: true });
console.log('✓ Created directory: ' + dirPath);

// Create README.md
const readmePath = path.join(dirPath, 'README.md');
const readmeContent = `# Alith — 爱丽丝代码结构分析

> 本文档由爱丽丝自动生成，描述 \`docs-service\` 系统（爱丽丝）的完整代码结构与架构关系。

## 项目概述

爱丽丝是一个基于 Node.js + Express 的文档服务系统，运行在 \`E:\\docs-service\`，端口 \`7439\`。
核心能力：
- 📄 Markdown 文档管理（CRUD）
- 🤖 CopilotCli Agent 自主执行任务
- 🔍 全文搜索
- 🐍 Python / PowerShell 工具执行

## 代码结构

\`\`\`
docs-service/
├── server.js          # 主入口：Express 应用初始化、文档 CRUD API
├── package.json       # 依赖声明（express, marked, highlight.js）
├── rundoc.bat         # Windows 快速启动脚本
├── routes/
│   ├── agent.js       # /agent  — CopilotCli Agent 控制路由
│   ├── external.js    # /open   — 对外开放接口（提交/搜索/学习）
│   └── tools.js       # /tools  — Python & Shell 执行工具
├── public/
│   ├── index.html     # 前端单页应用
│   ├── app.js         # 前端逻辑（编辑器、文件树、SSE）
│   └── style.css      # UI 样式
├── tools/
│   ├── python_runner.py   # Python 代码沙箱执行器
│   └── shell_runner.ps1   # PowerShell 命令执行器
├── docs/              # 文档存储目录（.md 文件）
│   └── history/       # Agent 会话历史文档
├── data/              # 持久化数据（agent-history.md）
└── application/       # 应用扩展目录（本目录）
    └── alith/         # 爱丽丝代码结构分析
\`\`\`

## Mermaid 架构图

详见 [architecture.md](./architecture.md)
`;

fs.writeFileSync(readmePath, readmeContent);
console.log('✓ Created file: README.md');

// Create architecture.md
const archPath = path.join(dirPath, 'architecture.md');
const archContent = `# 爱丽丝（docs-service）架构图

## 整体系统架构

\`\`\`mermaid
graph TB
    subgraph Client["🌐 客户端 (Browser)"]
        UI["index.html\\n前端单页应用"]
        AppJS["app.js\\n前端逻辑"]
        CSS["style.css\\n界面样式"]
        UI --> AppJS
    end

    subgraph Server["🖥️ 服务端 (Node.js :7439)"]
        Entry["server.js\\n主入口 / Express"]

        subgraph Routes["路由层 routes/"]
            AgentR["agent.js\\nGET  /agent/stream\\nPOST /agent/start\\nPOST /agent/stop\\nGET  /agent/status\\nGET  /agent/history\\nPOST /agent/auth\\nGET  /agent/detect\\nGET  /agent/docs\\nGET  /agent/models"]
            ExternalR["external.js\\nPOST /open/submit\\nPOST /open/search\\nGET  /open/study"]
            ToolsR["tools.js\\nPOST /tools/python\\nPOST /tools/shell"]
        end

        subgraph DocAPI["文档 API (server.js)"]
            TreeAPI["GET  /api/tree"]
            FileAPI["GET  /api/file\\nPOST /api/file\\nDELETE /api/file"]
            CreateAPI["POST /api/create\\nPOST /api/mkdir"]
            RenderAPI["POST /api/render"]
        end

        Entry --> Routes
        Entry --> DocAPI
    end

    subgraph Storage["💾 文件存储"]
        Docs["docs/\\nMarkdown 文档"]
        History["docs/history/\\nAgent 会话历史"]
        Data["data/\\nagent-history.md"]
    end

    subgraph Tools["🔧 执行工具 tools/"]
        PyRunner["python_runner.py\\nPython 沙箱"]
        ShRunner["shell_runner.ps1\\nPowerShell 执行"]
    end

    subgraph External["🤖 外部依赖"]
        CopilotCLI["@github/copilot CLI\\nAutopilot Agent"]
    end

    Client -->|HTTP| Server
    AppJS -->|SSE| AgentR
    DocAPI --> Docs
    AgentR --> Data
    AgentR --> History
    AgentR --> CopilotCLI
    ToolsR --> PyRunner
    ToolsR --> ShRunner
\`\`\`

## Agent 执行流程

\`\`\`mermaid
sequenceDiagram
    participant UI as 前端 UI
    participant Agent as agent.js
    participant CLI as Copilot CLI
    participant FS as 文件系统

    UI->>Agent: POST /agent/start {task, model, systemDoc}
    Agent->>Agent: checkCliAvailable()
    Agent->>Agent: 注入 systemDoc / historyDoc / 历史上下文
    Agent->>CLI: spawn(copilot --autopilot --yolo -p prompt)
    CLI-->>Agent: stdout/stderr (流式)
    Agent-->>UI: SSE broadcast(output)
    Agent->>Agent: heartbeat 每3秒
    CLI-->>Agent: close(code)
    Agent->>FS: appendFile(data/agent-history.md)
    opt saveAs 指定
        Agent->>FS: writeFile(docs/saveAs.md)
    end
    opt historyDoc 指定
        Agent->>FS: appendFile(docs/history/xxx.md)
    end
    Agent-->>UI: SSE broadcast(done)
\`\`\`

## 对外开放接口 (open)

\`\`\`mermaid
graph LR
    subgraph OpenAPI["/open 对外接口"]
        Submit["POST /open/submit\\n提交/覆盖文档"]
        Search["POST /open/search\\n全文模糊搜索\\nfuzzy/words/exact/regex"]
        Study["GET /open/study\\n返回使用文档原文"]
    end

    Submit --> Docs[("docs/\\n文档存储")]
    Search --> Docs
    Study --> HowTo["docs/如何使用文档.md"]
\`\`\`

## 模型支持

\`\`\`mermaid
graph LR
    Models["支持模型"]
    Models --> M1["默认模型\\n64K tokens"]
    Models --> M2["GPT-4.1\\n1M tokens"]
    Models --> M3["Claude Sonnet 4.6\\n200K tokens"]
    Models --> M4["Claude Opus 4.6\\n200K tokens"]
    Models --> M5["Claude Haiku 4.5\\n200K tokens"]
    Models --> M6["Gemini 3 Pro\\n1M tokens"]
\`\`\`
`;

fs.writeFileSync(archPath, archContent);
console.log('✓ Created file: architecture.md');

console.log('\n✓ All files created successfully!');
