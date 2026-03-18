/**
 * Tools 路由
 * 挂载路径: /tools
 *
 * 提供执行工具接口，供 Agent 或外部系统调用：
 *   POST /tools/python         — 执行 Python 代码片段
 *   POST /tools/shell          — 执行 PowerShell 命令/脚本
 *   POST /tools/tavily-search  — Tavily 网页搜索
 *
 * 安全说明：接口不对外暴露，仅限本机/内网访问。
 */

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');

const router = express.Router();
const TOOLS_DIR = path.join(__dirname, '..', 'tools');
const PWSH_EXE  = path.join(TOOLS_DIR, 'pwsh7', 'pwsh.exe');  // PowerShell 7 本地可移植版

// 优先使用 tools/python（嵌入式 Python），其次 tools/venv，最后系统 python
const EMBED_PY     = path.join(TOOLS_DIR, 'python', 'python.exe');
const VENV_PY_WIN  = path.join(TOOLS_DIR, 'venv', 'Scripts', 'python.exe');
const VENV_PY_UNIX = path.join(TOOLS_DIR, 'venv', 'bin', 'python');
const PYTHON_CMD = fs.existsSync(EMBED_PY)    ? EMBED_PY
                 : fs.existsSync(VENV_PY_WIN) ? VENV_PY_WIN
                 : fs.existsSync(VENV_PY_UNIX) ? VENV_PY_UNIX
                 : 'python';

const DEFAULT_TIMEOUT = 30_000; // 30 秒
const MAX_TIMEOUT = 120_000;    // 最多 2 分钟

/**
 * 通用进程执行器
 * @param {string}   cmd     可执行文件
 * @param {string[]} args    参数列表
 * @param {object}   opts    spawn 选项
 * @param {string}   stdin   写入 stdin 的内容
 * @param {number}   timeout 超时毫秒数
 * @returns {Promise<{stdout:string, stderr:string, exitCode:number}>}
 */
function runProcess(cmd, args, opts, stdin, timeout) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { ...opts, shell: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try { proc.kill('SIGTERM'); } catch (_) { /* ignore */ }
      resolve({ stdout, stderr: stderr + '\n[TIMEOUT: 执行超时]', exitCode: -1 });
    }, timeout);

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    if (stdin) {
      proc.stdin.write(stdin, 'utf8');
    }
    proc.stdin.end();

    proc.on('close', (code) => {
      if (timedOut) return;
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });

    proc.on('error', (err) => {
      if (timedOut) return;
      clearTimeout(timer);
      resolve({ stdout, stderr: err.message, exitCode: 1 });
    });
  });
}

// ── POST /tools/python ────────────────────────────────────────────────────────
/**
 * 执行 Python 代码片段
 *
 * 请求体 (JSON):
 *   code     {string}  必填 — Python 代码字符串
 *   timeout  {number}  可选 — 超时毫秒，默认 30000，最大 120000
 *
 * 响应:
 *   { success, stdout, stderr, exitCode }
 */
router.post('/python', async (req, res) => {
  const { code, timeout = DEFAULT_TIMEOUT } = req.body || {};

  if (!code || typeof code !== 'string' || !code.trim()) {
    return res.status(400).json({ success: false, error: 'code 字段必填，且不可为空' });
  }

  const ms = Math.min(Number(timeout) || DEFAULT_TIMEOUT, MAX_TIMEOUT);
  const runnerScript = path.join(TOOLS_DIR, 'python_runner.py');

  try {
    const result = await runProcess(
      PYTHON_CMD,
      [runnerScript],
      { cwd: TOOLS_DIR },
      code,
      ms
    );

    // python_runner.py 输出 JSON — 解析后合并
    let parsed = null;
    try { parsed = JSON.parse(result.stdout.trim()); } catch (_) { /* runner 异常 */ }

    if (parsed) {
      res.json({ success: parsed.exitCode === 0, ...parsed });
    } else {
      // runner 自身崩溃（语法错误等）
      res.json({
        success: false,
        stdout: '',
        stderr: result.stderr || result.stdout,
        exitCode: result.exitCode,
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /tools/shell ─────────────────────────────────────────────────────────
/**
 * 执行 PowerShell 命令或多行脚本
 *
 * 请求体 (JSON):
 *   command  {string}  必填 — PowerShell 命令/脚本字符串
 *   timeout  {number}  可选 — 超时毫秒，默认 30000，最大 120000
 *
 * 响应:
 *   { success, stdout, stderr, exitCode }
 */
router.post('/shell', async (req, res) => {
  const { command, timeout = DEFAULT_TIMEOUT } = req.body || {};

  if (!command || typeof command !== 'string' || !command.trim()) {
    return res.status(400).json({ success: false, error: 'command 字段必填，且不可为空' });
  }

  const ms = Math.min(Number(timeout) || DEFAULT_TIMEOUT, MAX_TIMEOUT);
  const runnerScript = path.join(TOOLS_DIR, 'shell_runner.ps1');

  // 优先用本地 PS7，回退到系统 pwsh / powershell
  const fs = require('fs');
  const pwshCmd = fs.existsSync(PWSH_EXE) ? PWSH_EXE : (process.platform === 'win32' ? 'pwsh' : 'pwsh');

  try {
    const result = await runProcess(
      pwshCmd,
      ['-NoProfile', '-NonInteractive', '-File', runnerScript],
      { cwd: TOOLS_DIR },
      command,
      ms
    );

    // shell_runner.ps1 输出 JSON
    let parsed = null;
    try { parsed = JSON.parse(result.stdout.trim()); } catch (_) { /* runner 异常 */ }

    if (parsed) {
      res.json({ success: parsed.exitCode === 0, ...parsed });
    } else {
      res.json({
        success: false,
        stdout: '',
        stderr: result.stderr || result.stdout,
        exitCode: result.exitCode,
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /tools/duckduckgo-search ────────────────────────────────────────────
/**
 * DuckDuckGo 网页搜索（无需 API Key）
 *
 * 请求体 (JSON):
 *   query        {string}  必填 — 搜索词
 *   max_results  {number}  可选 — 返回结果数，默认 5，最多 20
 *   region       {string}  可选 — 地区，默认 "cn-zh"（中文），"wt-wt"（全球）
 *   safesearch   {string}  可选 — "moderate"/"off"/"on"，默认 "moderate"
 *   timelimit    {string}  可选 — "d"(天)/"w"(周)/"m"(月)/null，默认 null
 *
 * 响应:
 *   { success, query, results: [{title, url, body}] }
 */
router.post('/duckduckgo-search', async (req, res) => {
  const { query, max_results = 5, region = 'cn-zh', safesearch = 'moderate', timelimit = null, timeout = 30000 } = req.body || {};

  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ success: false, error: 'query 字段必填，且不可为空' });
  }

  const ms = Math.min(Number(timeout) || 30000, MAX_TIMEOUT);
  const scriptPath = path.join(TOOLS_DIR, 'duckduckgo_search.py');
  const inputJson = JSON.stringify({ query, max_results, region, safesearch, timelimit });

  try {
    const result = await runProcess(PYTHON_CMD, [scriptPath], { cwd: TOOLS_DIR }, inputJson, ms);
    let parsed = null;
    try { parsed = JSON.parse(result.stdout.trim()); } catch (_) {}
    if (parsed) {
      res.json(parsed);
    } else {
      res.json({ success: false, error: result.stderr || result.stdout || '未知错误' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /tools/tavily-search ─────────────────────────────────────────────────
/**
 * Tavily 网页搜索
 *
 * 请求体 (JSON):
 *   query          {string}  必填 — 搜索词
 *   max_results    {number}  可选 — 返回结果数，默认 5，最多 10
 *   search_depth   {string}  可选 — "basic"（快）/ "advanced"（深），默认 "basic"
 *   include_answer {boolean} 可选 — 是否包含 AI 摘要，默认 true
 *
 * 响应:
 *   { success, answer, results: [{title, url, content, score}], query }
 *
 * API Key 配置: application/tavily-search/.env → TAVILY_API_KEY=tvly-xxx
 */
router.post('/tavily-search', async (req, res) => {
  const { query, max_results = 5, search_depth = 'basic', include_answer = true, timeout = 30000 } = req.body || {};

  if (!query || typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ success: false, error: 'query 字段必填，且不可为空' });
  }

  // Load API key from application/tavily-search/.env
  const envPath = path.join(__dirname, '..', 'application', 'tavily-search', '.env');
  let apiKey = process.env.TAVILY_API_KEY || '';
  if (!apiKey && fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/^TAVILY_API_KEY=(.+)$/m);
    if (match) apiKey = match[1].trim();
  }

  if (!apiKey || apiKey.startsWith('tvly-xxx')) {
    return res.status(400).json({
      success: false,
      error: '未配置 Tavily API Key。请编辑 application/tavily-search/.env，填入 TAVILY_API_KEY=tvly-你的key。免费申请: https://app.tavily.com/'
    });
  }

  const ms = Math.min(Number(timeout) || 30000, MAX_TIMEOUT);
  const scriptPath = path.join(TOOLS_DIR, 'tavily_search.py');
  const inputJson = JSON.stringify({ query, api_key: apiKey, max_results, search_depth, include_answer });

  try {
    const result = await runProcess(PYTHON_CMD, [scriptPath], { cwd: TOOLS_DIR }, inputJson, ms);

    let parsed = null;
    try { parsed = JSON.parse(result.stdout.trim()); } catch (_) {}

    if (parsed) {
      res.json(parsed);
    } else {
      res.json({ success: false, error: result.stderr || result.stdout || '未知错误' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
