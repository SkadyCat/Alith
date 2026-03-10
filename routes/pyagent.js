/**
 * routes/pyagent.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Alith ↔ PyAgent 接口路由
 *
 * 提供 HTTP 端点，内部通过 TCP Socket 与 PyAgent 单例服务通信。
 * PyAgent 运行在 127.0.0.1:7441，负责维护与 CopilotCliAgent 的通信。
 *
 * 挂载路径: /pyagent
 *
 * 端点列表:
 *   GET  /pyagent/health       - 检查 PyAgent 是否在线
 *   GET  /pyagent/status       - 查询 agent 状态（?sessionId=...）
 *   POST /pyagent/start        - 启动 agent 任务
 *   POST /pyagent/stop         - 停止 agent
 *   POST /pyagent/continue     - 继续等待中的 agent
 *   POST /pyagent/subscribe    - 订阅 agent 输出（SSE）
 *   GET  /pyagent/stream       - SSE 流（实时接收 PyAgent 广播）
 */

'use strict';

const express = require('express');
const net     = require('net');
const http    = require('http');
const path    = require('path');
const fs      = require('fs');
const { spawn } = require('child_process');

const router = express.Router();

const PYAGENT_HOST    = '127.0.0.1';
const PYAGENT_PORT    = 7441;
const CONNECT_TIMEOUT = 5000;  // ms

// ─── 去重补丁：防止 pyagent_server.js 直写 + 旧模块广播重复写入 chat 文件 ─────────
// pyagent_server.js 先 broadcast（异步），再 appendToChat（同步），
// 所以文件写入完成后 TCP 数据才到达，此处拦截 appendFileSync 检查末尾是否已有相同内容。
(function installChatDedup() {
  const DEDUP_VERSION = 'v4-debug';
  if (require('fs')._pyagentChatDedup === DEDUP_VERSION) return;
  // Always use the true original (not a previous monkey-patch layer)
  if (!require('fs')._pyagentOrigAppend) {
    require('fs')._pyagentOrigAppend = require('fs').appendFileSync;
  }
  const _orig = require('fs')._pyagentOrigAppend;
  const _debugLog = require('path').join(__dirname, '..', 'runtime', 'chat_dedup_debug.log');
  require('fs').appendFileSync = function (filePath, data, encoding) {
    if (
      typeof filePath === 'string' &&
      filePath.replace(/\//g, '\\').includes('agent\\chat') &&
      typeof data === 'string' &&
      data.length > 0 &&
      data.length <= 8192
    ) {
      const stack = new Error().stack.split('\n').slice(1, 4).join(' | ');
      try {
        const dataBuf = Buffer.from(data, 'utf-8');
        const stat = require('fs').statSync(filePath);
        if (stat.size >= dataBuf.length) {
          const fd = require('fs').openSync(filePath, 'r');
          const buf = Buffer.alloc(dataBuf.length);
          require('fs').readSync(fd, buf, 0, dataBuf.length, stat.size - dataBuf.length);
          require('fs').closeSync(fd);
          if (buf.equals(dataBuf)) {
            try { _orig.call(this, _debugLog, `[SKIP] ${new Date().toISOString()} len=${dataBuf.length} | ${stack}\n`); } catch(_){}
            return; // 内容相同，跳过重复写入
          }
        }
        try { _orig.call(this, _debugLog, `[WRITE] ${new Date().toISOString()} len=${dataBuf.length} | ${stack}\n`); } catch(_){}
      } catch (_) {}
    }
    return _orig.call(this, filePath, data, encoding);
  };
  require('fs')._pyagentChatDedup = DEDUP_VERSION;
  // Write install marker to verify hot-reload occurred
  try { _orig.call(null, _debugLog, `[INSTALLED] ${DEDUP_VERSION} at ${new Date().toISOString()}\n`, 'utf8'); } catch(_){}
})();

// ─── 聊天持久化 ────────────────────────────────────────────────────────────────
const CHAT_DIR = path.join(__dirname, '..', 'docs', 'agent', 'chat');
fs.mkdirSync(CHAT_DIR, { recursive: true });

function getPyChatPath(sessionId) {
  const base = sessionId && sessionId.endsWith('.md') ? sessionId : (sessionId || 'pyagent') + '.md';
  return path.join(CHAT_DIR, base);
}

function persistPyChat(sessionId, role, text) {
  if (!sessionId || !text) return;
  try {
    const chatPath = getPyChatPath(sessionId);
    let line;
    if (role === 'user') {
      const clean = String(text).replace(/\n/g, '\n> ');
      line = `\n> 💬 **[用户留言]**\n>\n> ${clean}\n\n`;
    } else {
      line = String(text);
    }
    fs.appendFileSync(chatPath, line, 'utf-8');
  } catch (_) {}
}

// ─── 自动启动 PyAgent 服务 ────────────────────────────────────────────────────
const PYAGENT_SERVER_SCRIPT = path.join(__dirname, '..', 'pyagent_server.js');
let _launching = false;   // 防止并发重复启动
let _pyagentProc = null;  // 持有子进程引用（hot-reload 安全）

function launchPyAgentService() {
  return new Promise((resolve) => {
    if (_launching) {
      // 正在启动中，等待一段时间后直接 resolve
      setTimeout(resolve, 3000);
      return;
    }
    _launching = true;

    const child = spawn(process.execPath, [PYAGENT_SERVER_SCRIPT], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...process.env },
    });
    child.unref();  // 不阻止 Node 主进程退出
    _pyagentProc = child;
    console.log(`[PyAgent] 已启动服务进程 PID=${child.pid}`);

    // 等待服务就绪（最多 8 秒，每 500ms 轮询一次）
    let waited = 0;
    const MAX_WAIT = 8000;
    const POLL_INTERVAL = 500;

    const tryConnect = () => {
      const sock = new net.Socket();
      sock.setTimeout(400);
      sock.connect(PYAGENT_PORT, PYAGENT_HOST, () => {
        sock.destroy();
        _launching = false;
        resolve();
      });
      sock.on('error', () => {
        sock.destroy();
        waited += POLL_INTERVAL;
        if (waited >= MAX_WAIT) {
          _launching = false;
          resolve();  // 超时也 resolve，让上层处理错误
        } else {
          setTimeout(tryConnect, POLL_INTERVAL);
        }
      });
      sock.on('timeout', () => { sock.destroy(); });
    };

    setTimeout(tryConnect, 600);  // 等 600ms 再开始轮询（进程启动需要时间）
  });
}

// ─── SSE 客户端管理 ───────────────────────────────────────────────────────────
// 维护订阅了 /pyagent/stream 的 SSE 响应对象
const sseClients = new Set();

function broadcastToSSE(obj) {
  const payload = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch (_) { sseClients.delete(res); }
  }
}
// 挂载到 process 全局，供 routes/agent.js 等其他模块调用（热重载安全）
process._pyagentBroadcastToSSE = broadcastToSSE;

// ─── PyAgent 持久 Socket 连接（用于接收广播） ─────────────────────────────────
let _broadcastConn   = null;
let _broadcastBuf    = '';
let _reconnectTimer  = null;

// 热重载时销毁上一个模块实例遗留的旧 socket（利用 process 全局存储跨模块引用）
if (process._pyagentBroadcastConn) {
  try { process._pyagentBroadcastConn.destroy(); } catch (_) {}
  process._pyagentBroadcastConn = null;
}

function connectBroadcastSocket() {
  if (_broadcastConn) return;

  const sock = new net.Socket();
  sock.setTimeout(0);

  sock.connect(PYAGENT_PORT, PYAGENT_HOST, () => {
    console.log('[PyAgent] 广播 Socket 已连接');
    _broadcastConn = sock;
    process._pyagentBroadcastConn = sock;  // 跨模块实例共享引用，供下次热重载销毁
    _broadcastBuf  = '';
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
    // 告知 pyagent_server 这是广播接收 socket，让其关闭旧的（热重载时清理僵尸连接）
    try { sock.write(JSON.stringify({ action: 'register_broadcast' }) + '\n'); } catch (_) {}
  });

  sock.on('data', (chunk) => {
    _broadcastBuf += chunk.toString('utf8');
    let nl;
    while ((nl = _broadcastBuf.indexOf('\n')) !== -1) {
      const line = _broadcastBuf.slice(0, nl).trim();
      _broadcastBuf = _broadcastBuf.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        // 将 PyAgent 推送的消息转发到所有 SSE 客户端
        if (msg.type === 'agent_output' || msg.type === 'status' ||
            msg.type === 'process_launched' || msg.type === 'agent_launched') {
          broadcastToSSE(msg);
        }
      } catch (_) {}
    }
  });

  sock.on('error', (err) => {
    console.warn(`[PyAgent] 广播 Socket 错误: ${err.message}`);
  });

  sock.on('close', () => {
    _broadcastConn = null;
    if (process._pyagentBroadcastConn === sock) process._pyagentBroadcastConn = null;
    console.log('[PyAgent] 广播 Socket 已断开，10s 后重连...');
    _reconnectTimer = setTimeout(connectBroadcastSocket, 10000);
  });
}

// 模块加载时尝试建立广播连接
connectBroadcastSocket();

// ─── 辅助：HTTP 转发到远程 PyAgent（host:port）─────────────────────────────
function remoteRequest(ip, routePath, body) {
  return new Promise((resolve, reject) => {
    const [host, portStr] = ip.split(':');
    const port = parseInt(portStr, 10) || 80;
    const payload = JSON.stringify(body);
    const options = {
      host, port, path: routePath, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 10000,
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve({ success: true }); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('远程请求超时')); });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ─── 辅助：发送一次性请求到 PyAgent，返回 Promise<response> ─────────────────

function pyAgentRequest(action, params = {}) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    let buf = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        sock.destroy();
        reject(new Error('PyAgent 请求超时'));
      }
    }, CONNECT_TIMEOUT);

    sock.connect(PYAGENT_PORT, PYAGENT_HOST, () => {
      const msg = JSON.stringify({ action, params }) + '\n';
      sock.write(msg, 'utf8');
    });

    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl !== -1) {
        const line = buf.slice(0, nl).trim();
        if (!settled && line) {
          settled = true;
          clearTimeout(timeout);
          sock.destroy();
          try {
            resolve(JSON.parse(line));
          } catch (e) {
            reject(new Error(`PyAgent 响应解析失败: ${line}`));
          }
        }
      }
    });

    sock.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`无法连接 PyAgent (${PYAGENT_HOST}:${PYAGENT_PORT}): ${err.message}`));
      }
    });

    sock.on('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error('PyAgent 连接意外关闭'));
      }
    });
  });
}

// ─── 路由定义 ─────────────────────────────────────────────────────────────────

/**
 * POST /pyagent/launch
 * 手动拉起 PyAgent 服务（前端也可调用）
 */
router.post('/launch', async (req, res) => {
  try {
    // 先检查是否已在运行
    const aliveCheck = await pyAgentRequest('ping').catch(() => null);
    if (aliveCheck && aliveCheck.type === 'pong') {
      return res.json({ success: true, message: 'PyAgent 服务已在运行', launched: false });
    }
    await launchPyAgentService();
    // 启动后再 ping 一次确认
    const confirmCheck = await pyAgentRequest('ping').catch(() => null);
    if (confirmCheck && confirmCheck.type === 'pong') {
      // 重连广播 socket
      connectBroadcastSocket();
      return res.json({ success: true, message: 'PyAgent 服务已成功启动', launched: true });
    }
    return res.status(503).json({ success: false, message: 'PyAgent 服务启动超时，请手动运行 node pyagent_server.js' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /pyagent/health
 * 检查 PyAgent 是否在线，不需要 PyAgent 响应即可判断
 */
router.get('/health', async (req, res) => {
  try {
    const resp = await pyAgentRequest('ping');
    res.json({ online: resp.type === 'pong', host: PYAGENT_HOST, port: PYAGENT_PORT });
  } catch (err) {
    res.status(503).json({ online: false, error: err.message });
  }
});

/**
 * GET /pyagent/status?sessionId=default
 * 查询 CopilotCliAgent 状态（经由 PyAgent 转发）
 */
router.get('/status', async (req, res) => {
  const sessionId = req.query.sessionId || 'default';
  try {
    const resp = await pyAgentRequest('status', { sessionId });
    res.json(resp);
  } catch (err) {
    res.status(503).json({ type: 'error', error: err.message });
  }
});

/**
 * POST /pyagent/start
 * 启动 agent 任务；若 PyAgent 服务未运行则自动拉起
 * Body: { task, model, sessionId, ... }
 */
router.post('/start', async (req, res) => {
  const params = req.body || {};
  if (!params.task) {
    return res.status(400).json({ error: 'task 字段不能为空' });
  }
  // 若 body 包含 ip 字段，转发到远程 PyAgent（绕过本地 TCP）
  if (params.ip) {
    try {
      const resp = await remoteRequest(params.ip, '/pyagent/start', params);
      return res.json(resp);
    } catch (err) {
      return res.status(503).json({ type: 'error', error: `远程 PyAgent 连接失败(${params.ip}): ${err.message}` });
    }
  }
  try {
    const resp = await pyAgentRequest('start', params);
    // 持久化用户任务到聊天文件
    if (params.sessionId && params.task) {
      persistPyChat(params.sessionId, 'user', params.task);
    }
    res.json(resp);
  } catch (err) {
    // 若连接被拒绝，自动拉起 PyAgent 服务后重试一次
    const isConnRefused = err.message && (
      err.message.includes('ECONNREFUSED') ||
      err.message.includes('无法连接') ||
      err.message.includes('connect')
    );
    if (!isConnRefused) {
      return res.status(503).json({ type: 'error', error: err.message });
    }
    try {
      console.log('[PyAgent] 连接失败，正在自动启动 PyAgent 服务...');
      await launchPyAgentService();
      connectBroadcastSocket();
      const resp2 = await pyAgentRequest('start', params);
      // 持久化用户任务到聊天文件（重试成功路径）
      if (params.sessionId && params.task) {
        persistPyChat(params.sessionId, 'user', params.task);
      }
      res.json(resp2);
    } catch (err2) {
      res.status(503).json({ type: 'error', error: `PyAgent 服务启动失败: ${err2.message}` });
    }
  }
});

/**
 * POST /pyagent/stop
 * 停止 agent
 * Body: { sessionId }
 */
router.post('/stop', async (req, res) => {
  const params = req.body || {};
  // 若 body 包含 ip，转发到远程；即使失败也返回 success（进程可能已不存在）
  if (params.ip) {
    try {
      const resp = await remoteRequest(params.ip, '/pyagent/stop', params);
      return res.json(resp);
    } catch (_) {
      return res.json({ success: true, message: '远程进程已不存在或已停止' });
    }
  }
  try {
    const resp = await pyAgentRequest('stop', params);
    res.json(resp);
  } catch (err) {
    // 本地进程不存在也视为成功
    res.json({ success: true, message: '进程已不存在: ' + err.message });
  }
});

// ─── PyAgent 留言队列（waitprocess / hasprocess） ─────────────────────────────
function getPyQueueDirs(sessionId) {
  const dirName = (sessionId || 'default').replace(/\.md$/i, '');
  const base    = path.join(CHAT_DIR, dirName);
  const waitDir = path.join(base, 'waitprocess');
  const doneDir = path.join(base, 'hasprocess');
  fs.mkdirSync(waitDir, { recursive: true });
  fs.mkdirSync(doneDir, { recursive: true });
  return { waitDir, doneDir };
}

function makePyQueueFilename() {
  const ts  = new Date().toISOString().replace(/[:.]/g, '-');
  const rnd = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${ts}-${rnd}.md`;
}

/**
 * POST /pyagent/input
 * 向 PyAgent 发送留言（写入 waitprocess/ 队列）
 * Body: { sessionId, text }
 */
router.post('/input', async (req, res) => {
  const sessionId = String(req.body.sessionId || 'default');
  const text      = String(req.body.text || '').trim();
  if (!text) return res.json({ success: false, error: 'empty text' });

  let savedTo = '';
  try {
    const { waitDir } = getPyQueueDirs(sessionId);
    const fname   = makePyQueueFilename();
    const dateStr = new Date().toLocaleString('zh-CN', { hour12: false });
    const doc     = `# 用户留言\n\n**时间**: ${dateStr}  \n**会话**: ${sessionId}\n\n---\n\n${text}`;
    fs.writeFileSync(path.join(waitDir, fname), doc, 'utf-8');
    const dirName = sessionId.replace(/\.md$/i, '');
    savedTo = `agent/chat/${dirName}/waitprocess/${fname}`;
  } catch (e) {
    return res.json({ success: false, error: e.message });
  }

  // 同步写入聊天持久化文件
  persistPyChat(sessionId, 'user', text);

  // 立即发一条回执：消息已进入队列
  const now = new Date().toLocaleString('zh-CN', { hour12: false });
  const chatPath = getPyChatPath(sessionId);
  try { fs.appendFileSync(chatPath, `\n📨 **[${now}] 消息已入队 → CopilotCLI 正在读取...**\n\n`, 'utf-8'); } catch (_) {}

  res.json({ success: true, savedTo });
});

/**
 * GET /pyagent/input
 * 读取并出队最旧的留言（供 PyAgent POLL 脚本轮询）
 * Query: sessionId
 * 响应: { success, hasContent, content, remaining, source }
 */
router.get('/input', (req, res) => {
  const sessionId = String(req.query.sessionId || 'default');
  try {
    const { waitDir, doneDir } = getPyQueueDirs(sessionId);
    const files = fs.readdirSync(waitDir).filter(f => f.endsWith('.md')).sort();
    if (files.length === 0) {
      return res.json({ success: true, hasContent: false, content: '', remaining: 0 });
    }
    const oldest  = files[0];
    const srcPath = path.join(waitDir, oldest);
    const dstPath = path.join(doneDir, oldest);
    const content = fs.readFileSync(srcPath, 'utf-8');
    fs.renameSync(srcPath, dstPath);
    return res.json({ success: true, hasContent: true, content, remaining: files.length - 1, source: oldest });
  } catch (err) {
    return res.json({ success: false, hasContent: false, content: '', error: err.message });
  }
});

/**
 * POST /pyagent/continue
 * 继续等待中的 agent
 * Body: { sessionId, input }
 */
router.post('/continue', async (req, res) => {
  const params = req.body || {};
  try {
    const resp = await pyAgentRequest('continue', params);
    // 持久化用户输入到聊天文件
    if (params.sessionId && params.input) {
      persistPyChat(params.sessionId, 'user', params.input);
      // 立即发一条回执：消息已进入 CopilotCLI 队列
      const now = new Date().toLocaleString('zh-CN', { hour12: false });
      const chatPath = getPyChatPath(params.sessionId);
      try { fs.appendFileSync(chatPath, `\n📨 **[${now}] 消息已入队 → CopilotCLI 正在读取...**\n\n`, 'utf-8'); } catch (_) {}
    }
    res.json(resp);
  } catch (err) {
    res.status(503).json({ type: 'error', error: err.message });
  }
});

/**
 * POST /pyagent/subscribe
 * 通知 PyAgent 订阅指定 sessionId 的 SSE 流
 * Body: { sessionId }
 */
router.post('/subscribe', async (req, res) => {
  const params = req.body || {};
  try {
    const resp = await pyAgentRequest('subscribe', params);
    res.json(resp);
  } catch (err) {
    res.status(503).json({ type: 'error', error: err.message });
  }
});

/**
 * GET /pyagent/stream
 * SSE 端点：客户端订阅后实时接收 PyAgent 广播的 agent 输出
 * 支持 ?sessionId=... 过滤（预留，目前接收所有广播）
 */
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // 发送初始连接确认
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'PyAgent SSE 已连接' })}\n\n`);

  sseClients.add(res);

  // 确保广播 Socket 已连接
  connectBroadcastSocket();

  // 订阅 PyAgent（让 PyAgent 开始推送该 sessionId 的流）
  const sessionId = req.query.sessionId || 'default';
  pyAgentRequest('subscribe', { sessionId }).catch(() => {});

  // 保持心跳
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (_) {}
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// 热重载清理：关闭持久广播 socket，防止旧模块实例的 handler 继续写 chat 文件
router.cleanup = function () {
  if (_broadcastConn) {
    try { _broadcastConn.destroy(); } catch (_) {}
    _broadcastConn = null;
  }
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
};

// Debug endpoint: verify hot-reload and dedup patch version
router.get('/debug-dedup', (req, res) => {
  res.json({
    dedupVersion: require('fs')._pyagentChatDedup || 'not-installed',
    hasOrigAppend: !!require('fs')._pyagentOrigAppend,
    moduleLoadTime: new Date().toISOString(),
  });
});

module.exports = router;


// touch 17:30:25
