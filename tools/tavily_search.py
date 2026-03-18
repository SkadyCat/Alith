#!/usr/bin/env python3
"""
Tavily Web Search Tool
======================
从 stdin 读取 JSON 参数，调用 Tavily API 执行网页搜索，结果以 JSON 输出到 stdout。

输入 (JSON via stdin):
  {
    "query":        string,   // 搜索词（必填）
    "api_key":      string,   // Tavily API Key（必填）
    "max_results":  number,   // 返回结果数，默认 5，最多 10
    "search_depth": string,   // "basic"（快） / "advanced"（深），默认 "basic"
    "include_answer": bool    // 是否包含 AI 摘要，默认 true
  }

输出 (JSON):
  {
    "success": bool,
    "answer":  string,        // AI 摘要（如有）
    "results": [
      {
        "title":   string,
        "url":     string,
        "content": string,
        "score":   number
      }
    ],
    "error": string           // 仅失败时存在
  }
"""

import sys
import json

def main():
    raw = sys.stdin.read().strip()
    if not raw:
        print(json.dumps({"success": False, "error": "No input provided"}))
        return

    try:
        params = json.loads(raw)
    except json.JSONDecodeError as e:
        print(json.dumps({"success": False, "error": f"Invalid JSON: {e}"}))
        return

    query = params.get("query", "").strip()
    api_key = params.get("api_key", "").strip()
    max_results = min(int(params.get("max_results", 5)), 10)
    search_depth = params.get("search_depth", "basic")
    include_answer = params.get("include_answer", True)

    if not query:
        print(json.dumps({"success": False, "error": "query 参数必填"}))
        return

    if not api_key:
        print(json.dumps({"success": False, "error": "api_key 参数必填，请在配置文件中设置 TAVILY_API_KEY"}))
        return

    try:
        from tavily import TavilyClient
        client = TavilyClient(api_key=api_key)
        response = client.search(
            query=query,
            max_results=max_results,
            search_depth=search_depth,
            include_answer=include_answer
        )

        results = []
        for r in response.get("results", []):
            results.append({
                "title":   r.get("title", ""),
                "url":     r.get("url", ""),
                "content": r.get("content", ""),
                "score":   r.get("score", 0)
            })

        print(json.dumps({
            "success": True,
            "answer":  response.get("answer", ""),
            "results": results,
            "query":   query
        }, ensure_ascii=False))

    except ImportError:
        print(json.dumps({"success": False, "error": "tavily-python 未安装，请执行: pip install tavily-python"}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))

if __name__ == "__main__":
    main()
