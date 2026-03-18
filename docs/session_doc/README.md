# session_doc — 会话产出文档目录

每个 thinking 会话产出的文档自动归档到对应子文件夹：

```
session_doc/
  session-1773xxxxxxx/    ← 按会话 ID 分类
    report.md
    analysis.md
    ...
```

> **规则**：`/open/submit` 提交时，`filename` 必须以 `session_doc/{session_dirName}/` 为前缀。
