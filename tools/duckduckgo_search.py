#!/usr/bin/env python3
"""
DuckDuckGo Search Tool
======================
无需 API Key，直接调用 DuckDuckGo 搜索。
从 stdin 读取 JSON 参数，结果以 JSON 输出到 stdout。

输入 (JSON via stdin):
  {
    "query":       string,   // 搜索词（必填）
    "max_results": number,   // 返回结果数，默认 5，最多 20
    "region":      string,   // 地区，默认 "cn-zh"（中文），"wt-wt"（全球）
    "safesearch":  string,   // "moderate" / "off" / "on"，默认 "moderate"
    "timelimit":   string    // "d"(天) / "w"(周) / "m"(月) / null，默认 null
  }

输出 (JSON):
  {
    "success": bool,
    "results": [
      {
        "title":   string,
        "url":     string,
        "body":    string
      }
    ],
    "error": string   // 仅失败时存在
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
    max_results = min(int(params.get("max_results", 5)), 20)
    region = params.get("region", "cn-zh")
    safesearch = params.get("safesearch", "moderate")
    timelimit = params.get("timelimit", None)

    if not query:
        print(json.dumps({"success": False, "error": "query 参数必填"}))
        return

    try:
        try:
            from ddgs import DDGS  # new package name (ddgs >= 1.0)
        except ImportError:
            from duckduckgo_search import DDGS  # fallback to old name

        with DDGS() as ddgs:
            raw_results = ddgs.text(
                query=query,
                region=region,
                safesearch=safesearch,
                timelimit=timelimit,
                max_results=max_results
            )

        results = [
            {"title": r.get("title", ""), "url": r.get("href", ""), "body": r.get("body", "")}
            for r in raw_results
        ]

        print(json.dumps({
            "success": True,
            "query": query,
            "results": results
        }, ensure_ascii=False))

    except ImportError:
        print(json.dumps({"success": False, "error": "duckduckgo-search 未安装"}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))


if __name__ == "__main__":
    main()
