# 回复：多 Session 是否各自维护 index.md？

**时间**: 2026-03-12

---

## 结论：不需要，SOP 应该全局共享

**SOP 记录的是"任务类型的做法"，与 session 无关。**  
session 只是执行的主体，知识应该共享。

---

## 推荐架构

`
E:\docs-service\docs\agent\
│
├── sop\                        ← 全局共享（所有session共用）
│   ├── index.md                ← SOP总索引（任务类型 → SOP文件）
│   ├── web-search.md           ← 网页搜索 SOP
│   ├── code-gen.md             ← 代码生成 SOP
│   └── doc-write.md            ← 文档整理 SOP
│
└── chat\                       ← 每个session私有
    ├── session-AAA\
    │   ├── waitprocess\        ← 该session的任务队列
    │   ├── hasprocess\         ← 该session的历史任务
    │   └── history\            ← 该session的对话记忆
    └── session-BBB\
        ├── waitprocess\
        ├── hasprocess\
        └── history\
`

---

## 好处

| | 全局共享 SOP | 每 session 独立 SOP |
|--|------------|-------------------|
| Session A 学到的经验 | Session B 自动受益 ✅ | Session B 需要重新学 ❌ |
| 维护成本 | 一份文件 ✅ | N份文件 ❌ |
| 任务路由 | 所有session统一读同一个index ✅ | 各session路由逻辑不同 ❌ |

---

## 什么时候需要 session 级别的记忆？

只有以下内容才需要 per-session 存储：
- **用户偏好**：某个用户喜欢的输出风格、语言
- **项目上下文**：某个session专门负责某个特定项目的细节
- **对话历史**：当前对话的上下文（已有的 history/ 目录）

可以在 session 目录下加一个 `context.md`：
`
docs/agent/chat/{sessionId}/context.md  ← 该session的专属背景信息
`

---

## 执行流程（整合后）

`
POLL 读取新任务
    ↓
读取全局 sop/index.md → 匹配任务类型 → 读取对应SOP
    ↓
读取 session级 context.md（如有）→ 补充个性化背景
    ↓
执行任务
    ↓
更新全局 SOP（如有新发现） + 更新session context（如有）
    ↓
返回 POLL
`

简单说：**SOP 是公共图书馆，session context 是个人笔记本。**