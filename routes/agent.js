/**
 * CopilotCli Agent 路由
 * 挂载路径: /agent
 *
 * 基于 @github/copilot CLI 的 autopilot 模式，
 * 通过 SSE 实时流式输出 Agent 执行结果。
 *
 * 关键参数（来自 CopilotCli 使用指南）：
 *   --no-alt-screen   必须！禁用终端交替屏幕，才能在 pipe 模式输出
 *   --autopilot       自主 Agent 模式
 *   --yolo            允许所有工具/路径/URL
 *   --no-ask-user     非交互，自主决策
 *   --no-color        去掉 ANSI 颜色码
 */

const express = require('express');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');
const fs = require('fs');
const path = require('path');
const os = require('os');

const router = express.Router();
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const DATA_DIR = path.join(__dirname, '..', 'data');
const HIST_FILE = path.join(DATA_DIR, 'agent-history.md');
const HISTORY_DIR = path.join(DOCS_DIR, 'history');  // 会话历史文档目录
const RUNTIME_DIR = path.join(__dirname, '..', 'runtime'); // 运行时氚临文件目录

// Windows 命令行长度上限约 32767 字节，留足够安全边距
const MAX_CMD_CHARS = 20000;

// ── 递归收集所有 .md 文件 ─────────────────────────────────
function collectAllFiles(dir, base = '') {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectAllFiles(abs, rel));
    } else if (entry.name.endsWith('.md')) {
      results.push({ rel, abs });
    }
  }
  return results;
}

// ── 会话状态 Map ─────────────────────────────────────────
// 每个 sessionId 对应一个独立的 Agent 状态
// 使用 global 持久化，防止 hot-reload 时 sessions 被重置导致活跃会话丢失
if (!global.__agentSessions) global.__agentSessions = new Map();
const sessions = global.__agentSessions;

function createSessionState() {
  return {
    agentProcess:      null,
    agentStatus:       'idle',  // idle | running | waiting | done | error
    pendingDone:       null,    // { code, elapsed, task }
    agentClients:      new Set(),
    agentBuffer:       [],      // SSE replay buffer
    agentHistory:      [],      // 内存任务历史（最近 30 条）
    currentTask:       null,
    currentAction:     null,    // 当前正在执行的动作标签（来自 agent-action 事件）
    startTime:         null,
    heartbeatTimer:    null,
    outputAccum:       '',
    hideTrace:         false,   // 是否过滤 CLI 工具日志行
    historyDocAbsPath: null,    // 当前运行任务的历史文档路径（用于写入用户留言）
    historyDocRel:     null,
    lastLaunchParams:  null,    // 上次启动时的完整参数（供 /relaunch 使用）
    pendingRelaunch:   null,    // 当前进程结束后自动重新启动的参数（由 /relaunch 设置）
  };
}

function getSession(id) {
  const sid = String(id || 'default');
  if (!sessions.has(sid)) sessions.set(sid, createSessionState());
  return sessions.get(sid);
}

// 全局进程（非会话级）
let authProcess = null;      // GitHub 认证进程
let installProcess = null;   // npm 安装进程

// ── 检测 Copilot CLI 入口 ─────────────────────────────────
let _copilotCmdCache = null;
function detectCopilotCmd() {
  if (_copilotCmdCache) return _copilotCmdCache;
  // 1. 用户自定义环境变量
  if (process.env.COPILOT_CMD) {
    return (_copilotCmdCache = { cmd: process.env.COPILOT_CMD, args: [], shell: false });
  }
  // 2. node-script 模式（最稳定，无 cmd.exe 长度限制）—— 搜索多个可能路径
  const npmRoots = [
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules'),
    path.join(os.homedir(), 'AppData', 'Local', 'npm', 'node_modules'),
    path.join(os.homedir(), '.nvm', 'versions', 'node', process.version, 'lib', 'node_modules'),
    '/usr/local/lib/node_modules',
    '/usr/lib/node_modules',
  ];
  // 也尝试从环境变量 npm_config_prefix 推断
  if (process.env.npm_config_prefix) {
    npmRoots.unshift(path.join(process.env.npm_config_prefix, 'node_modules'));
  }
  // 尝试从 npm 全局前缀推断（同步 execFileSync 探测一次）
  try {
    const { execFileSync } = require('child_process');
    const npmPrefix = execFileSync('npm', ['root', '-g'], { timeout: 3000, encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' }).trim();
    if (npmPrefix) npmRoots.unshift(npmPrefix);
  } catch (_) {}

  for (const root of npmRoots) {
    const candidate = path.join(root, '@github', 'copilot', 'npm-loader.js');
    if (fs.existsSync(candidate)) {
      return (_copilotCmdCache = { cmd: process.execPath, args: [candidate], shell: false });
    }
  }
  // 3. 直接调用 copilot / copilot.cmd —— Windows .cmd 需要 shell:true
  const isCmdFile = process.platform === 'win32';
  return (_copilotCmdCache = {
    cmd: isCmdFile ? 'copilot.cmd' : 'copilot',
    args: [],
    shell: isCmdFile,
  });
}

// ── 快速检测 CLI 是否可用（Promise） ────────────────────────
function checkCliAvailable() {
  return new Promise((resolve) => {
    const { cmd, args, shell } = detectCopilotCmd();
    const probe = spawn(cmd, [...args, '--version'], {
      timeout: 5000, windowsHide: true, shell,
    });
    probe.on('close', (code) => resolve({ available: code === 0, cmd }));
    probe.on('error', (err) => resolve({ available: false, cmd, error: err.message }));
  });
}

// ── SSE 广播 ──────────────────────────────────────────────
function broadcast(sessionId, event, data) {
  const sess = getSession(sessionId);
  // Persist current action so /agent/status can return it
  if (event === 'agent-action') {
    sess.currentAction = (data && data.type && data.type !== 'idle') ? data : null;
  }
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sess.agentBuffer.push({ event, data });
  if (sess.agentBuffer.length > 500) sess.agentBuffer.shift();
  sess.agentClients.forEach(res => {
    if (res.writableEnded) { sess.agentClients.delete(res); return; }
    try {
      res.write(payload);
    } catch (_) {
      sess.agentClients.delete(res);
    }
  });
}

// 向所有会话的所有连接广播（用于全局事件如 auth/install）
function broadcastGlobal(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sessions.forEach(sess => {
    sess.agentClients.forEach(res => {
      if (!res.writableEnded) res.write(payload);
    });
  });
  // 若尚无任何会话连接，至少保证 'default' 收到
  if (!sessions.size) {
    const sess = getSession('default');
    sess.agentBuffer.push({ event, data });
  }
}

// ── 读取全局配置（docs/global_config.json，向下兼容旧的 global_config.md）──
function readGlobalConfig() {
  try {
    // 优先读取 JSON 文件
    const jsonPath = path.join(DOCS_DIR, 'global_config.json');
    if (fs.existsSync(jsonPath)) {
      return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    }
    // 向下兼容：从 Markdown 文件中提取 JSON 代码块
    const mdPath = path.join(DOCS_DIR, 'global_config.md');
    if (fs.existsSync(mdPath)) {
      const content = fs.readFileSync(mdPath, 'utf-8');
      const m = content.match(/```json\s*([\s\S]*?)```/);
      if (m) return JSON.parse(m[1]);
    }
  } catch (_) {}
  return {};
}

// ── 构建代理环境变量 ──────────────────────────────────────
function buildEnv() {
  const env = { ...process.env };
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) {
    if (process.env[k]) env[k] = process.env[k];
  }
  // 读取全局配置中的代理设置（每次动态读取，修改 global_config.json 立即生效）
  const cfg = readGlobalConfig();
  const useProxy    = cfg.use_proxy  !== false;  // 默认 true
  const proxyHost   = cfg.proxy_host || '127.0.0.1';
  const proxyPort   = cfg.proxy_port || 7890;
  if (!useProxy) {
    // 禁用代理：显式删除所有代理相关变量（含从父进程继承的）
    for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'CLASH_PROXY']) {
      delete env[k];
    }
  } else if (!env.HTTPS_PROXY && !env.HTTP_PROXY) {
    // 启用代理：优先使用环境变量 CLASH_PROXY，其次用 global_config.json 中的设置
    const proxyUrl = process.env.CLASH_PROXY || `http://${proxyHost}:${proxyPort}`;
    env.HTTPS_PROXY = proxyUrl;
    env.HTTP_PROXY  = proxyUrl;
  }
  // 本地地址绕过代理 —— 必须！否则 web_fetch 打 localhost 会走代理失败
  env.NO_PROXY = 'localhost,127.0.0.1,::1,0.0.0.0';
  env.no_proxy = env.NO_PROXY;
  // 强刻 TUI 输出、强制 UTF-8
  env.NO_COLOR    = '1';
  env.FORCE_COLOR = '0';
  env.TERM        = 'dumb';
  env.LANG        = 'en_US.UTF-8';
  env.LC_ALL      = 'en_US.UTF-8';
  env.PYTHONIOENCODING = 'utf-8';
  env.PYTHONUTF8       = '1';
  // 将 tools/pwsh7/ 和 tools/ 注入 PATH 最前面
  // pwsh7/ 提供真实的 pwsh.exe（CLI 会明确调用 .exe）
  // tools/ 提供 pwsh.cmd shim 及其他工具
  const toolsDir  = path.join(__dirname, '..', 'tools');
  const pwsh7Dir  = path.join(toolsDir, 'pwsh7');
  const pathSep   = process.platform === 'win32' ? ';' : ':';
  env.PATH = pwsh7Dir + pathSep + toolsDir + pathSep + (env.PATH || '');
  return env;
}

// ── ANSI / 控制码剥离 ───────────────────────────────────
// 覆盖: CSI序列、OSC序列、DCS/PM/APC序列、单字符ESC序列（含 \x1b7 \x1b8 等）
// eslint-disable-next-line no-control-regex
const ANSI_RE = /(?:\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[PX^_][^\x1b]*\x1b\\|\x1b.|\x9b[0-9;]*[a-zA-Z])/g;
// 残留控制字符：NUL BEL BS FF SI SO DEL 等（保留 HT=\x09 LF=\x0a）
// eslint-disable-next-line no-control-regex
const CTRL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x80-\x9f]/g;

/**
 * 全面清理 CLI 输出：
 *  1. 剩除 ANSI 转义序列（包括光标移动、清屏、标题条设置等）
 *  2. 剥除残留控制字符
 *  3. 统一换行符
 *  4. 移除 UTF-8 解码失败产生的替代字符（\uFFFD）
 */
function cleanOutput(str) {
  return str
    .replace(ANSI_RE, '')
    .replace(CTRL_RE, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\uFFFD+/g, '');  // UTF-8 换行失败的垂测字符
}

/**
 * 过滤 Copilot CLI 工具执行日志行（● ✗ └ $ 等），只保留 LLM 生成的自然语言文字。
 * 使用行级匹配，适合对每个 stdout chunk 逐步调用。
 */
function filterCliTrace(text) {
  const lines = text.split('\n');
  const out = [];
  let inToolBlock = false;  // 在 ● 工具块内，等待 └ 结束
  let inCmdCont  = false;   // 在 $ shell 命令续行内

  for (const line of lines) {
    // 工具调用头行: ● / ✗
    if (/^[●✗] /.test(line)) { inToolBlock = true; inCmdCont = false; continue; }
    // 结果摘要行: └ → 结束工具块
    if (/^\s+└ /.test(line)) { inToolBlock = false; inCmdCont = false; continue; }
    // shell 命令行: 开始命令续行模式
    if (/^  [$]/.test(line)) { inCmdCont = true; continue; }
    // 错误详情行
    if (/^  Error:/.test(line)) { continue; }
    // 截断省略号
    if (/^  \.\.\.$/.test(line)) { inToolBlock = false; continue; }

    if (inToolBlock) {
      // 工具块内的续行：括号包裹的路径参数 / 缩进行
      if (/^\s*\(.*\)\s*$/.test(line)) continue;  // (filepath) 参数行
      if (/^\s+/.test(line)) continue;             // 缩进续行
      // 遇到非缩进非空行 → 工具块意外结束，输出该行
      if (line.trim() !== '') inToolBlock = false;
    }

    if (inCmdCont) {
      // 命令续行：-Flag 或缩进行属于命令的一部分
      if (/^\s*-/.test(line)) continue;   // -AutoSize 等 flag 续行
      if (/^\s+/.test(line)) continue;    // 缩进续行
      inCmdCont = false;                  // 其他行 → 命令结束
    }

    out.push(line);
  }
  return out.join('\n');
}

// ── historyDoc 写入过滤：去除纯 ANSI/控制字符行，压缩多余空行，保留所有有意义内容 ──
function filterForHistoryDoc(text) {
  const lines = text.split('\n');
  const kept = lines.filter(line => {
    // Remove lines that are purely ANSI escape sequences or empty control chars
    const stripped = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
    // Drop lines that become empty after stripping control chars
    if (!stripped) return line.trim() === '';  // keep truly blank lines for structure
    return true;
  });
  // Compress 3+ consecutive empty lines to 2
  return kept.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ── 状态行解析 ───────────────────────────────────────────────
// Copilot CLI autopilot 输出特征：
//   ● Tool description   → 正在执行工具
//   ✗ Tool description   → 工具失败
//   ✔ / ✓               → 工具成功
//   Task: desc          → 正在运行子任务
//   长时间无输出       → 正在思考
const ACTION_PATTERNS = [
  { re: /^[●•]\s+(.+)$/,         type: 'tool',    label: (m) => `⚙️ ${m[1].trim().slice(0, 70)}` },
  { re: /^\u2717\s+(.+)$/,               type: 'failed',  label: (m) => `✗ 失败: ${m[1].trim().slice(0, 60)}` },
  { re: /^[✔✓]\s+(.+)$/,        type: 'success', label: (m) => `✓ ${m[1].trim().slice(0, 70)}` },
  { re: /^Task:\s+(.+)$/i,               type: 'task',    label: (m) => `📋 ${m[1].trim().slice(0, 60)}` },
  { re: /Thinking[.…]+/i,              type: 'think',   label: ()  => '💭 思考中…' },
  { re: /Waiting|waiting for/i,           type: 'wait',    label: ()  => '⏳ 等待响应…' },
  { re: /Permission|confirm|Allow/i,      type: 'perm',    label: ()  => '🔐 需要权限确认' },
];

function detectAction(line) {
  const t = line.trim();
  if (!t || t.startsWith('  ') || t.startsWith('\u2514')) return null;
  for (const p of ACTION_PATTERNS) {
    const m = t.match(p.re);
    if (m) return { type: p.type, label: p.label(m) };
  }
  return null;
}

// ── 支持的模型列表 ────────────────────────────────────────
const MODEL_LIST = [
  { id: '',                    label: '默认模型',           maxTokens: 64000 },
  { id: 'gpt-4.1',             label: 'GPT-4.1',            maxTokens: 1047576 },
  { id: 'claude-sonnet-4.6',   label: 'Claude Sonnet 4.6',  maxTokens: 200000 },
  { id: 'claude-opus-4.6',     label: 'Claude Opus 4.6',    maxTokens: 200000 },
  { id: 'claude-haiku-4.5',    label: 'Claude Haiku 4.5',   maxTokens: 200000 },
  { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro',      maxTokens: 1000000 },
];

/* ─────────────────────────────────────────────────────────
   GET /agent/models  —— 返回模型列表
───────────────────────────────────────────────────────── */
router.get('/models', (_req, res) => res.json({ models: MODEL_LIST }));

/* ─────────────────────────────────────────────────────────
   GET /agent/stream  —— SSE 实时流
   新连接自动 replay 已缓存的历史输出
───────────────────────────────────────────────────────── */
router.get('/stream', (req, res) => {
  const sessionId = String(req.query.sessionId || 'default');
  const noReplay  = req.query.noReplay === '1';
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sess = getSession(sessionId);
  // 给新连接 replay 缓存（切换会话时传 noReplay=1 跳过）
  if (!noReplay) {
    sess.agentBuffer.forEach(({ event, data }) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    });
  }

  sess.agentClients.add(res);
  req.on('close', () => sess.agentClients.delete(res));
});

/* ─────────────────────────────────────────────────────────
   POST /agent/start  —— 启动 Agent 任务

   Body (JSON):
     task          {string}  必填 — 任务描述
     maxContinues  {number}  可选 — 最大自主继续次数，默认 10
     saveAs        {string}          可选 — 完成后自动保存为文档路径
                                             如 "output/result" 或 "summary.md"
     useHistory    {boolean}         可选 — 是否注入历史上下文，默认 true
     systemDoc     {string}          可选 — 单个系统设定文档路径（兼容旧格式）
     systemDocs    {string|string[]} 可选 — 一个或多个系统设定文档路径
                                             如 ["roles/主角.md", "world/世界观.md"]
───────────────────────────────────────────────────────── */
router.post('/start', async (req, res) => {
  const { task, maxContinues = 10, saveAs, useHistory = true, hideTrace = false, systemDoc, systemDocs, model, historyDoc, taskPrefixDoc, sessionId: rawSessionId } = req.body;
  const sessionId = String(rawSessionId || 'default');
  const sess = getSession(sessionId);

  if (sess.agentStatus === 'running') {
    return res.status(409).json({ success: false, error: 'Agent 正在运行中，请先停止' });
  }
  // 进程已结束但仍在等待用户确认 → 自动放弃上次结果，允许直接开始新任务
  if (sess.agentStatus === 'waiting' && !sess.agentProcess) {
    sess.pendingDone = null;
    sess.agentStatus = 'idle';
    broadcast(sessionId, 'done', { code: -1, elapsed: 0, task: sess.currentTask || '' });
  }

  if (!task || !task.trim()) {
    return res.status(400).json({ success: false, error: 'task 为必填项' });
  }

  // ── 保存启动参数（供 /relaunch 端点复用）──────────────
  sess.lastLaunchParams = { task, maxContinues, saveAs, useHistory, hideTrace, systemDoc, systemDocs, model, historyDoc, taskPrefixDoc };

  // ── 预检：CLI 是否可用 ─────────────────────────────────
  const cli = await checkCliAvailable();
  if (!cli.available) {
    const errMsg = [
      `✗ Copilot CLI 未安装或无法运行 (${cli.cmd})`,
      ``,
      `请先安装 @github/copilot CLI：`,
      `  npm install -g @github/copilot`,
      ``,
      `安装后需要用 GitHub 账号认证：`,
      `  copilot auth`,
      ``,
      `若已安装但路径不标准，可设置环境变量再重启服务：`,
      `  $env:COPILOT_CMD = "C:\\path\\to\\copilot.cmd"`,
    ].join('\n');
    broadcast(sessionId, 'error', { message: errMsg });
    broadcast(sessionId, 'done', { code: 1, elapsed: 0, task, notInstalled: true });
    return res.status(503).json({
      success: false,
      notInstalled: true,
      error: `Copilot CLI 未安装 (${cli.cmd})，请运行: npm install -g @github/copilot`,
    });
  }

  // ── 预算常量（字符数，非 Token）────────────────────────
  const HIST_BUDGET    = 8000;  // 历史上下文最大注入量
  const SYSDOC_BUDGET  = 5000;  // 系统设定文档最大注入量（每个）
  const PREFIX_BUDGET  = 10000; // 任务前缀文档最大注入量

  // ── 注入会话历史文档（智能：优先压缩摘要，否则取末尾）──
  // 先合并任务前缀 + 用户输入，得到"当前指令块"，再套历史/系统设定
  let currentTask = task.trim();
  if (taskPrefixDoc) {
    const prefPath = path.join(DOCS_DIR, taskPrefixDoc);
    if (prefPath.startsWith(DOCS_DIR) && fs.existsSync(prefPath)) {
      let prefContent = fs.readFileSync(prefPath, 'utf-8');
      if (prefContent.length > PREFIX_BUDGET) {
        prefContent = prefContent.slice(0, PREFIX_BUDGET) + '\n[…已截断]';
      }
      // 若前缀以"现在执行任务："结尾（模板式前缀），直接拼接用户输入
      // 否则用换行隔开
      const trimmedPref = prefContent.trimEnd();
      if (trimmedPref.endsWith('现在执行任务：') || trimmedPref.endsWith('现在执行任务:')) {
        currentTask = trimmedPref + '\n' + currentTask;
      } else {
        currentTask = trimmedPref + '\n\n[用户任务]\n' + currentTask;
      }
    }
  }

  let fullPrompt = currentTask;
  let historyDocAbsPath = null;
  let historyDocRel = null;
  let histFileSize = 0;
  if (historyDoc) {
    const absHist = path.join(HISTORY_DIR, historyDoc);
    if (absHist.startsWith(HISTORY_DIR) && fs.existsSync(absHist)) {
      historyDocAbsPath = absHist;
      historyDocRel = historyDoc;
      sess.historyDocAbsPath = absHist;
      sess.historyDocRel = historyDoc;
      const histContent = fs.readFileSync(absHist, 'utf-8');
      histFileSize = histContent.length;

      let histInject = '';
      if (histFileSize <= HIST_BUDGET) {
        // 文件足够小，全量注入
        histInject = histContent;
      } else {
        // 优先提取所有「会话压缩记忆」章节（精炼摘要）
        // 按 "## " 标题分割，筛选压缩块
        const blocks = histContent
          .split(/^(?=## )/m)
          .filter(s => s.startsWith('## 会话压缩记忆'))
          .map(s => s.trim());
        if (blocks.length > 0) {
          // 从最近的压缩块开始，倒序拼接直到预算
          let accumulated = '';
          for (let i = blocks.length - 1; i >= 0; i--) {
            const candidate = blocks[i] + (accumulated ? '\n\n---\n\n' + accumulated : '');
            if (candidate.length > HIST_BUDGET) break;
            accumulated = candidate;
          }
          histInject = accumulated || blocks[blocks.length - 1].slice(-HIST_BUDGET);
          histInject += `\n\n> 💡 完整历史记录见文件 \`history/${historyDoc}\``;
        } else {
          // 无压缩块 → 取文件末尾 HIST_BUDGET 字符（最新内容最有价值）
          histInject = '[…早期记录已省略，以下为最新会话记录]\n' +
            histContent.slice(-HIST_BUDGET);
        }
      }
      fullPrompt = `[会话历史 — history/${historyDoc}]\n${histInject}\n\n[当前任务]\n${fullPrompt}`;
    }
  }

  // ── 注入系统设定/世界观（支持多个文档，每个限 SYSDOC_BUDGET 字符）──
  const sysDocs = [systemDocs ?? systemDoc].flat().filter(Boolean);
  if (sysDocs.length > 0) {
    const parts = [];
    for (const sd of sysDocs) {
      const sdPath = path.join(DOCS_DIR, sd);
      if (sdPath.startsWith(DOCS_DIR) && fs.existsSync(sdPath)) {
        let sdContent = fs.readFileSync(sdPath, 'utf-8');
        if (sdContent.length > SYSDOC_BUDGET) {
          sdContent = sdContent.slice(0, SYSDOC_BUDGET) + '\n[…已截断]';
        }
        parts.push(`[系统设定 — ${sd}]\n${sdContent}`);
      }
    }
    if (parts.length > 0) {
      fullPrompt = `${parts.join('\n\n---\n\n')}\n\n[任务]\n${fullPrompt}`;
    }
  }

  // ── 注入内存历史上下文（仅在无 historyDoc 时使用，避免双重注入）──
  if (useHistory && !historyDoc && sess.agentHistory.length > 0) {
    const recent = sess.agentHistory.slice(-3);
    const ctx = recent.map(h =>
      `任务：${h.task}\n输出摘要：${h.output.slice(0, 2000)}`
    ).join('\n---\n');
    fullPrompt = `[历史任务上下文]\n${ctx}\n\n[当前任务]\n${fullPrompt}`;
  }

  // ── 兜底：Prompt 仍超限则尾部保留（保护 currentTask 完整）────
  if (fullPrompt.length > MAX_CMD_CHARS) {
    const taskSection = `[当前任务]\n${currentTask}`;
    const prefixLen = MAX_CMD_CHARS - taskSection.length - 60;
    if (prefixLen > 0) {
      fullPrompt = fullPrompt.slice(0, prefixLen) + '\n[…上下文已裁剪]\n\n' + taskSection;
    } else {
      // currentTask 本身就超限，只截 currentTask
      fullPrompt = currentTask.slice(0, MAX_CMD_CHARS);
    }
  }

  // ── 会话隔离：非 default 会话使用独立的 user_input 文件 ─
  if (sessionId !== 'default') {
    const sessionInputFile = `user_input_${sessionId}`;
    fullPrompt = fullPrompt
      .replace(/runtime\\user_input\b/g, `runtime\\${sessionInputFile}`)
      .replace(/runtime\/user_input\b/g,  `runtime/${sessionInputFile}`);
  }

  const { cmd, args: baseArgs, shell } = detectCopilotCmd();
  const agentArgs = [
    ...baseArgs,
    '--no-alt-screen',                          // 关键！pipe 模式必须
    '--no-color',                               // 去掉 ANSI
    '--autopilot',                              // Agent 模式
    '--yolo',                                   // 允许所有操作
    '--max-autopilot-continues', String(maxContinues),
    '--no-ask-user',                            // 非交互
    ...(model ? ['--model', model] : []),       // 指定模型
    '-p', fullPrompt,
  ];

  // ── 重置当前会话状态 ────────────────────────────────────
  // 将已注入的 prompt 字符数设为 token 计数基线
  const promptChars = fullPrompt.length;
  const modelInfo = MODEL_LIST.find(m => m.id === (model || '')) || MODEL_LIST[0];
  sess.agentBuffer  = [];
  sess.agentStatus  = 'running';
  sess.currentTask  = task;
  sess.startTime    = Date.now();
  sess.outputAccum  = '';
  sess.hideTrace    = !!hideTrace;

  broadcast(sessionId, 'start', { task, time: new Date().toISOString(), tokenEst: Math.round(promptChars / 4), maxTokens: modelInfo.maxTokens });
  broadcast(sessionId, 'output', { text: '⏳ Copilot CLI 正在启动，首次运行需要认证，请稍候…\n', stream: 'stdout' });
  // ── 实时写入历史文档：先写会话头部 ─────────────────────
  let liveWriteTimer = null;
  let liveWriteBuf   = '';    // 待刷入文件的增量缓冲
  if (historyDocAbsPath) {
    try {
      const sessionNum = (() => {
        const existing = fs.readFileSync(historyDocAbsPath, 'utf-8');
        return (existing.match(/^## 会话 #/gm) || []).length + 1;
      })();
      const modelLabel = model || '默认模型';
      const header = [
        `## 会话 #${sessionNum} — ${new Date().toISOString()}`,
        `**任务**: ${task}`,
        `**模型**: ${modelLabel}  **开始**: ${new Date().toLocaleString('zh-CN')}`,
        ``,
        `### 输出`,
        ``,
      ].join('\n');
      fs.appendFileSync(historyDocAbsPath, header, 'utf-8');
      broadcast(sessionId, 'history-writing', { path: `history/${historyDocRel}` });

      // 每 3 秒将增量追加到文件（过滤非中文行，压缩空行）
      liveWriteTimer = setInterval(() => {
        if (!liveWriteBuf) return;
        try {
          const toWrite = filterForHistoryDoc(liveWriteBuf);
          if (toWrite.trim()) fs.appendFileSync(historyDocAbsPath, toWrite, 'utf-8');
        } catch (_) {}
        liveWriteBuf = '';
      }, 3000);
    } catch (e) {
      broadcast(sessionId, 'output', { text: `[历史文档头部写入失败] ${e.message}`, stream: 'stderr' });
    }
  }
  // ── 启动子进程 ──────────────────────────────────────────
  try {
    sess.agentProcess = spawn(cmd, agentArgs, {
      env: buildEnv(),
      windowsHide: true,
      shell,
    });
  } catch (err) {
    sess.agentStatus = 'error';
    clearInterval(liveWriteTimer);
    // ENAMETOOLONG: 直接超出系统限制
    // EPERM + shell:true: Windows cmd.exe 参数超过 8191 字符，系统拒绝创建进程
    const isTooLong = err.code === 'ENAMETOOLONG'
      || String(err.message).includes('ENAMETOOLONG')
      || (err.code === 'EPERM' && shell === true);
    const msg = isTooLong
      ? `启动失败: Prompt 超出 Windows cmd.exe 命令行长度限制（约 8191 字符）。\n\n当前注入内容过多（系统设定 + 历史文档 + 任务前缀同时使用）。\n\n解决方法之一：点击「重置上下文」清除历史记录后重试。\n解决方法之二：减少同时使用的系统设定或任务前缀文档数量。`
      : `启动失败: ${err.message}`;
    broadcast(sessionId, 'error', { message: msg, resetHint: isTooLong });
    broadcast(sessionId, 'done', { code: 1, elapsed: 0, task });
    return res.status(500).json({ success: false, error: msg, resetHint: isTooLong });
  }

  // StringDecoder 处理 UTF-8 分割（跨 chunk 的多字节字符）
  const stdoutDecoder = new StringDecoder('utf8');
  const stderrDecoder = new StringDecoder('utf8');

  sess.agentProcess.stdout.on('data', (chunk) => {
    const text = cleanOutput(stdoutDecoder.write(chunk));
    // 无论是否有可见文本，都更新 token 计数（ANSI 帧不产生可见文本但要保持计数更新）
    const tokenEst = Math.round((promptChars + sess.outputAccum.length) / 4);
    if (text) {
      sess.outputAccum += text;
      // 若开启「隐藏操作日志」，过滤后再广播和写文件
      const displayText = sess.hideTrace ? filterCliTrace(text) : text;
      liveWriteBuf  += displayText;
      broadcast(sessionId, 'output', { text: displayText, stream: 'stdout', tokenEst, maxTokens: modelInfo.maxTokens });
      for (const line of text.split('\n')) {
        const action = detectAction(line);
        if (action) broadcast(sessionId, 'agent-action', action);
      }
    } else {
      // 无可见文本（纯 ANSI 控制帧）：只发送 token 更新，不发送空文本
      broadcast(sessionId, 'token-update', { tokenEst, maxTokens: modelInfo.maxTokens });
    }
  });

  sess.agentProcess.stdout.on('end', () => {
    const tail = cleanOutput(stdoutDecoder.end());
    if (tail) {
      sess.outputAccum += tail;
      const displayTail = sess.hideTrace ? filterCliTrace(tail) : tail;
      liveWriteBuf += displayTail;
      const tokenEst = Math.round((promptChars + sess.outputAccum.length) / 4);
      broadcast(sessionId, 'output', { text: displayTail, stream: 'stdout', tokenEst, maxTokens: modelInfo.maxTokens });
    }
  });

  sess.agentProcess.stderr.on('data', (chunk) => {
    const text = cleanOutput(stderrDecoder.write(chunk));
    if (!text) return;
    broadcast(sessionId, 'output', { text, stream: 'stderr' });
    for (const line of text.split('\n')) {
      const action = detectAction(line);
      if (action) broadcast(sessionId, 'agent-action', action);
    }
  });

  sess.agentProcess.stderr.on('end', () => {
    const tail = cleanOutput(stderrDecoder.end());
    if (tail) broadcast(sessionId, 'output', { text: tail, stream: 'stderr' });
  });

  sess.agentProcess.on('error', (err) => {
    sess.agentStatus = 'error';
    broadcast(sessionId, 'error', { message: err.message });
  });

  sess.agentProcess.on('close', (code) => {
    clearInterval(sess.heartbeatTimer);
    clearInterval(liveWriteTimer);   // 停止实时写入定时器
    const elapsed = Math.floor((Date.now() - sess.startTime) / 1000);
    broadcast(sessionId, 'agent-action', { type: 'idle', label: '' }); // 清空状态栏

    // ── 记录历史 ────────────────────────────────────────
    // outputAccum 保留原始全量文本（用于 token 计数），写文件时按需过滤
    const outputForFile = sess.hideTrace ? filterCliTrace(sess.outputAccum) : sess.outputAccum;
    const entry = { task, output: outputForFile, code, elapsed, time: new Date().toISOString() };
    sess.agentHistory.push(entry);
    if (sess.agentHistory.length > 30) sess.agentHistory.shift();

    // ── 持久化历史到文件 ────────────────────────────────
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const line = `## #${sess.agentHistory.length} ${entry.time}\n**任务**: ${task}\n**耗时**: ${elapsed}s  **退出码**: ${code}\n\n\`\`\`\n${outputForFile.slice(0, 3000)}\n\`\`\`\n\n---\n\n`;
      fs.appendFileSync(HIST_FILE, line, 'utf-8');
    } catch (_) {}

    // ── 自动保存为文档 ──────────────────────────────────
    if (saveAs) {
      try {
        const rel = saveAs.endsWith('.md') ? saveAs : `${saveAs}.md`;
        const docPath = path.join(DOCS_DIR, rel);
        fs.mkdirSync(path.dirname(docPath), { recursive: true });
        const docContent = `# Agent 输出\n\n> **任务**: ${task}  \n> **时间**: ${entry.time}  \n> **耗时**: ${elapsed}s\n\n\`\`\`\n${outputForFile}\n\`\`\`\n`;
        fs.writeFileSync(docPath, docContent, 'utf-8');
        broadcast(sessionId, 'saved', { path: rel });
      } catch (err) {
        broadcast(sessionId, 'output', { text: `[保存失败] ${err.message}`, stream: 'stderr' });
      }
    }

    // ── 实时追加剩余内容 + 写入页脚到历史文档 ──────────
    if (historyDocAbsPath) {
      try {
        if (liveWriteBuf) {
          const toWrite = filterForHistoryDoc(liveWriteBuf);
          if (toWrite.trim()) fs.appendFileSync(historyDocAbsPath, toWrite, 'utf-8');
          liveWriteBuf = '';
        }
        const footer = `\n\n**耗时**: ${elapsed}s  **退出码**: ${code}\n\n---\n\n`;
        fs.appendFileSync(historyDocAbsPath, footer, 'utf-8');
        broadcast(sessionId, 'history-saved', { path: `history/${historyDocRel}` });
      } catch (e) {
        broadcast(sessionId, 'output', { text: `[历史文档追加失败] ${e.message}`, stream: 'stderr' });
      }
    }

    // ── 检查是否有待执行的 relaunch 请求 ──────────────────
    if (sess.pendingRelaunch) {
      const relaunchParams = sess.pendingRelaunch;
      sess.pendingRelaunch = null;
      sess.agentStatus = 'idle';
      sess.agentProcess = null;
      broadcast(sessionId, 'output', { text: '\n🔄 上下文已重置，正在重新启动 Agent…\n', stream: 'stdout' });
      broadcast(sessionId, 'done', { code, elapsed, task, relaunch: true });
      // 短暂延迟后通过内部 HTTP 请求重新调用 /agent/start
      setTimeout(() => {
        const http = require('http');
        const body = JSON.stringify({ ...relaunchParams, sessionId });
        const internalReq = http.request({
          hostname: 'localhost',
          port: 7439,
          path: '/agent/start',
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        }, (r) => {
          r.resume(); // 消费响应流，避免内存泄漏
        });
        internalReq.on('error', (err) => {
          broadcast(sessionId, 'output', { text: `[relaunch 失败] ${err.message}\n`, stream: 'stderr' });
        });
        internalReq.write(body);
        internalReq.end();
      }, 800);
      return;
    }

    // 等待用户确认结束或追加任务，而不是立即广播 done
    sess.pendingDone = { code, elapsed, task };
    sess.agentStatus = 'waiting';
    broadcast(sessionId, 'waiting-confirm', { code, elapsed, task });
    sess.agentProcess = null;
  });

  // ── 心跳（每 3 秒）─────────────────────────────────────
  sess.heartbeatTimer = setInterval(() => {
    if (sess.agentStatus !== 'running') { clearInterval(sess.heartbeatTimer); return; }
    broadcast(sessionId, 'heartbeat', {
      elapsedSec: Math.floor((Date.now() - sess.startTime) / 1000),
      alive: sess.agentProcess && sess.agentProcess.exitCode === null,
      pid: sess.agentProcess ? sess.agentProcess.pid : null,
      tokenEst: Math.round((promptChars + sess.outputAccum.length) / 4),
      maxTokens: modelInfo.maxTokens,
    });
  }, 3000);

  res.json({ success: true, message: 'Agent 已启动', task, pid: sess.agentProcess.pid });
});

/* ─────────────────────────────────────────────────────────
   POST /agent/relaunch  —— 重新启动 Agent（上下文重置后自动调用）

   使用上次 /agent/start 保存的参数重新启动 Agent，常用于：
     1. 上下文达到 80% 后执行压缩重置，再调用此接口恢复运行
     2. 无需前端干预，Agent 在任务内自动调用即可完成重启 + POLL 循环

   Body (JSON, 均可选):
     sessionId    {string}  会话 ID，默认 "default"
     overrideTask {string}  覆盖上次的 task（如注入新的 POLL 指令），不传则沿用原 task
──────────────────────────────────────────────────────── */
router.post('/relaunch', (req, res) => {
  const body = req.body || {};
  const sessionId = String(body.sessionId || req.query.sessionId || 'default');
  const sess = getSession(sessionId);

  if (!sess.lastLaunchParams) {
    return res.status(400).json({
      success: false,
      error: '没有可用的启动参数，请先通过 /agent/start 启动一次 Agent',
    });
  }

  // 允许调用方用 overrideTask 替换任务描述（例如注入新的 POLL 指令文本）
  const launchParams = { ...sess.lastLaunchParams };
  if (body.overrideTask) launchParams.task = body.overrideTask;

  if (sess.agentStatus === 'running' && sess.agentProcess) {
    // Agent 正在运行（最常见：Agent 自身调用 relaunch）：
    // 挂起 relaunch 参数 → 进程结束后 close handler 自动重启
    sess.pendingRelaunch = launchParams;
    try { sess.agentProcess.kill('SIGTERM'); } catch (_) {}
    setTimeout(() => {
      if (sess.agentProcess) {
        try { sess.agentProcess.kill('SIGKILL'); } catch (_) {}
      }
    }, 3000);
    return res.json({ success: true, scheduled: true, message: '当前 Agent 进程将被终止，随后自动重新启动' });
  }

  // Agent 未在运行（等待中/空闲/错误）：立即通过内部 HTTP 请求启动
  if (sess.agentStatus === 'waiting') {
    sess.pendingDone = null;
    sess.agentStatus = 'idle';
    broadcast(sessionId, 'done', { code: -1, elapsed: 0, task: sess.currentTask || '' });
  }

  const http = require('http');
  const payload = JSON.stringify({ ...launchParams, sessionId });
  const internalReq = http.request({
    hostname: 'localhost',
    port: 7439,
    path: '/agent/start',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
  }, (r) => {
    r.resume();
  });
  internalReq.on('error', (err) => {
    broadcast(sessionId, 'output', { text: `[relaunch 内部请求失败] ${err.message}\n`, stream: 'stderr' });
  });
  internalReq.write(payload);
  internalReq.end();

  return res.json({ success: true, scheduled: false, message: 'Agent 已立即重新启动' });
});

/* ─────────────────────────────────────────────────────────
   POST /agent/stop  —— 强制停止 Agent
───────────────────────────────────────────────────────── */
router.post('/stop', (req, res) => {
  const sessionId = String(req.body.sessionId || req.query.sessionId || 'default');
  const sess = getSession(sessionId);
  // 如果正在等待用户确认，直接视为放弃
  if (sess.agentStatus === 'waiting') {
    sess.pendingDone = null;
    sess.agentStatus = 'idle';
    broadcast(sessionId, 'stopped', { message: '用户手动停止' });
    return res.json({ success: true, message: 'Agent 已停止' });
  }
  if (!sess.agentProcess) {
    return res.json({ success: false, error: 'Agent 未在运行' });
  }
  clearInterval(sess.heartbeatTimer);
  sess.agentProcess.kill('SIGTERM');
  setTimeout(() => { if (sess.agentProcess) sess.agentProcess.kill('SIGKILL'); }, 2000);
  sess.agentStatus = 'idle';
  broadcast(sessionId, 'stopped', { message: '用户手动停止' });
  res.json({ success: true, message: 'Agent 已停止' });
});

/* ─────────────────────────────────────────────────────────
   POST /agent/confirm  —— 用户确认任务结束或提交追加任务

   Body (JSON):
     action  'done' | 'continue'
     task    追加任务描述（action='continue' 时必填）
───────────────────────────────────────────────────────── */
router.post('/confirm', (req, res) => {
  const sessionId = String(req.body.sessionId || 'default');
  const sess = getSession(sessionId);
  if (sess.agentStatus !== 'waiting' || !sess.pendingDone) {
    return res.json({ success: false, error: '没有待确认的任务' });
  }
  const { action = 'done', task: followUpTask } = req.body;
  const { code, elapsed, task } = sess.pendingDone;
  sess.pendingDone = null;
  sess.agentStatus = code === 0 ? 'done' : 'error';
  broadcast(sessionId, 'done', { code, elapsed, task });

  if (action === 'continue' && followUpTask && followUpTask.trim()) {
    // 稍后广播，让客户端先处理 done 事件
    setTimeout(() => {
      broadcast(sessionId, 'continue-queued', { task: followUpTask.trim() });
    }, 200);
  }
  res.json({ success: true });
});

/* ─────────────────────────────────────────────────────────
   POST /agent/input  —— 向运行中的 Agent stdin 发送输入
   用于回应权限确认等交互提示（y/n 或自定义内容）
   文本始终保存到 runtime/user_input 供 AI 读取
───────────────────────────────────────────────────────── */
router.post('/input', (req, res) => {
  const sessionId = String(req.body.sessionId || 'default');
  const sess = getSession(sessionId);
  const { text = '', saveTo, historyDoc: reqHistoryDoc } = req.body;

  // 始终将输入内容保存到会话专属文件（default 会话用 user_input，其他用 user_input_{sessionId}）
  const relPath = saveTo || (sessionId === 'default' ? 'user_input' : `user_input_${sessionId}`);
  const savePath = path.join(RUNTIME_DIR, relPath);
  try {
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    fs.writeFileSync(savePath, text, 'utf-8');
  } catch (_) {}

  // 若 agent 正在运行，同时写入 stdin
  if (sess.agentProcess && sess.agentStatus === 'running') {
    try { sess.agentProcess.stdin.write(text + '\n', 'utf8'); } catch (_) {}
  }

  // 将用户消息追加到历史文档（优先用 session 中已配置的路径，其次用请求中传来的 historyDoc 名）
  let histAbsPath = sess.historyDocAbsPath;
  let histRel = sess.historyDocRel;
  if (!histAbsPath && reqHistoryDoc) {
    const candidate = path.join(HISTORY_DIR, reqHistoryDoc);
    if (candidate.startsWith(HISTORY_DIR) && fs.existsSync(candidate)) {
      histAbsPath = candidate;
      histRel = reqHistoryDoc;
    }
  }
  if (histAbsPath) {
    try {
      const ts = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const userMsgMd = `\n> 💬 **[用户留言 ${ts}]**\n>\n> ${text.replace(/\n/g, '\n> ')}\n`;
      fs.appendFileSync(histAbsPath, userMsgMd, 'utf-8');
      broadcast(sessionId, 'history-saved', { path: `history/${histRel}` });
    } catch (_) {}
  }

  broadcast(sessionId, 'output', { text: `💬 ${text}`, stream: 'user-msg' });
  res.json({ success: true, savedTo: path.relative(path.join(__dirname, '..'), savePath) });
});

/* ─────────────────────────────────────────────────────────
   POST /agent/request-input  —— 主动要求用户在前端打开输入框
   可由外部脚本、工具或 AI 调用，通过 SSE 广播触发前端弹出"注入输入"面板

   Body (JSON):
     sessionId   会话 ID（可选，默认 default）
     prompt      显示在输入框顶部的提示文字（可选）
     placeholder 输入框 placeholder（可选）
──────────────────────────────────────────────────────── */
router.post('/request-input', (req, res) => {
  const rawId = req.body.sessionId || req.query.sessionId || '';
  const { prompt = '', placeholder = '' } = req.body;
  if (!rawId || rawId === '*') {
    // 广播到所有已知 session
    sessions.forEach((_, sid) => broadcast(sid, 'request-input', { prompt, placeholder }));
  } else {
    broadcast(String(rawId), 'request-input', { prompt, placeholder });
  }
  res.json({ success: true, message: '已发送打开输入框请求' });
});

/* ─────────────────────────────────────────────────────────
   POST /agent/set-status  —— 外部（POLL 脚本）更新 session 状态 + 广播标签
   Body: { sessionId, status, task, label, type }
──────────────────────────────────────────────────────── */
router.post('/set-status', (req, res) => {
  const body = req.body || {};
  const sid  = String(body.sessionId || 'default');
  const sess = getSession(sid);
  if (body.status)          sess.agentStatus  = body.status;
  if (body.task !== undefined) sess.currentTask = body.task;
  // 同时广播标签事件（向前兼容旧用法）
  if (body.label !== undefined || body.type !== undefined) {
    broadcast(sid, 'agent-action', { type: body.type || 'poll', label: body.label || '' });
  }
  res.json({ success: true, sessionId: sid, status: sess.agentStatus });
});

/* ─────────────────────────────────────────────────────────
   GET /agent/sessions  —— 列出所有已知 session
──────────────────────────────────────────────────────── */
router.get('/sessions', (req, res) => {
  const list = [];
  sessions.forEach((sess, id) => {
    list.push({
      id,
      status: sess.agentStatus,
      clients: sess.agentClients.size,
      task: sess.currentTask ? sess.currentTask.slice(0, 60) : null,
    });
  });
  res.json({ success: true, sessions: list });
});

/* ─────────────────────────────────────────────────────────
   GET /agent/status  —— 当前状态
───────────────────────────────────────────────────────── */
router.get('/status', (req, res) => {
  const sessionId = String(req.query.sessionId || 'default');
  const sess = getSession(sessionId);
  res.json({
    success: true,
    status: sess.agentStatus,
    task: sess.currentTask,
    currentAction: sess.currentAction || null,
    elapsedSec: sess.startTime ? Math.floor((Date.now() - sess.startTime) / 1000) : null,
    pid: sess.agentProcess ? sess.agentProcess.pid : null,
    historyCount: sess.agentHistory.length,
  });
});

/* ─────────────────────────────────────────────────────────
   GET /agent/history     —— 任务历史列表
   DELETE /agent/history  —— 清除内存历史
───────────────────────────────────────────────────────── */
router.get('/history', (req, res) => {
  const sessionId = String(req.query.sessionId || 'default');
  const sess = getSession(sessionId);
  const list = sess.agentHistory.map(({ task, code, elapsed, time }, i) => ({
    index: i + 1, task, code, elapsed, time,
  }));
  res.json({ success: true, total: list.length, history: list });
});

router.delete('/history', (req, res) => {
  const sessionId = String(req.query.sessionId || 'default');
  const sess = getSession(sessionId);
  sess.agentHistory = [];
  sess.agentBuffer = [];
  res.json({ success: true, message: '历史已清除' });
});

/* ─────────────────────────────────────────────────────────
   POST /agent/clear-context  —— 重置全部上下文（内存历史 + agentBuffer）
   用于 ENAMETOOLONG 等任务开始前 Prompt 过长的场景
───────────────────────────────────────────────────────── */
router.post('/clear-context', (req, res) => {
  const sessionId = String(req.body.sessionId || req.query.sessionId || 'default');
  const sess = getSession(sessionId);
  sess.agentHistory = [];
  sess.agentBuffer = [];
  res.json({ success: true, message: '上下文已重置：内存历史和缓冲已清空。' });
});

/* ─────────────────────────────────────────────────────────
   GET  /agent/history-docs  —— 列出 docs/history/ 下所有 .md 文件
   POST /agent/history-docs  —— 新建一个历史文档
───────────────────────────────────────────────────────── */
router.get('/history-docs', (_req, res) => {
  try {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    const files = [];
    const scan = (dir, base = '') => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = base ? `${base}/${entry.name}` : entry.name;
        if (entry.isDirectory()) { scan(path.join(dir, entry.name), rel); }
        else if (entry.name.endsWith('.md')) files.push(rel);
      }
    };
    scan(HISTORY_DIR);
    files.sort();
    res.json({ success: true, docs: files });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/history-docs', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'name 为必填项' });
  try {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    const rel = name.trim().endsWith('.md') ? name.trim() : `${name.trim()}.md`;
    const absPath = path.join(HISTORY_DIR, rel);
    if (!absPath.startsWith(HISTORY_DIR)) return res.status(400).json({ success: false, error: '非法路径' });
    if (fs.existsSync(absPath)) return res.status(409).json({ success: false, error: '文件已存在' });
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    const header = `# 会话历史: ${rel.replace(/\.md$/, '')}\n\n> 创建于 ${new Date().toISOString()}\n\n---\n\n`;
    fs.writeFileSync(absPath, header, 'utf-8');
    res.json({ success: true, path: rel });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────
   GET /agent/docs  —— 返回全部可用 .md 文档列表（用于设定选择器）
───────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────
   POST /agent/auth   —— 启动 GitHub 认证流程 (Device Flow)
   DELETE /agent/auth —— 取消正在进行的认证
───────────────────────────────────────────────────────── */
// ── 辅助：启动 copilot auth 子进程 ───────────────────────
function spawnAuth() {
  const { cmd, args, shell } = detectCopilotCmd();
  broadcastGlobal('auth-start', { time: new Date().toISOString() });

  // StringDecoder 处理 auth 输出的 UTF-8 分割
  const authOutDecoder = new StringDecoder('utf8');

  try {
    authProcess = spawn(cmd, [...args, 'login'], {
      env: buildEnv(), windowsHide: true, shell,
    });
  } catch (err) {
    broadcastGlobal('auth-error', { message: `启动失败: ${err.message}` });
    authProcess = null;
    return;
  }

  // 自动跳过「Press Enter to open browser」提示
  authProcess.stdin.on('error', () => {}); // 忽略 EPIPE 等 stdin 写入错误
  setTimeout(() => {
    try { if (authProcess && !authProcess.stdin.destroyed) authProcess.stdin.write('\n'); } catch (_) {}
  }, 800);

  authProcess.stdout.on('data', (chunk) => {
    const text = cleanOutput(authOutDecoder.write(chunk));
    if (text) broadcastGlobal('auth-output', { text });
  });
  authProcess.stdout.on('end', () => {
    const tail = cleanOutput(authOutDecoder.end());
    if (tail) broadcastGlobal('auth-output', { text: tail });
  });
  authProcess.stderr.on('data', (chunk) => {
    const text = cleanOutput(new StringDecoder('utf8').write(chunk));
    if (text.trim()) broadcastGlobal('auth-output', { text });
  });
  authProcess.on('error', (err) => {
    broadcastGlobal('auth-error', { message: err.message });
    authProcess = null;
  });
  authProcess.on('close', (code) => {
    broadcastGlobal('auth-done', { code });
    authProcess = null;
  });
}

router.post('/auth', async (req, res) => {
  if (authProcess) {
    return res.status(409).json({ success: false, error: '认证进程已在运行' });
  }

  const cli = await checkCliAvailable();
  if (cli.available) {
    // CLI 已安装 —— 直接认证
    spawnAuth();
    return res.json({ success: true, message: '认证已启动' });
  }

  // CLI 未安装 —— 自动安装后再认证
  broadcastGlobal('install-start', { time: new Date().toISOString() });
  res.json({ success: true, message: 'CLI 未安装，正在自动安装并认证' });

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  installProcess = spawn(npmCmd, ['install', '-g', '@github/copilot'], {
    windowsHide: true, shell: false, env: process.env,
  });

  installProcess.stdout.on('data', (c) => broadcastGlobal('install-output', { text: c.toString('utf8') }));
  installProcess.stderr.on('data', (c) => broadcastGlobal('install-output', { text: c.toString('utf8') }));
  installProcess.on('error', (err) => {
    broadcastGlobal('install-error', { message: err.message });
    installProcess = null;
  });
  installProcess.on('close', (code) => {
    installProcess = null;
    broadcastGlobal('install-done', { code });
    if (code === 0) {
      // 安装成功 —— 继续启动认证
      setTimeout(spawnAuth, 500);
    } else {
      broadcastGlobal('auth-error', { message: `安装失败 (code ${code})，无法进行认证` });
    }
  });
});

router.delete('/auth', (req, res) => {
  if (!authProcess) {
    return res.json({ success: false, error: '无运行中的认证进程' });
  }
  try { authProcess.kill('SIGTERM'); } catch (_) {}
  authProcess = null;
  broadcastGlobal('auth-done', { code: -1, cancelled: true });
  res.json({ success: true, message: '认证已取消' });
});

/* ─────────────────────────────────────────────────────────
   POST /agent/install  —— 在线安装 @github/copilot CLI
───────────────────────────────────────────────────────── */
router.post('/install', (req, res) => {
  if (installProcess) {
    return res.status(409).json({ success: false, error: '安装进程已在运行' });
  }

  broadcastGlobal('install-start', { time: new Date().toISOString() });

  installProcess = spawn(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['install', '-g', '@github/copilot'],
    { windowsHide: true, shell: false, env: process.env }
  );

  installProcess.stdout.on('data', (chunk) => {
    broadcastGlobal('install-output', { text: chunk.toString('utf8') });
  });
  installProcess.stderr.on('data', (chunk) => {
    broadcastGlobal('install-output', { text: chunk.toString('utf8') });
  });
  installProcess.on('error', (err) => {
    broadcastGlobal('install-error', { message: err.message });
    installProcess = null;
  });
  installProcess.on('close', (code) => {
    broadcastGlobal('install-done', { code });
    installProcess = null;
  });

  res.json({ success: true, message: '安装进程已启动' });
});

router.get('/docs', (req, res) => {
  try {
    const files = collectAllFiles(DOCS_DIR);
    res.json({ success: true, docs: files.map(f => f.rel) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────
   GET /agent/detect  —— 检测 Copilot CLI 是否可用
───────────────────────────────────────────────────────── */
router.get('/detect', (req, res) => {
  const { cmd, args, shell } = detectCopilotCmd();
  const probe = spawn(cmd, [...args, '--version'], { timeout: 5000, windowsHide: true, shell });
  let out = '';
  probe.stdout.on('data', d => { out += d.toString(); });
  probe.stderr.on('data', d => { out += d.toString(); });
  probe.on('close', (code) => {
    res.json({
      success: code === 0,
      cmd, args,
      version: out.trim() || '(无输出)',
      available: code === 0,
    });
  });
  probe.on('error', (err) => {
    res.json({ success: false, cmd, args, available: false, error: err.message });
  });
});

/* ─────────────────────────────────────────────────────────
   GET  /agent/global-config  —— 读取全局配置 JSON
   POST /agent/global-config  —— 写入全局配置 JSON（合并更新）
───────────────────────────────────────────────────────── */
router.get('/global-config', (_req, res) => {
  res.json({ success: true, config: readGlobalConfig() });
});

router.post('/global-config', (req, res) => {
  try {
    const jsonPath = path.join(DOCS_DIR, 'global_config.json');
    const current = readGlobalConfig();
    const updated = Object.assign({}, current, req.body || {});
    fs.writeFileSync(jsonPath, JSON.stringify(updated, null, 2), 'utf-8');
    res.json({ success: true, config: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
