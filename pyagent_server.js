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
const CHAT_DIR = path.join(DOCS_DIR, 'agent', 'chat');
const BASE_URL = 'http://localhost:7439';

// ── 聊天持久化（直接写文件，不依赖 TCP 广播连接）────────────────────────────
fs.mkdirSync(CHAT_DIR, { recursive: true });

function getChatPath(sessionId) {
  const base = sessionId && sessionId.endsWith('.md') ? sessionId : (sessionId || 'pyagent') + '.md';
  return path.join(CHAT_DIR, base);
}

function stripAnsi(text) {
  return String(text)
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

// 过滤 Claude CLI 工具块（● ToolName + 缩进内容）不写入聊天文件
// _filterBlockState 保持每会话的跨 chunk 状态，避免多 chunk 块泄漏
const _filterBlockState = new Map(); // sessionId → boolean

function filterChatNoise(text, sessionId) {
  // 规范化：若 ● 出现在行中间（前面有其他内容），插入换行使其成为行首
  const normalized = text.replace(/([^\n])([●•]\s+\S)/g, '$1\n$2');
  const lines = normalized.split('\n');
  const result = [];
  let inBlock = _filterBlockState.get(sessionId) || false;
  for (const line of lines) {
    if (/^[●•]\s+\S/.test(line)) { inBlock = true; continue; }
    if (inBlock) {
      if (/^[ \t]/.test(line) || /^└/.test(line) || line === '') continue;
      inBlock = false;
    }
    result.push(line);
  }
  if (sessionId) _filterBlockState.set(sessionId, inBlock);
  return result.join('\n');
}

function appendToChat(sessionId, text) {
  if (!sessionId || !text) return;
  try { fs.appendFileSync(getChatPath(sessionId), text, 'utf-8'); } catch (_) {}
}

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
const broadcastSockets = new Set();  // 专门接收广播的长连接（来自 routes/pyagent.js）

function broadcast(obj) {
  const line = JSON.stringify(obj) + '\n';
  for (const sock of allSockets) {
    try { sock.write(line); } catch (_) { allSockets.delete(sock); }
  }
}

// ── 代理可用性缓存 ────────────────────────────────────────────────────────────
let _proxyAvailable = null;        // null=未检测, true=可用, false=不可用
let _proxyCheckTs   = 0;
const PROXY_CACHE_TTL = 30000;    // 30 秒缓存

function checkProxyAvailable(host, port) {
  const now = Date.now();
  if (_proxyAvailable !== null && now - _proxyCheckTs < PROXY_CACHE_TTL) {
    return Promise.resolve(_proxyAvailable);
  }
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(800);
    sock.connect(port, host, () => {
      sock.destroy();
      _proxyAvailable = true;
      _proxyCheckTs   = Date.now();
      resolve(true);
    });
    sock.on('error', () => { sock.destroy(); _proxyAvailable = false; _proxyCheckTs = Date.now(); resolve(false); });
    sock.on('timeout', () => { sock.destroy(); _proxyAvailable = false; _proxyCheckTs = Date.now(); resolve(false); });
  });
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
  const PREFIX_BUDGET  = 12000;
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
        .replace(/\{\{CHAT_DIR\}\}/g, CHAT_DIR)
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

// ── doSpawn：实际 spawn Copilot CLI ────────────────────────────────────────────
function doSpawn(cmd, agentArgs, env, shell, sess, sessionId, runId, histDoc, params) {
  try {
    let child;
    try {
      child = spawn(cmd, agentArgs, { env, shell, windowsHide: true, cwd: ROOT_DIR });
    } catch (epermErr) {
      if (epermErr.code === 'EPERM' || epermErr.message.includes('EPERM')) {
        // windowsHide:true 在某些 Windows 环境下会导致 EPERM，降级重试
        console.warn('[PyAgent] spawn EPERM with windowsHide:true, retrying without...');
        child = spawn(cmd, agentArgs, { env, shell, windowsHide: false, cwd: ROOT_DIR });
      } else {
        throw epermErr;
      }
    }

    sess.process    = child;
    sess.status     = 'running';
    sess.task       = params.task;
    sess.runId      = runId;
    sess.historyDoc = histDoc;
    sess.outputBuf  = '';
    if (sess.relaunchCount === undefined) sess.relaunchCount = 0;

    // 写入分隔线到聊天文件（任务文本由 routes/pyagent.js 的 persistPyChat 写入，避免重复）
    if (sessionId && sess.relaunchCount > 0) {
      // 重启时写入分隔线标记，初次启动由 routes 写入用户消息
      appendToChat(sessionId, `\n\n---\n\n`);
    }

    let _firstOutput = true;
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      sess.outputBuf += text;
      if (_firstOutput) {
        _firstOutput = false;
        broadcast({ type: 'agent_launched', sessionId, message: 'CopilotCli 启动成功' });
      }
      broadcast({ type: 'agent_output', sessionId, stream: 'stdout', text });
      // 直接写入聊天文件（不依赖广播连接是否建立）
      // 规范化：确保 ● 始终在行首（以便 filter 和 action 检测正确匹配）
      const cleaned = stripAnsi(text).replace(/([^\n])([●•]\s+\S)/g, '$1\n$2');
      const chatText = filterChatNoise(cleaned, sessionId);
      if (chatText.trim()) appendToChat(sessionId, chatText);
      // 检测 "● Tool action" 行，广播为 action 事件（前端气泡实时显示）
      const actionMatch = cleaned.match(/^[●•]\s+(.{1,120})/m);
      if (actionMatch) {
        broadcast({ type: 'action', sessionId, icon: '⚙️', label: actionMatch[1].trim() });
      }
    });
    child.stderr.on('data', (chunk) => {
      broadcast({ type: 'agent_output', sessionId, stream: 'stderr', text: chunk.toString('utf8') });
    });
    child.on('close', (code) => {
      if (sess.historyDoc && sess.outputBuf.trim()) {
        try {
          const histPath = path.join(HISTORY_DIR, sess.historyDoc);
          const now = new Date().toLocaleString('zh-CN', { hour12: false });
          const header = `\n\n---\n**[${now}] 任务：${(sess.task || '').slice(0, 60)}**\n\n`;
          const footer = `\n\n> 退出码: ${code}\n`;
          const clean = sess.outputBuf.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '').replace(/\r\n/g, '\n');
          fs.appendFileSync(histPath, header + clean + footer, 'utf8');
          broadcast({ type: 'history-saved', sessionId, path: `history/${sess.historyDoc}` });
        } catch (_) {}
      }
      // 写入退出标记到聊天文件
      appendToChat(sessionId, `\n\n> 退出码: ${code}\n`);
      // 重置 per-session 过滤状态（下次启动重新开始）
      _filterBlockState.delete(sessionId);

      sess.outputBuf = '';
      sess.process   = null;

      // 正常退出（code=0）且未被用户手动停止 → 自动 relaunch（最多 50 次）
      // pyagent 自身运行 POLL 脚本，relaunch 保持其持续监听 waitprocess/
      if (code === 0 && sess.status !== 'stopped' && sess.relaunchCount < 50) {
        sess.relaunchCount++;
        sess.status = 'running';
        const newRunId = Date.now().toString(36) + Math.random().toString(36).slice(2);
        broadcast({ type: 'agent_output', sessionId, stream: 'stdout',
          text: `\n[自动重启 #${sess.relaunchCount}]\n` });
        doSpawn(cmd, agentArgs, env, shell, sess, sessionId, newRunId, histDoc, params);
        return;
      }

      sess.status = 'idle';
      sess.relaunchCount = 0;
      broadcast({ type: 'status', sessionId, status: 'idle', exitCode: code, runId });
      broadcast({ type: 'agent_output', sessionId, stream: 'done', text: `\n[Agent 已退出，退出码: ${code}]\n` });
    });
    child.on('error', (err) => {
      sess.process = null;
      sess.status  = 'error';
      broadcast({ type: 'status', sessionId, status: 'error', error: err.message, runId });
      broadcast({ type: 'agent_output', sessionId, stream: 'stderr', text: `[启动失败: ${err.message}]` });
    });
  } catch (e) {
    sess.process = null;
    sess.status  = 'error';
    broadcast({ type: 'status', sessionId, status: 'error', error: e.message, runId });
    broadcast({ type: 'agent_output', sessionId, stream: 'stderr', text: `[spawn 异常: ${e.message}]` });
  }
}

// ── 文件队列：waitprocess / hasprocess ────────────────────────────────────────
function getQueueDirs(sessionId) {
  const dirName = (sessionId || 'default').replace(/\.md$/i, '');
  const base    = path.join(CHAT_DIR, dirName);
  const waitDir = path.join(base, 'waitprocess');
  const doneDir = path.join(base, 'hasprocess');
  fs.mkdirSync(waitDir, { recursive: true });
  fs.mkdirSync(doneDir, { recursive: true });
  return { waitDir, doneDir };
}

/* 取出 waitprocess/ 中最旧的任务文件，移动到 hasprocess/，返回文件内容；无任务则返回 null */
function readNextTask(sessionId) {
  try {
    const { waitDir, doneDir } = getQueueDirs(sessionId);
    const files = fs.readdirSync(waitDir).filter(f => f.endsWith('.md')).sort();
    if (files.length === 0) return null;
    const oldest  = files[0];
    const srcPath = path.join(waitDir, oldest);
    const dstPath = path.join(doneDir, oldest);
    const content = fs.readFileSync(srcPath, 'utf-8');
    fs.renameSync(srcPath, dstPath);
    console.log(`[PyAgent Queue] 取任务: ${oldest} (剩余 ${files.length - 1})`);
    return content;
  } catch (e) {
    console.error('[PyAgent Queue] readNextTask 失败:', e.message);
    return null;
  }
}

/* 活跃的 fs.Watcher，按 sessionId 索引，避免重复监听 */
const _queueWatchers = new Map();

/* 启动对 waitprocess/ 目录的监听；agent 空闲时自动派发下一条任务 */
function startQueueWatcher(sessionId, lastStartFn) {
  if (_queueWatchers.has(sessionId)) return;   // 已在监听
  const { waitDir } = getQueueDirs(sessionId);
  let watcher;
  try {
    watcher = fs.watch(waitDir, { persistent: false }, (event, filename) => {
      if (!filename || !filename.endsWith('.md')) return;
      const sess = sessions.get(String(sessionId));
      if (!sess || sess.status === 'running') return;  // 正在忙，等 close 后自动取
      const task = readNextTask(sessionId);
      if (task) {
        console.log(`[PyAgent Queue] 发现新任务，自动启动 agent`);
        lastStartFn(task);
      }
    });
    _queueWatchers.set(sessionId, watcher);
    console.log(`[PyAgent Queue] 开始监听 ${waitDir}`);
  } catch (e) {
    console.warn('[PyAgent Queue] fs.watch 失败（降级为轮询）:', e.message);
  }
}


function handleAction(action, params, respond, socket) {
  const sessionId = String((params && params.sessionId) || 'default');

  if (action === 'register_broadcast') {
    // 新模块实例连接时，关闭所有旧的 broadcast socket（热重载时清理僵尸连接）
    for (const s of broadcastSockets) {
      if (s !== socket) {
        try { s.destroy(); } catch (_) {}
        allSockets.delete(s);
      }
    }
    broadcastSockets.clear();
    broadcastSockets.add(socket);
    // 不需要回复，broadcast socket 只接收，不发送
    return;
  }

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
      // 进程还活着，先强制终止再重启（而不是报错拒绝）
      try { sess.process.kill('SIGTERM'); } catch (_) {}
      try { sess.process.kill('SIGKILL'); } catch (_) {}
      sess.process = null;
      sess.status = 'idle';
    }

    const histDoc = params.historyDoc || '';
    const runId = Date.now().toString(36) + Math.random().toString(36).slice(2);

    // ── 首次任务写入 waitprocess/ 队列 ──────────────────────────────────────
    // pyagent 启动后以 POLL 模式自行读取任务，不直接注入 prompt
    if (params.task && params.task.trim()) {
      try {
        const { waitDir } = getQueueDirs(sessionId);
        const fname   = Date.now().toString() + '-' + Math.floor(Math.random() * 1000).toString().padStart(3, '0') + '.md';
        const now     = new Date().toLocaleString('zh-CN', { hour12: false });
        const docContent = `# 用户任务\n\n**时间**: ${now}  \n**会话**: ${sessionId}\n\n---\n\n${params.task.trim()}`;
        fs.writeFileSync(path.join(waitDir, fname), docContent, 'utf-8');
        console.log(`[PyAgent Queue] 首次任务已写入 waitprocess/${fname}`);
      } catch (e) {
        console.error('[PyAgent Queue] 写入 waitprocess 失败:', e.message);
      }
    }

    // 以 POLL 模式启动（task 置空，pyagent 自行从 waitprocess/ 读取任务）
    const pollParams = { ...params, task: 'POLL' };
    const prompt = buildPrompt({ ...pollParams, sessionId });
    const { cmd, args, shell } = detectCopilotCmd();
    const maxCont = parseInt(params.maxContinues) || 100;

    // 立即将用户任务写入历史文档
    if (histDoc && params.task) {
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

    // 异步检测代理后再 spawn（不阻塞 TCP 响应，先 respond 再 spawn）
    checkProxyAvailable('127.0.0.1', 7890).then((proxyOk) => {
      const env = { ...process.env };
      if (!env.HTTPS_PROXY && !env.HTTP_PROXY) {
        if (proxyOk) {
          env.HTTPS_PROXY = 'http://127.0.0.1:7890';
          env.HTTP_PROXY  = 'http://127.0.0.1:7890';
          console.log('[PyAgent] 代理可用，已设置 HTTPS_PROXY=http://127.0.0.1:7890');
        } else {
          console.log('[PyAgent] 代理不可用（端口 7890 未开放），使用直连');
        }
      }
      // 将 tools/ 和 tools/pwsh7/ 加入 PATH
      const toolsDir  = path.join(ROOT_DIR, 'tools');
      const pwsh7Dir  = path.join(ROOT_DIR, 'tools', 'pwsh7');
      const pathSep = process.platform === 'win32' ? ';' : ':';
      env.PATH = pwsh7Dir + pathSep + toolsDir + pathSep + (env.PATH || '');

      doSpawn(cmd, agentArgs, env, shell, sess, sessionId, runId, histDoc, pollParams);
    });

    respond({ type: 'started', sessionId, runId });
    broadcast({ type: 'status', sessionId, status: 'running', task: params.task, runId });
    broadcast({ type: 'process_launched', sessionId, message: '进程已拉起' });
    return;
  }

  if (action === 'stop') {
    const sess = getSession(sessionId);
    if (sess.process) {
      try { sess.process.kill('SIGTERM'); } catch (_) {}
      try { sess.process.kill('SIGKILL'); } catch (_) {}
    }
    sess.status = 'stopped';  // 标记为手动停止，防止 doSpawn close handler 自动 relaunch
    sess.relaunchCount = 0;
    respond({ type: 'stopped', sessionId });
    return;
  }

  if (action === 'continue') {
    const sess = getSession(sessionId);
    const inputText = params.input || 'y';

    // 写入 waitprocess/ 队列（与 startQueueWatcher 机制保持一致）
    // CopilotCLI 以 --autopilot --no-ask-user 运行，不读 stdin；
    // 用户留言通过 waitprocess/ 文件队列传递给 POLL 脚本（GET /agent/input 也读此目录）
    try {
      const { waitDir } = getQueueDirs(sessionId);
      const fname     = Date.now().toString() + '-' + Math.floor(Math.random() * 1000).toString().padStart(3, '0') + '.md';
      const now       = new Date().toLocaleString('zh-CN', { hour12: false });
      const docContent = `# 用户留言\n\n**时间**: ${now}  \n**会话**: ${sessionId}\n\n---\n\n${inputText}`;
      fs.writeFileSync(path.join(waitDir, fname), docContent, 'utf-8');
    } catch (_) {}

    // 将用户输入立即追加到历史文档
    if (sess.historyDoc) {
      try {
        const histPath = path.join(HISTORY_DIR, sess.historyDoc);
        const now = new Date().toLocaleString('zh-CN', { hour12: false });
        const entry = `\n\n> 💬 **[用户留言 ${now}]**\n>\n> ${inputText.replace(/\n/g, '\n> ')}\n`;
        fs.appendFileSync(histPath, entry, 'utf8');
      } catch (_) {}
    }
    // 用户消息已由 routes/pyagent.js 的 persistPyChat 写入聊天文件，此处不重复写
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
      }, socket);
    }
  });

  socket.on('close', () => { allSockets.delete(socket); broadcastSockets.delete(socket); });
  socket.on('error', () => { allSockets.delete(socket); broadcastSockets.delete(socket); });
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
