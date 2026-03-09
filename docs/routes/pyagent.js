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
const path    = require('path');
const { spawn } = require('child_process');

const router = express.Router();

const PYAGENT_HOST    = '127.0.0.1';
const PYAGENT_PORT    = 7441;
const CONNECT_TIMEOUT = 5000;  // ms

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

// ─── PyAgent 持久 Socket 连接（用于接收广播） ─────────────────────────────────
let _broadcastConn   = null;
let _broadcastBuf    = '';
let _reconnectTimer  = null;

function connectBroadcastSocket() {
  if (_broadcastConn) return;

  const sock = new net.Socket();
  sock.setTimeout(0);

  sock.connect(PYAGENT_PORT, PYAGENT_HOST, () => {
    console.log('[PyAgent] 广播 Socket 已连接');
    _broadcastConn = sock;
    _broadcastBuf  = '';
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
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
        // 将 PyAgent 推送的 agent_output 转发到所有 SSE 客户端
        if (msg.type === 'agent_output' || msg.type === 'status') {
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
    console.log('[PyAgent] 广播 Socket 已断开，10s 后重连...');
    _reconnectTimer = setTimeout(connectBroadcastSocket, 10000);
  });
}

// 模块加载时尝试建立广播连接
connectBroadcastSocket();

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
  try {
    const resp = await pyAgentRequest('start', params);
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
  try {
    const resp = await pyAgentRequest('stop', params);
    res.json(resp);
  } catch (err) {
    res.status(503).json({ type: 'error', error: err.message });
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

module.exports = router;
