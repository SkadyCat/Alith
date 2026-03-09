/**
 * pyagent_server.js
 * ─────────────────────────────────────────────────────────────────────────────
 * PyAgent TCP 服务 — 独立进程，监听 127.0.0.1:7441
 *
 * 协议：每条消息为一行 JSON，以 '\n' 结尾
 *   请求: { action: 'ping'|'status'|'start'|'stop'|'continue'|'subscribe', params: {...} }
 *   响应: { type: '...', ... }
 *   广播: { type: 'agent_output'|'status', sessionId, ... }（推送给所有连接的客户端）
 *
 * 用法: node pyagent_server.js
 */

'use strict';

const net    = require('net');
const { spawn } = require('child_process');
const path   = require('path');
const os     = require('os');
const fs     = require('fs');

const HOST = '127.0.0.1';
const PORT = 7441;

const ROOT_DIR = __dirname;
const DOCS_DIR = path.join(ROOT_DIR, 'docs');
const HISTORY_DIR = path.join(DOCS_DIR, 'history');
const RUNTIME_DIR = path.join(ROOT_DIR, 'runtime');
const BASE_URL = 'http://localhost:7439';

// ── 会话状态 ──────────────────────────────────────────────────────────────────
const sessions = new Map();

function getSession(id) {
  const sid = String(id || 'default');
  if (!sessions.has(sid)) {
    sessions.set(sid, {
      process:  null,
      status:   'idle',  // idle | running | done | error
      task:     null,
    });
  }
  return sessions.get(sid);
}

// ── 广播：推送到所有已连接的 Socket ─────────────────────────────────────────
const allSockets = new Set();

function broadcast(obj) {
  const line = JSON.stringify(obj) + '\n';
  for (const sock of allSockets) {
    try { sock.write(line); } catch (_) { allSockets.delete(sock); }
  }
}

// ── 检测 Copilot CLI ──────────────────────────────────────────────────────────
let _cmdCache = null;
function detectCopilotCmd() {
  if (_cmdCache) return _cmdCache;
  if (process.env.COPILOT_CMD) {
    return (_cmdCache = { cmd: process.env.COPILOT_CMD, args: [], shell: false });
  }
  const npmRoots = [
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules'),
    path.join(os.homedir(), 'AppData', 'Local', 'npm', 'node_modules'),
  ];
  if (process.env.npm_config_prefix) {
    npmRoots.unshift(path.join(process.env.npm_config_prefix, 'node_modules'));
  }
  try {
    const { execFileSync } = require('child_process');
    const npmGlobal = execFileSync('npm', ['root', '-g'], {
      timeout: 3000, encoding: 'utf8', windowsHide: true,
      shell: process.platform === 'win32',
    }).trim();
    if (npmGlobal) npmRoots.unshift(npmGlobal);
  } catch (_) {}

  for (const root of npmRoots) {
    const candidate = path.join(root, '@github', 'copilot', 'npm-loader.js');
    if (fs.existsSync(candidate)) {
      return (_cmdCache = { cmd: process.execPath, args: [candidate], shell: false });
    }
  }
  const isWin = process.platform === 'win32';
  return (_cmdCache = { cmd: isWin ? 'copilot.cmd' : 'copilot', args: [], shell: isWin });
}

// ── 构建 prompt ───────────────────────────────────────────────────────────────
function buildPrompt(params) {
  const { task = '', systemDocs = [], taskPrefixDoc = '', historyDoc = '', sessionId = '' } = params;
  const SYSDOC_BUDGET  = 5000;
  const PREFIX_BUDGET  = 10000;
  const HIST_BUDGET    = 8000;

  let parts = [];

  // 系统设定文档
  if (Array.isArray(systemDocs) && systemDocs.length > 0) {
    for (const rel of systemDocs) {
      try {
        let content = fs.readFileSync(path.join(DOCS_DIR, rel), 'utf8');
        if (content.length > SYSDOC_BUDGET) content = content.slice(0, SYSDOC_BUDGET) + '\n[…已截断]';
        parts.push(`[系统设定 — ${rel}]\n${content}`);
      } catch (_) {}
    }
  }

  // 会话历史文档
  if (historyDoc) {
    try {
      let content = fs.readFileSync(path.join(HISTORY_DIR, historyDoc), 'utf8');
      if (content.length > HIST_BUDGET) content = '[…早期记录已省略，以下为最新会话记录]\n' + content.slice(-HIST_BUDGET);
      parts.push(`[会话历史 — history/${historyDoc}]\n${content}`);
    } catch (_) {}
  }

  // 任务前缀文档
  let currentTask = task.trim();
  if (taskPrefixDoc) {
    try {
      let prefContent = fs.readFileSync(path.join(DOCS_DIR, taskPrefixDoc), 'utf8');
      prefContent = prefContent
        .replace(/\{\{RUNTIME_DIR\}\}/g, RUNTIME_DIR)
        .replace(/\{\{BASE_URL\}\}/g, BASE_URL)
        .replace(/\{\{SESSION_ID\}\}/g, sessionId || '')
        .replace(/\{\{HISTORY_FILE\}\}/g, historyDoc ? path.join(HISTORY_DIR, historyDoc) : '');
      if (prefContent.length > PREFIX_BUDGET) prefContent = prefContent.slice(0, PREFIX_BUDGET) + '\n[…已截断]';
      const trimmedPref = prefContent.trimEnd();
      if (trimmedPref.endsWith('现在执行任务：') || trimmedPref.endsWith('现在执行任务:')) {
        currentTask = trimmedPref + '\n' + currentTask;
      } else {
        currentTask = trimmedPref + '\n\n[当前任务]\n' + currentTask;
      }
    } catch (_) {
      parts.push('[当前任务]');
      parts.push(currentTask);
    }
    return parts.join('\n\n') + (parts.length > 0 ? '\n\n' : '') + currentTask;
  }

  parts.push('[当前任务]');
  parts.push(currentTask);
  return parts.join('\n\n');
}

// ── 动作处理 ──────────────────────────────────────────────────────────────────
function handleAction(action, params, respond) {
  const sessionId = String((params && params.sessionId) || 'default');

  if (action === 'ping') {
    respond({ type: 'pong' });
    return;
  }

  if (action === 'status') {
    const sess = getSession(sessionId);
    respond({ type: 'status', sessionId, status: sess.status, task: sess.task });
    return;
  }

  if (action === 'subscribe') {
    respond({ type: 'subscribed', sessionId });
    return;
  }

  if (action === 'start') {
    const sess = getSession(sessionId);
    if (sess.process && sess.process.exitCode === null) {
      respond({ type: 'error', error: '会话正在运行中' });
      return;
    }

    const prompt = buildPrompt({ ...params, sessionId });
    const { cmd, args, shell } = detectCopilotCmd();
    const maxCont = parseInt(params.maxContinues) || 10;
    const histDoc = params.historyDoc || '';

    // 立即将用户任务写入历史文档
    if (histDoc) {
      try {
        const histPath = path.join(HISTORY_DIR, histDoc);
        const now = new Date().toLocaleString('zh-CN', { hour12: false });
        const userHeader = `\n\n> 💬 **[用户留言 ${now}]**\n>\n> ${(params.task || '').replace(/\n/g, '\n> ')}\n`;
        fs.appendFileSync(histPath, userHeader, 'utf8');
      } catch (_) {}
    }

    const agentArgs = [
      ...args,
      '--no-alt-screen',
      '--no-color',
      '--autopilot',
      '--yolo',
      '--no-ask-user',
      '--max-autopilot-continues', String(maxCont),
      '-p', prompt,
    ];
    if (params.model) agentArgs.push('--model', params.model);

    const env = { ...process.env };
    if (!env.HTTPS_PROXY && !env.HTTP_PROXY) {
      env.HTTPS_PROXY = 'http://127.0.0.1:7890';
      env.HTTP_PROXY  = 'http://127.0.0.1:7890';
    }
    // 将 tools/ 目录加入 PATH，使 pwsh.cmd 垫片可被 copilot CLI 找到
    const toolsDir = path.join(ROOT_DIR, 'tools');
    const pathSep = process.platform === 'win32' ? ';' : ':';
    env.PATH = toolsDir + pathSep + (env.PATH || '');

    try {
      const child = spawn(cmd, agentArgs, {
        env, shell, windowsHide: true, cwd: ROOT_DIR,
      });

      sess.process  = child;
      sess.status   = 'running';
      sess.task     = params.task;
      sess.historyDoc = params.historyDoc || '';
      sess.outputBuf  = '';  // 累积 stdout 用于写入历史

      broadcast({ type: 'status', sessionId, status: 'running', task: params.task });

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString('utf8');
        sess.outputBuf += text;
        broadcast({ type: 'agent_output', sessionId, stream: 'stdout', text });
      });
      child.stderr.on('data', (chunk) => {
        broadcast({ type: 'agent_output', sessionId, stream: 'stderr', text: chunk.toString('utf8') });
      });
      child.on('close', (code) => {
        // 将本次会话输出追加到历史文档
        if (sess.historyDoc && sess.outputBuf.trim()) {
          try {
            const histPath = path.join(HISTORY_DIR, sess.historyDoc);
            const now = new Date().toLocaleString('zh-CN', { hour12: false });
            const header = `\n\n---\n**[${now}] 任务：${(sess.task || '').slice(0, 60)}**\n\n`;
            const footer = `\n\n> 退出码: ${code}\n`;
            // 简单过滤 ANSI 控制字符
            const clean = sess.outputBuf.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\r\n/g, '\n');
            fs.appendFileSync(histPath, header + clean + footer, 'utf8');
            broadcast({ type: 'history-saved', sessionId, path: `history/${sess.historyDoc}` });
          } catch (_) {}
        }
        sess.outputBuf = '';
        sess.process = null;
        sess.status  = 'idle';
        broadcast({ type: 'status', sessionId, status: 'idle', exitCode: code });
        broadcast({
          type: 'agent_output', sessionId, stream: 'done',
          text: `\n[Agent 已退出，退出码: ${code}]\n`,
        });
      });
      child.on('error', (err) => {
        sess.process = null;
        sess.status  = 'error';
        broadcast({ type: 'status', sessionId, status: 'error', error: err.message });
        broadcast({ type: 'agent_output', sessionId, stream: 'stderr', text: `[启动失败: ${err.message}]` });
      });

      respond({ type: 'started', sessionId });
    } catch (e) {
      respond({ type: 'error', error: e.message });
    }
    return;
  }

  if (action === 'stop') {
    const sess = getSession(sessionId);
    if (sess.process) {
      try { sess.process.kill('SIGTERM'); } catch (_) {}
      try { sess.process.kill('SIGKILL'); } catch (_) {}
    }
    sess.status = 'idle';
    respond({ type: 'stopped', sessionId });
    return;
  }

  if (action === 'continue') {
    const sess = getSession(sessionId);
    const inputText = params.input || 'y';
    if (sess.process && sess.process.stdin) {
      try { sess.process.stdin.write(inputText + '\n'); } catch (_) {}
    }
    // 将用户输入立即追加到历史文档
    if (sess.historyDoc) {
      try {
        const histPath = path.join(HISTORY_DIR, sess.historyDoc);
        const now = new Date().toLocaleString('zh-CN', { hour12: false });
        const entry = `\n\n> 💬 **[用户留言 ${now}]**\n>\n> ${inputText.replace(/\n/g, '\n> ')}\n`;
        fs.appendFileSync(histPath, entry, 'utf8');
      } catch (_) {}
    }
    respond({ type: 'continued', sessionId });
    return;
  }

  respond({ type: 'error', error: `未知动作: ${action}` });
}

// ── TCP 服务 ──────────────────────────────────────────────────────────────────
const server = net.createServer((socket) => {
  allSockets.add(socket);
  let buf = '';

  socket.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (_) { continue; }

      handleAction(msg.action, msg.params || {}, (resp) => {
        try { socket.write(JSON.stringify(resp) + '\n'); } catch (_) {}
      });
    }
  });

  socket.on('close', () => allSockets.delete(socket));
  socket.on('error', () => allSockets.delete(socket));
});

server.listen(PORT, HOST, () => {
  console.log(`[PyAgent] TCP 服务已启动 ${HOST}:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[PyAgent] 端口 ${PORT} 已被占用，服务已在运行`);
    process.exit(0);
  } else {
    console.error(`[PyAgent] 启动失败: ${err.message}`);
    process.exit(1);
  }
});
