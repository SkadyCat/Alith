# 会话历史：SOP 框架与长记忆机制

> 更新于 2026-03-12

---

# 【SOP 框架 — 执行前必读】

## SOP 自动路由规则

每次 POLL 读取到新任务后，**执行任务前**按以下步骤操作：

### 第一步：匹配 SOP
读取 `E:\docs-service\docs\agent\sop\index.md`，对任务文本做关键词匹配，找到对应 SOP 文件。

### 第二步：读取 SOP
加载匹配的 SOP 文件内容，作为本次任务的执行参考（步骤、注意事项、常用工具）。

### 第三步：读取 Session Context
读取 `E:\docs-service\docs\agent\chat\{sessionId}\context.md`，了解该 session 的用户偏好和历史背景。

### 第四步：执行任务
结合 SOP + Context + 任务内容，完成任务。

### 第五步：任务完成后更新
- 如有新经验 → 更新对应 SOP 文件
- 如是全新任务类型 → 创建新 SOP + 在 index.md 追加一行
- 更新 session 的 context.md「已完成工作记录」

---

## SOP 文件位置

`E:\docs-service\docs\agent\sop\`

| 文件 | 用途 |
|------|------|
| index.md | 全局路由索引（关键词 → SOP文件） |
| web-search.md | 网页搜索 |
| code-gen.md | 代码生成 |
| doc-write.md | 文档整理 |
| file-ops.md | 文件操作 |
| shell-ops.md | 系统命令 |

---

# 【PyAgent 执行控制流】

（保持原有 POLL 状态机不变，在任务读取后增加 SOP 匹配步骤）
