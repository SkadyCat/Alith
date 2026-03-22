/**
 * One-time patch script: add long-poll support to actual disk routes/agent.js
 * Run: node runtime/patch_agent.js
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'routes', 'agent.js');
let src = fs.readFileSync(FILE, 'utf-8');

let changed = 0;

// ──────────────────────────────────────────────────────────
// PATCH 1: Add global.__inputWaiters after SESSION_STATE_FILE constant
// ──────────────────────────────────────────────────────────
const P1_OLD = `const SESSION_STATE_FILE = path.join(RUNTIME_DIR, 'agent_sessions_state.json');`;
const P1_NEW = `const SESSION_STATE_FILE = path.join(RUNTIME_DIR, 'agent_sessions_state.json');

// ── Long-Poll 等待队列：sessionId → [{ res, timer }] ─────────────
// 当 GET /agent/input?wait=N 无消息时将响应挂起，有新消息立刻唤醒
if (!global.__inputWaiters) global.__inputWaiters = new Map();
const inputWaiters = global.__inputWaiters;`;

if (src.includes(P1_OLD) && !src.includes('global.__inputWaiters')) {
  src = src.replace(P1_OLD, P1_NEW);
  changed++;
  console.log('✅ PATCH 1 applied: global.__inputWaiters added');
} else {
  console.log('⏭  PATCH 1 skipped (already applied or anchor not found)');
}

// ──────────────────────────────────────────────────────────
// PATCH 2: Add wakeInputWaiters function before function getQueueDirs
// ──────────────────────────────────────────────────────────
const P2_ANCHOR = `function getQueueDirs(sessionId) {`;
const P2_INSERT = `/* ── Long-Poll 唤醒：有新消息时立即送达正在等待的 GET /agent/input 连接 ── */
function wakeInputWaiters(sessionId) {
  const waiters = inputWaiters ? inputWaiters.get(sessionId) : null;
  if (!waiters || waiters.length === 0) return;
  try {
    const { waitDir, doneDir } = getQueueDirs(sessionId);
    const files = fs.readdirSync(waitDir).filter(f => f.endsWith('.md')).sort();
    if (files.length === 0) return; // 文件已被其他连接取走
    // 找到一个仍然活跃的等待连接
    let waiter = null;
    while (waiters.length > 0) {
      const candidate = waiters.shift();
      clearTimeout(candidate.timer);
      if (!candidate.res.headersSent) { waiter = candidate; break; }
    }
    if (!waiter) return; // 全部连接已断开，文件留在 waitprocess/
    const oldest  = files[0];
    const srcPath = path.join(waitDir, oldest);
    const dstPath = path.join(doneDir, oldest);
    const content = fs.readFileSync(srcPath, 'utf-8');
    fs.renameSync(srcPath, dstPath);
    // 通知前端：消息已送达
    const ackTime = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const deliveredText = \`⚡ [\${ackTime}] 消息已送达 Agent，正在处理中…\`;
    broadcast(sessionId, 'output', { text: deliveredText, stream: 'system-ack' });
    if (typeof process._pyagentBroadcastToSSE === 'function') {
      process._pyagentBroadcastToSSE({ type: 'agent_output', sessionId, stream: 'system-ack', text: deliveredText });
    }
    waiter.res.json({ success: true, hasContent: true, content, remaining: files.length - 1, source: oldest });
  } catch (err) {
    console.error('[wakeInputWaiters] error:', err.message);
  }
}
process._wakeInputWaiters = wakeInputWaiters;

`;

if (src.includes(P2_ANCHOR) && !src.includes('wakeInputWaiters')) {
  src = src.replace(P2_ANCHOR, P2_INSERT + P2_ANCHOR);
  changed++;
  console.log('✅ PATCH 2 applied: wakeInputWaiters function added');
} else {
  console.log('⏭  PATCH 2 skipped (already applied or anchor not found)');
}

// ──────────────────────────────────────────────────────────
// PATCH 3: POST /input — call wakeInputWaiters after writing to waitDir
// ──────────────────────────────────────────────────────────
const P3_OLD = `    savedTo = \`agent/chat/\${dirName}/waitprocess/\${fname}\`;
  } catch (_) {}`;
const P3_NEW = `    savedTo = \`agent/chat/\${dirName}/waitprocess/\${fname}\`;
    // ── 立即唤醒正在 Long-Poll 等待的 GET /agent/input 连接 ──
    wakeInputWaiters(sessionId);
  } catch (_) {}`;

if (src.includes(P3_OLD) && !src.includes('wakeInputWaiters(sessionId)')) {
  src = src.replace(P3_OLD, P3_NEW);
  changed++;
  console.log('✅ PATCH 3 applied: wakeInputWaiters call in POST /input');
} else {
  console.log('⏭  PATCH 3 skipped (already applied or anchor not found)');
}

// ──────────────────────────────────────────────────────────
// PATCH 4: GET /input — add waitSecs parsing and long-poll logic
// ──────────────────────────────────────────────────────────
const P4_OLD = `router.get('/input', (req, res) => {
  const sessionId = String(req.query.sessionId || 'default');
  try {
    const { waitDir, doneDir } = getQueueDirs(sessionId);
    // 按文件名排序取最旧的一条（文件名以时间戳开头，字典序 = 时序）
    const files = fs.readdirSync(waitDir)
      .filter(f => f.endsWith('.md'))
      .sort();
    if (files.length === 0) {
      // 兼容旧队列文件：检查 runtime/user_input_<sessionId>.md
      const legacyPath = path.join(RUNTIME_DIR,
        sessionId === 'default' ? 'user_input.md' : \`user_input_\${sessionId}.md\`
);
      if (fs.existsSync(legacyPath)) {
        const raw = fs.readFileSync(legacyPath, 'utf-8');
        if (raw.trim()) {
          const msgs = raw.split('---MSG---').map(m => m.trim()).filter(Boolean)
;
          const first = msgs[0];
          const remaining = msgs.slice(1).join('\\n---MSG---\\n');
          fs.writeFileSync(legacyPath, remaining, 'utf-8');
          return res.json({ success: true, hasContent: true, content: first, rem
aining: msgs.length - 1, source: 'legacy' });
        }
      }
      return res.json({ success: true, hasContent: false, content: '', remaining
: 0 });
    }`;

// The line-wrapped version is tricky. Let's use a simpler string match approach
// by finding the exact handler pattern and replacing it.
const P4_SEARCH = "router.get('/input', (req, res) => {\n  const sessionId = String(req.query.sessionId || 'default');\n  try {";
const P4_REPLACE = `router.get('/input', (req, res) => {
  const sessionId = String(req.query.sessionId || 'default');
  // wait=N：最多挂起 N 秒等待新消息（long-poll），0 表示立即返回（short-poll）
  const waitSecs = Math.min(Math.max(parseInt(req.query.wait || '0', 10) || 0, 0), 60);
  try {`;

if (src.includes(P4_SEARCH) && !src.includes('waitSecs')) {
  src = src.replace(P4_SEARCH, P4_REPLACE);
  changed++;
  console.log('✅ PATCH 4a applied: waitSecs parsing added to GET /input');
} else {
  console.log('⏭  PATCH 4a skipped');
}

// Add long-poll suspension: replace the immediate "no content" return
const P4B_OLD = `      return res.json({ success: true, hasContent: false, content: '', remaining: 0 });
    }`;
const P4B_NEW = `      // ── Long-Poll：挂起等待，有消息时由 wakeInputWaiters 唤醒 ──
      if (waitSecs > 0) {
        if (!inputWaiters.has(sessionId)) inputWaiters.set(sessionId, []);
        const entry = { res, timer: null };
        entry.timer = setTimeout(() => {
          const list = inputWaiters.get(sessionId) || [];
          const idx = list.indexOf(entry);
          if (idx >= 0) list.splice(idx, 1);
          if (!res.headersSent) {
            res.json({ success: true, hasContent: false, content: '', remaining: 0 });
          }
        }, waitSecs * 1000);
        inputWaiters.get(sessionId).push(entry);
        req.on('close', () => {
          clearTimeout(entry.timer);
          const list = inputWaiters.get(sessionId) || [];
          const idx = list.indexOf(entry);
          if (idx >= 0) list.splice(idx, 1);
        });
        return; // 挂起，不立即 res.json
      }
      return res.json({ success: true, hasContent: false, content: '', remaining: 0 });
    }`;

// The actual file may have line-wrapped content. Let's search for a normalized version.
// Normalize line endings first for matching
const normalizedSrc = src.replace(/\r\n/g, '\n');
const P4B_OLD_NORM = P4B_OLD;

if (normalizedSrc.includes(P4B_OLD_NORM) && !normalizedSrc.includes('Long-Poll')) {
  src = normalizedSrc.replace(P4B_OLD_NORM, P4B_NEW);
  changed++;
  console.log('✅ PATCH 4b applied: long-poll suspension logic added');
} else {
  // Try line-wrapped version from the disk file
  const P4B_OLD_WRAPPED = `      return res.json({ success: true, hasContent: false, content: '', remaining\n: 0 });\n    }`;
  if (normalizedSrc.includes(P4B_OLD_WRAPPED)) {
    src = normalizedSrc.replace(P4B_OLD_WRAPPED, P4B_NEW);
    changed++;
    console.log('✅ PATCH 4b (wrapped) applied');
  } else {
    console.log('⏭  PATCH 4b skipped - trying direct insertion...');
    // Try to find the pattern by searching for the return statement near files.length === 0
    const marker = "if (files.length === 0) {";
    const idx = src.indexOf(marker);
    if (idx >= 0) {
      // Find the "return res.json({ success: true, hasContent: false" after this marker
      const chunk = src.substring(idx, idx + 2000);
      const retIdx = chunk.indexOf('return res.json({ success: true, hasContent: false');
      if (retIdx >= 0) {
        // Find end of this statement (closing brace of the if block)
        const absRetIdx = idx + retIdx;
        const endIdx = src.indexOf('\n    }', absRetIdx);
        if (endIdx >= 0) {
          const before = src.substring(0, absRetIdx);
          const after = src.substring(endIdx);
          src = before + `// ── Long-Poll：挂起等待，有消息时由 wakeInputWaiters 唤醒 ──
      if (waitSecs > 0) {
        if (!inputWaiters.has(sessionId)) inputWaiters.set(sessionId, []);
        const entry = { res, timer: null };
        entry.timer = setTimeout(() => {
          const list = inputWaiters.get(sessionId) || [];
          const idx = list.indexOf(entry);
          if (idx >= 0) list.splice(idx, 1);
          if (!res.headersSent) {
            res.json({ success: true, hasContent: false, content: '', remaining: 0 });
          }
        }, waitSecs * 1000);
        inputWaiters.get(sessionId).push(entry);
        req.on('close', () => {
          clearTimeout(entry.timer);
          const list = inputWaiters.get(sessionId) || [];
          const idx = list.indexOf(entry);
          if (idx >= 0) list.splice(idx, 1);
        });
        return; // 挂起，不立即 res.json
      }
      return res.json({ success: true, hasContent: false, content: '', remaining: 0 });` + after;
          changed++;
          console.log('✅ PATCH 4b (fallback) applied');
        }
      }
    }
  }
}

if (changed > 0) {
  // Backup original
  fs.writeFileSync(FILE + '.bak', fs.readFileSync(FILE));
  fs.writeFileSync(FILE, src, 'utf-8');
  console.log(`\n✅ Wrote ${changed} patches to ${FILE}`);
} else {
  console.log('\n⚠️  No patches applied. File may already be patched or anchors not found.');
}

// Verify
const verify = fs.readFileSync(FILE, 'utf-8');
console.log('\nVerification:');
console.log('  Has __inputWaiters:', verify.includes('__inputWaiters'));
console.log('  Has wakeInputWaiters:', verify.includes('wakeInputWaiters'));
console.log('  Has waitSecs:', verify.includes('waitSecs'));
console.log('  Has Long-Poll comment:', verify.includes('Long-Poll'));
