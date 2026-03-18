/**
 * Game Animation Route
 * 挂载路径: /game-animation
 *
 *   GET  /game-animation/         — 主页面
 *   POST /game-animation/generate — 生成像素艺术精灵图（本地过程化算法，无需外部 API）
 *   GET  /game-animation/models   — 可用"生成引擎"列表
 */

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const router = express.Router();
const APP_DIR  = path.join(__dirname, '..', 'application', 'game-animation');
const TOOLS_DIR = path.join(__dirname, '..', 'tools');

// Embedded Python (same as /tools/python)
const EMBED_PY     = path.join(TOOLS_DIR, 'python', 'python.exe');
const VENV_PY_WIN  = path.join(TOOLS_DIR, 'venv', 'Scripts', 'python.exe');
const PYTHON_CMD   = fs.existsSync(EMBED_PY) ? EMBED_PY : (fs.existsSync(VENV_PY_WIN) ? VENV_PY_WIN : 'python');

const MODELS = [
  { id: 'procedural-warrior', name: '战士/骑士  🗡️',  tag: 'warrior' },
  { id: 'procedural-mage',    name: '法师/巫师  🔮',  tag: 'mage'    },
  { id: 'procedural-archer',  name: '弓手/猎人  🏹',  tag: 'archer'  },
  { id: 'procedural-robot',   name: '机器人      🤖',  tag: 'robot'   },
  { id: 'procedural-ghost',   name: '幽灵/精魂  👻',  tag: 'ghost'   },
  { id: 'procedural-default', name: '通用角色   🎮',  tag: 'default' },
];

// ── Serve index.html ──────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  res.sendFile(path.join(APP_DIR, 'index.html'));
});

router.get('/models', (req, res) => {
  res.json({ success: true, models: MODELS });
});

// ── Run pixel art generator script directly ───────────────────────────────────
function runPixelArtGen(args, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(TOOLS_DIR, 'pixel_art_gen.py');
    const proc = spawn(PYTHON_CMD, [scriptPath], { cwd: TOOLS_DIR });
    let stdout = '', stderr = '';
    let done = false;

    const timer = setTimeout(() => {
      done = true;
      try { proc.kill(); } catch (_) {}
      reject(new Error('生成超时'));
    }, timeoutMs);

    proc.stdout.on('data', c => { stdout += c; });
    proc.stderr.on('data', c => { stderr += c; });
    proc.stdin.write(JSON.stringify(args), 'utf8');
    proc.stdin.end();

    proc.on('close', () => {
      if (done) return;
      clearTimeout(timer);
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        reject(new Error(stderr.trim() || stdout.trim() || '解析输出失败'));
      }
    });
    proc.on('error', err => { clearTimeout(timer); reject(err); });
  });
}

// ── POST /game-animation/generate ────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  const {
    prompt  = '2D game sprite character',
    style   = 'pixel art',
    width   = 256,
    height  = 256,
    seed,
  } = req.body || {};

  if (!String(prompt).trim()) {
    return res.status(400).json({ success: false, error: 'prompt 不能为空' });
  }

  try {
    const data = await runPixelArtGen({ prompt, style, width, height, seed }, 15000);
    res.json(data);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
