/**
 * 2D 游戏动画生成器 — 独立服务
 * 端口: 8333
 * 启动: node server.js
 */

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Load COS credentials from MagicWorld .env
const ENV_PATH = path.join(__dirname, '..', 'MagicWorld', '.env');
if (fs.existsSync(ENV_PATH)) {
  fs.readFileSync(ENV_PATH, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
}

const COS_SDK   = path.join(__dirname, '..', '..', 'node_modules', 'cos-nodejs-sdk-v5');
const COS_BUCKET = 'magicworld-1304036735';
const COS_REGION = 'ap-guangzhou';
const COS_PREFIX = 'game-sprites/';

const app = express();
const PORT = 8333;

const ROOT     = path.join(__dirname, '..', '..');     // E:\docs-service
const TOOLS    = path.join(ROOT, 'tools');

const EMBED_PY    = path.join(TOOLS, 'python', 'python.exe');
const VENV_PY     = path.join(TOOLS, 'venv', 'Scripts', 'python.exe');
// For char_gen.py, use the Flux venv which has diffusers+torch
const FLUX_PY     = path.join('E:\\AIGC\\Flux\\backend\\venv\\Scripts\\python.exe');
const PYTHON_CMD  = fs.existsSync(EMBED_PY) ? EMBED_PY : (fs.existsSync(VENV_PY) ? VENV_PY : 'python');
const CHAR_PY     = fs.existsSync(FLUX_PY) ? FLUX_PY : PYTHON_CMD;
const GEN_SCRIPT  = path.join(TOOLS, 'pixel_art_gen.py');
const CHAR_SCRIPT = path.join(TOOLS, 'char_gen.py');

app.use(express.json({ limit: '20mb' }));

// ── Cute skeletal animation page ─────────────────────────────────────────────
app.get('/cute', (req, res) => {
  res.sendFile(path.join(__dirname, 'cute.html'));
});

// ── Process visualization page ────────────────────────────────────────────────
app.get('/process', (req, res) => {
  res.sendFile(path.join(__dirname, 'process.html'));
});

// ── Char animate page ─────────────────────────────────────────────────────────
app.get('/char', (req, res) => {
  res.sendFile(path.join(__dirname, 'char-animate.html'));
});

// ── API: Generate AI character ────────────────────────────────────────────────
app.post('/api/gen-character', (req, res) => {
  const {
    prompt  = 'warrior knight with sword',
    width   = 768,
    height  = 1024,
    steps   = 20,
    seed    = null,
    remove_bg = true,
  } = req.body || {};

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: 'start', msg: '启动 SDXL 生成...' });

  const proc = spawn(CHAR_PY, [CHAR_SCRIPT], { cwd: TOOLS });
  let out = '', err = '', done = false;

  const timer = setTimeout(() => {
    done = true;
    try { proc.kill(); } catch (_) {}
    send({ type: 'error', msg: '生成超时 (120s)' });
    res.end();
  }, 120000);

  proc.stderr.on('data', d => {
    const line = d.toString().trim();
    if (line) send({ type: 'log', msg: line });
  });
  proc.stdout.on('data', d => { out += d; });
  proc.stdin.write(JSON.stringify({ prompt, width, height, steps, seed, remove_bg }));
  proc.stdin.end();

  proc.on('close', () => {
    if (done) return;
    clearTimeout(timer);
    try {
      const data = JSON.parse(out.trim());
      send({ type: 'done', ...data });
    } catch {
      send({ type: 'error', msg: err.trim() || out.trim() || '解析失败' });
    }
    res.end();
  });
  proc.on('error', e => {
    clearTimeout(timer);
    send({ type: 'error', msg: e.message });
    res.end();
  });
});

const VIDEO_SCRIPT  = path.join(TOOLS, 'video_gen.py');
const SPRITE_SCRIPT = path.join(TOOLS, 'sprite_gen.py');
const WAN_SCRIPT    = path.join(TOOLS, 'wan_gen.py');

// ── API: Wan Video generation (T2V) ──────────────────────────────────────────
app.post('/api/gen-wan', (req, res) => {
  const {
    prompt = 'a warrior knight attacking, dynamic action, anime style',
    frames = 16,
    fps    = 8,
    width  = 480,
    height = 320,
    steps  = 20,
    seed   = null,
  } = req.body || {};

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: 'start', msg: `启动 Wan Video 生成 (${frames}帧 ${width}x${height})...` });

  const proc = spawn(CHAR_PY, [WAN_SCRIPT], { cwd: TOOLS });
  let out = '', done = false;

  // Allow up to 20 min (first run downloads ~27GB)
  const timer = setTimeout(() => {
    done = true;
    try { proc.kill(); } catch (_) {}
    send({ type: 'error', msg: '生成超时 (20min)' });
    res.end();
  }, 1200000);

  proc.stderr.on('data', d => {
    const line = d.toString().trim();
    if (line) send({ type: 'log', msg: line });
  });
  proc.stdout.on('data', d => { out += d; });
  proc.stdin.write(JSON.stringify({ prompt, frames, fps, width, height, steps, seed }));
  proc.stdin.end();

  proc.on('close', () => {
    if (done) return;
    clearTimeout(timer);
    try {
      const data = JSON.parse(out.trim());
      send({ type: 'done', ...data });
    } catch {
      send({ type: 'error', msg: '解析失败: ' + out.substring(0, 300) });
    }
    res.end();
  });
  proc.on('error', e => {
    clearTimeout(timer);
    send({ type: 'error', msg: e.message });
    res.end();
  });
});

// ── API: Generate sprite sheet animation ─────────────────────────────────────
app.post('/api/gen-sprite', (req, res) => {
  const {
    prompt     = 'warrior knight',
    action     = 'attack',
    char_style = 'anime',
    cols       = 4,
    frame_size = 256,
    steps      = 25,
    seed       = null,
  } = req.body || {};

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: 'start', msg: `启动 SDXL 精灵图集生成 — ${action} (${cols}帧)...` });

  const proc = spawn(CHAR_PY, [SPRITE_SCRIPT], { cwd: TOOLS });
  let out = '', done = false;

  const timer = setTimeout(() => {
    done = true;
    try { proc.kill(); } catch (_) {}
    send({ type: 'error', msg: '生成超时 (150s)' });
    res.end();
  }, 150000);

  proc.stderr.on('data', d => {
    const line = d.toString().trim();
    if (line) send({ type: 'log', msg: line });
  });
  proc.stdout.on('data', d => { out += d; });
  proc.stdin.write(JSON.stringify({ prompt, action, char_style, cols, frame_size, steps, seed }));
  proc.stdin.end();

  proc.on('close', () => {
    if (done) return;
    clearTimeout(timer);
    try {
      const data = JSON.parse(out.trim());
      send({ type: 'done', ...data });
    } catch {
      send({ type: 'error', msg: '解析失败: ' + out.substring(0, 200) });
    }
    res.end();
  });
  proc.on('error', e => {
    clearTimeout(timer);
    send({ type: 'error', msg: e.message });
    res.end();
  });
});

// ── Sprite animation page ─────────────────────────────────────────────────────
app.get('/sprite', (req, res) => {
  res.sendFile(path.join(__dirname, 'sprite-animate.html'));
});



// ── API: Generate animation video (AnimateDiff SDXL) ─────────────────────────
app.post('/api/gen-video', (req, res) => {
  const {
    prompt  = 'warrior knight',
    action  = 'attack',
    width   = 512,
    height  = 512,
    frames  = 16,
    steps   = 20,
    seed    = null,
  } = req.body || {};

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: 'start', msg: `启动 AnimateDiff SDXL — ${action} 动画生成...` });

  const proc = spawn(CHAR_PY, [VIDEO_SCRIPT], { cwd: TOOLS });
  let out = '', done = false;

  const timer = setTimeout(() => {
    done = true;
    try { proc.kill(); } catch (_) {}
    send({ type: 'error', msg: '生成超时 (180s)' });
    res.end();
  }, 180000);

  proc.stderr.on('data', d => {
    const line = d.toString().trim();
    if (line) send({ type: 'log', msg: line });
  });
  proc.stdout.on('data', d => { out += d; });
  proc.stdin.write(JSON.stringify({ prompt, action, width, height, frames, steps, seed }));
  proc.stdin.end();

  proc.on('close', () => {
    if (done) return;
    clearTimeout(timer);
    try {
      const data = JSON.parse(out.trim());
      send({ type: 'done', ...data });
    } catch {
      send({ type: 'error', msg: '解析失败: ' + out.substring(0, 200) });
    }
    res.end();
  });
  proc.on('error', e => {
    clearTimeout(timer);
    send({ type: 'error', msg: e.message });
    res.end();
  });
});


// ── Video animation page ──────────────────────────────────────────────────────
app.get('/video', (req, res) => {
  res.sendFile(path.join(__dirname, 'video-animate.html'));
});
app.get('/wan', (req, res) => {
  res.sendFile(path.join(__dirname, 'wan-video.html'));
});

app.use(express.static(__dirname));

// ── Run pixel_art_gen.py ──────────────────────────────────────────────────────
function runGen(args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON_CMD, [GEN_SCRIPT], { cwd: TOOLS });
    let out = '', err = '', done = false;

    const timer = setTimeout(() => {
      done = true;
      try { proc.kill(); } catch (_) {}
      reject(new Error('生成超时'));
    }, timeoutMs);

    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });
    proc.stdin.write(JSON.stringify(args));
    proc.stdin.end();

    proc.on('close', () => {
      if (done) return;
      clearTimeout(timer);
      try {
        resolve(JSON.parse(out.trim()));
      } catch {
        reject(new Error(err.trim() || out.trim() || '解析失败'));
      }
    });
    proc.on('error', e => { clearTimeout(timer); reject(e); });
  });
}

// ── API: Generate ─────────────────────────────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  const {
    prompt         = '2D game character sprite',
    style          = 'pixel art',
    width          = 256,
    height         = 256,
    seed,
    animate        = false,
    animation_type = 'idle',
    frame_count    = 4,
    frame_delay,
  } = req.body || {};

  if (!String(prompt).trim()) {
    return res.status(400).json({ success: false, error: 'prompt 不能为空' });
  }

  try {
    const data = await runGen({
      prompt, style, width, height, seed,
      animate, animation_type, frame_count, frame_delay,
    }, 20000);
    res.json(data);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── API: Animation types list ─────────────────────────────────────────────────
app.get('/api/animations', (req, res) => {
  res.json({
    success: true,
    animations: [
      { id: 'idle',   name: '待机  💤', frames: 2, delay: 500 },
      { id: 'walk',   name: '行走  🚶', frames: 4, delay: 150 },
      { id: 'run',    name: '奔跑  🏃', frames: 4, delay: 100 },
      { id: 'attack', name: '攻击  ⚔️', frames: 3, delay: 120 },
    ],
    character_types: [
      { id: 'warrior', name: '战士/骑士  ⚔️' },
      { id: 'mage',    name: '法师/巫师  🔮' },
      { id: 'archer',  name: '弓手/猎人  🏹' },
      { id: 'robot',   name: '机器人      🤖' },
      { id: 'ghost',   name: '幽灵/精魂  👻' },
      { id: 'zombie',  name: '僵尸/怪物  🧟' },
    ],
  });
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ success: true, service: 'game-animation', port: PORT, python: PYTHON_CMD });
});

// ── COS upload ────────────────────────────────────────────────────────────────
app.post('/api/cos/upload', async (req, res) => {
  const { data, filename, type = 'image/gif' } = req.body || {};
  if (!data || !filename) {
    return res.status(400).json({ success: false, error: 'data 和 filename 必填' });
  }

  if (!process.env.SECRET_ID || !process.env.SECRET_KEY) {
    return res.status(503).json({ success: false, error: 'COS 凭证未配置' });
  }

  try {
    const COS = require(COS_SDK);
    const cos = new COS({ SecretId: process.env.SECRET_ID, SecretKey: process.env.SECRET_KEY });
    const buf = Buffer.from(data, 'base64');
    const key = COS_PREFIX + filename;

    await new Promise((resolve, reject) => {
      cos.putObject({
        Bucket: COS_BUCKET,
        Region: COS_REGION,
        Key: key,
        Body: buf,
        ContentType: type,
        ACL: 'public-read',
      }, (err, result) => {
        if (err) reject(err); else resolve(result);
      });
    });

    const url = `https://${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com/${key}`;
    res.json({ success: true, url, key, bucket: COS_BUCKET });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`🎮 Game Animation Service running at http://localhost:${PORT}`);
  console.log(`   Python: ${PYTHON_CMD}`);
  console.log(`   Generator: ${GEN_SCRIPT}`);
});
