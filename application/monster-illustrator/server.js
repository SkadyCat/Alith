const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const PORT = 8335;
const PUBLIC_DIR = path.join(__dirname, 'public');
const IMAGES_DIR = path.join(PUBLIC_DIR, 'images');

app.use(express.json());
app.use('/images', express.static(IMAGES_DIR));
app.use(express.static(PUBLIC_DIR));

const PY = 'E:\\AIGC\\Flux\\backend\\venv\\Scripts\\python.exe';
const SCRIPT = path.join(__dirname, 'generate_monsters.py');

let generationState = {
  running: false,
  done: 0,
  total: 6,
  log: [],
  model: 'waiIllustriousSDXL v1.60',
};

function loadManifest() {
  const p = path.join(IMAGES_DIR, 'manifest.json');
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch {}
  }
  return null;
}

function loadProgress() {
  const p = path.join(IMAGES_DIR, 'progress.json');
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch {}
  }
  return null;
}

// Start generation
app.post('/api/generate', (req, res) => {
  if (generationState.running) {
    return res.json({ success: false, error: '正在生成中，请稍候...' });
  }
  generationState = { running: true, done: 0, total: 6, log: ['启动生成...'], model: 'waiIllustriousSDXL v1.60' };

  // Clear old progress
  const progressFile = path.join(IMAGES_DIR, 'progress.json');
  if (fs.existsSync(progressFile)) fs.unlinkSync(progressFile);

  const proc = spawn(PY, [SCRIPT], {
    env: { ...process.env, HTTP_PROXY: 'http://127.0.0.1:7890', HTTPS_PROXY: 'http://127.0.0.1:7890' }
  });

  proc.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => {
      generationState.log.push(line);
      const m = line.match(/^PROGRESS:(\d+)\/(\d+)/);
      if (m) {
        generationState.done = parseInt(m[1]);
        generationState.total = parseInt(m[2]);
      }
      if (line.includes('ALL_DONE')) {
        generationState.running = false;
      }
    });
  });

  proc.stderr.on('data', (data) => {
    const line = data.toString().trim();
    if (line && !line.includes('UserWarning') && !line.includes('FutureWarning') && !line.includes('DeprecationWarning')) {
      generationState.log.push('[ERR] ' + line.substring(0, 120));
    }
  });

  proc.on('close', (code) => {
    generationState.running = false;
    generationState.log.push(`进程退出: code=${code}`);
  });

  res.json({ success: true, message: '开始生成 6 个怪物角色立绘...' });
});

// Get status
app.get('/api/status', (req, res) => {
  const manifest = loadManifest();
  const progress = loadProgress();
  res.json({
    ...generationState,
    manifest,
    progress,
    log: generationState.log.slice(-30),
  });
});

// Get images
app.get('/api/images', (req, res) => {
  const manifest = loadManifest();
  if (!manifest) return res.json({ success: false, monsters: [] });
  
  const monsters = manifest.monsters.map(m => ({
    ...m,
    orig_url: `/images/${m.orig}`,
    nobg_url: `/images/${m.nobg}`,
    orig_exists: fs.existsSync(path.join(IMAGES_DIR, m.orig)),
    nobg_exists: fs.existsSync(path.join(IMAGES_DIR, m.nobg)),
  }));
  
  res.json({ success: true, model: manifest.model, checkpoint: manifest.checkpoint, monsters });
});

app.listen(PORT, () => {
  console.log(`Monster Illustrator running at http://localhost:${PORT}`);
  const manifest = loadManifest();
  if (manifest) {
    console.log(`Found existing manifest: ${manifest.monsters.length} monsters generated`);
  }
});
