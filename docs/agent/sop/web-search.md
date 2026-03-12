# SOP：网页搜索

> 版本：v1.0 | 最后更新：2026-03-12

## 步骤

1. 使用 `web_fetch` 工具或系统内置搜索接口
2. 优先访问权威来源（官方文档、知名博客、arXiv）
3. 若内容被截断，用 `start_index` 参数翻页继续读取
4. 可并行发起多个 fetch 提高效率
5. 整理结果后写入 `docs/agent/` 目录下对应 .md 文件

## 常用资源

- 技术博客：lilianweng.github.io、huggingface.co/blog
- 代理设置：Clash 代理端口 7890（下载资源时使用）
- 本地文档服务：http://localhost:7439

## 注意事项

- Google 搜索结果为 JS 渲染，直接 fetch 效果差，优先访问具体页面
- 整理结果时注重结构化（表格、代码块、标题层级）
