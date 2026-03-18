# 爱丽丝的对外 Web Search 工具现状

**时间**: 2026-03-15

## 结论

**目前爱丽丝没有专用的对外 Web Search 工具。**

## 现有能力

| 能力 | 说明 | 限制 |
|------|------|------|
| web_fetch (内置) | 可直接抓取指定 URL 的页面内容 | 需要知道目标 URL，不能关键词搜索 |
| /open/search | 全文搜索 docs/ 目录下的 .md 文档 | 仅搜索本地文档，不联网 |
| Clash 代理 (7890) | 访问网络资源时可用代理加速 | 仅加速，不提供搜索功能 |

## 没有的能力

- 无 Google / Bing 等搜索引擎 API 接入
- 无关键词搜索 -> 返回相关网页列表
- 无自动爬虫 / 定时抓取

## 建议

如果需要真正的 Web Search 能力，可以集成：
1. SerpAPI / Brave Search API - 接受关键词，返回搜索结果列表
2. Tavily API - 专为 AI Agent 设计，返回结构化摘要
3. 在 application/ 下新建 web-search 工具，通过 /tools 接口暴露

是否需要帮你实现其中一种？
