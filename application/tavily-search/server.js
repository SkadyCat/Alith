'use strict';
/**
 * Tavily Search Service
 * 提供 Tavily AI 搜索 API 的本地代理服务
 * 端口: 7442
 */
const express = require('express');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = parseInt(process.env.PORT || '7442');

// Python 可执行路径 (使用 docs-service 内嵌 Python)
const PYTHON_EXE = path.join(__dirname, '..', '..', 'tools', 'python', 'python.exe');
const PYTHON_CMD = fs.existsSync(PYTHON_EXE) ? PYTHON_EXE : 'python';

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

/**
 * 用 Python 调用 Tavily SDK
 */
function tavilyCall(method, params, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const code = `
import sys, json, os
os.environ['TAVILY_API_KEY'] = ${JSON.stringify(process.env.TAVILY_API_KEY || '')}
from tavily import TavilyClient
client = TavilyClient(api_key=os.environ['TAVILY_API_KEY'])
params = ${JSON.stringify(params)}
result = getattr(client, ${JSON.stringify(method)})(**params)
print(json.dumps(result, ensure_ascii=False, default=str))
`;
    const proc = execFile(PYTHON_CMD, ['-c', code], { timeout }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (e) {
        reject(new Error(`JSON parse failed: ${stdout}`));
      }
    });
  });
}

// ── GET /api/status ──────────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  const apiKey = process.env.TAVILY_API_KEY || '';
  res.json({
    success: true,
    configured: apiKey.startsWith('tvly-') && apiKey.length > 10 && !apiKey.includes('YOUR_API_KEY'),
    python: PYTHON_CMD,
  });
});

// ── POST /api/search ─────────────────────────────────────────────────────────
/**
 * 网页搜索
 * Body: { query, search_depth?, max_results?, include_answer?, topic? }
 */
app.post('/api/search', async (req, res) => {
  const {
    query,
    search_depth = process.env.SEARCH_DEPTH || 'basic',
    max_results = parseInt(process.env.MAX_RESULTS || '5'),
    include_answer = true,
    include_images = false,
    topic = 'general',
  } = req.body || {};

  if (!query || !query.trim()) {
    return res.status(400).json({ success: false, error: 'query 字段必填' });
  }

  const apiKey = process.env.TAVILY_API_KEY || '';
  if (!apiKey.startsWith('tvly-')) {
    return res.status(503).json({ success: false, error: 'Tavily API Key 未配置。请在 .env 中设置 TAVILY_API_KEY=tvly-xxx' });
  }

  try {
    const result = await tavilyCall('search', {
      query,
      search_depth,
      max_results,
      include_answer,
      include_images,
      topic,
    }, 30000);

    res.json({
      success: true,
      query,
      answer: result.answer || '',
      results: (result.results || []).map(r => ({
        title: r.title,
        url: r.url,
        content: r.content,
        score: r.score,
      })),
      response_time: result.response_time,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── POST /api/extract ────────────────────────────────────────────────────────
/**
 * 提取网页内容
 * Body: { urls: [string] }
 */
app.post('/api/extract', async (req, res) => {
  const { urls } = req.body || {};
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ success: false, error: 'urls 数组必填' });
  }

  const apiKey = process.env.TAVILY_API_KEY || '';
  if (!apiKey.startsWith('tvly-')) {
    return res.status(503).json({ success: false, error: 'Tavily API Key 未配置' });
  }

  try {
    const result = await tavilyCall('extract', { urls }, 60000);
    res.json({ success: true, results: result.results || [] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => {
  const apiKey = process.env.TAVILY_API_KEY || '';
  const configured = apiKey.startsWith('tvly-') && apiKey.length > 10;
  console.log(`Tavily Search Service running at http://localhost:${PORT}`);
  console.log(`API Key: ${configured ? '✅ 已配置' : '⚠️  未配置 (请在 .env 中设置 TAVILY_API_KEY)'}`);
});
