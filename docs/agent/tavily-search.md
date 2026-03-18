# Tavily Web Search 工具

> 部署时间：2026-03-15  
> 端点：`POST http://localhost:7439/tools/tavily-search`

## 快速上手

### 1. 获取 API Key（免费）

访问 https://app.tavily.com/ 注册，获取 `tvly-xxx...` 格式的 Key。  
**免费套餐：每月 1000 次搜索。**

### 2. 填写 API Key

编辑 `application/tavily-search/.env`：

```
TAVILY_API_KEY=tvly-你的真实key
```

### 3. 调用示例

```python
import requests

session = requests.Session()
session.trust_env = False  # 禁用代理，避免 Clash 拦截本地请求

resp = session.post('http://localhost:7439/tools/tavily-search', json={
    "query": "Python asyncio 最佳实践",
    "max_results": 5,
    "search_depth": "basic",
    "include_answer": True
})
data = resp.json()
print(data['answer'])
for r in data['results']:
    print(r['title'], r['url'])
```

## 接口文档

### `POST /tools/tavily-search`

**请求体**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | string | ✅ | 搜索词 |
| `max_results` | number | ❌ | 返回结果数，默认 5，最多 10 |
| `search_depth` | string | ❌ | `"basic"`（快）/ `"advanced"`（深），默认 `"basic"` |
| `include_answer` | boolean | ❌ | 是否包含 AI 摘要，默认 `true` |

**响应**

```json
{
  "success": true,
  "answer": "AI 整合摘要...",
  "query": "你的搜索词",
  "results": [
    {
      "title": "页面标题",
      "url": "https://...",
      "content": "页面摘录...",
      "score": 0.95
    }
  ]
}
```

## 文件结构

```
E:\docs-service\
├── tools\
│   └── tavily_search.py          ← Python 脚本
├── routes\
│   └── tools.js                  ← 新增 /tools/tavily-search 端点（热重载）
└── application\
    └── tavily-search\
        └── .env                  ← 填入 TAVILY_API_KEY
```
