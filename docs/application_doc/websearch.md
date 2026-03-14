# WebSearch 应用

> **端口**: 7443  
> **路径**: E:\docs-service\application\websearch\  
> **启动**: 运行 start.bat 或 python app.py

## 功能

基于 DuckDuckGo Search 提供三种搜索类型：

| 类型 | 说明 |
|------|------|
| 🌐 网页 | 全文搜索，返回标题 + URL + 摘要 |
| 📰 新闻 | 新闻搜索，附带发布日期和来源 |
| 🖼️ 图片 | 图片搜索，显示缩略图网格 |

## API

### POST /search

请求：
`json
{
  "q": "搜索词",
  "type": "text",
  "limit": 10,
  "region": "cn-zh"
}
`

响应：
`json
{
  "success": true,
  "query": "搜索词",
  "type": "text",
  "total": 10,
  "results": [...]
}
`

## 依赖

- Flask
- flask-cors
- duckduckgo-search==8.1.1