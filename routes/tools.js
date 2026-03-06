/**
 * Tools 路由
 * 挂载路径: /tools
 *
 * 提供两个执行工具接口，供 Agent 或外部系统调用：
 *   POST /tools/python  — 执行 Python 代码片段
 *   POST /tools/shell   — 执行 PowerShell 命令/脚本
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

module.exports = router;
