const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const multer = require('multer');
const COS = require('cos-nodejs-sdk-v5');
const { marked } = require('marked');

// Load hunyuan API credentials from its .env
require('dotenv').config({ path: path.join(__dirname, 'application', 'hunyuan', '.env') });
const HY_SECRET_ID  = process.env.SECRET_ID;
const HY_SECRET_KEY = process.env.SECRET_KEY;
const HY_BUCKET     = process.env.COS_BUCKET  || 'magicworld-1304036735';
const HY_REGION     = process.env.COS_REGION  || 'ap-guangzhou';
const MODELS3D_DIR  = path.join(__dirname, 'application', 'hunyuan', 'models');

const chokidar = require('chokidar');

// ─── Hot-reload route registry ────────────────────────────────
const routeModules = {
  external: { file: './routes/external', router: null },
  agent:    { file: './routes/agent',    router: null },
  tools:    { file: './routes/tools',    router: null },
};

function loadRoute(key) {
  const mod = routeModules[key];
  const fullPath = require.resolve(mod.file);
  delete require.cache[fullPath];
  mod.router = require(mod.file);
  console.log(`🔄 [hot-reload] reloaded: ${mod.file}`);
}

// Initial load
Object.keys(routeModules).forEach(loadRoute);

// Watch routes/ for changes
chokidar.watch(path.join(__dirname, 'routes'), { ignoreInitial: true })
  .on('change', (filePath) => {
    const key = Object.keys(routeModules).find(k =>
      filePath.replace(/\\/g, '/').endsWith(path.basename(routeModules[k].file) + '.js')
    );
    if (key) loadRoute(key);
    else console.log(`🔄 [hot-reload] changed (no mapping): ${filePath}`);
  })
  .on('add', (filePath) => console.log(`➕ [hot-reload] new file: ${filePath}`));

const app = express();
const PORT = 7439;
const DOCS_DIR = path.join(__dirname, 'docs');

// Ensure docs directory exists
if (!fs.existsSync(DOCS_DIR)) {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  // Create sample documents
  fs.writeFileSync(path.join(DOCS_DIR, 'README.md'), `# 欢迎使用文档服务

这是一个基于 **Markdown** 的文档服务系统。

## 功能特性

- 📁 左侧文件树导航
- ✏️ 左编辑右预览模式
- 🎨 优雅的界面设计
- 💾 实时保存文档

## 快速开始

1. 在左侧菜单选择或创建文档
2. 点击顶部 **编辑** 按钮进入编辑模式
3. 在左侧编写 Markdown，右侧实时预览
4. 点击 **保存** 保存你的文档

## Markdown 示例

### 代码块

\`\`\`javascript
console.log('Hello, World!');
\`\`\`

### 表格

| 功能 | 状态 |
|------|------|
| 文件浏览 | ✅ |
| Markdown 渲染 | ✅ |
| 实时编辑 | ✅ |
| 语法高亮 | ✅ |

### 引用

> 好的文档是团队协作的桥梁。

---

*由文档服务系统生成*
`);

  fs.writeFileSync(path.join(DOCS_DIR, 'guide.md'), `# 使用指南

## 基础操作

### 创建文档
点击左侧菜单顶部的 **+** 按钮，输入文件名即可创建新文档。

### 编辑文档
选中文档后，点击顶部工具栏的 **编辑** 按钮切换到编辑模式。

### 保存文档
编辑完成后，点击 **保存** 按钮或使用快捷键 \`Ctrl+S\` 保存。

## Markdown 语法

### 标题
\`\`\`
# H1 标题
## H2 标题
### H3 标题
\`\`\`

### 文本格式
- **加粗**: \`**文字**\`
- *斜体*: \`*文字*\`
- ~~删除线~~: \`~~文字~~\`
- \`行内代码\`: \`\`代码\`\`

### 列表
\`\`\`
- 无序列表项
- 另一项
  - 嵌套项

1. 有序列表项
2. 另一项
\`\`\`

### 链接和图片
\`\`\`
[链接文字](https://example.com)
![图片描述](image.png)
\`\`\`
`);

  fs.mkdirSync(path.join(DOCS_DIR, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(DOCS_DIR, 'notes', 'meeting.md'), `# 会议记录

## 2024-01-15 团队会议

**参与人员**: 张三、李四、王五

### 议题

1. 项目进度回顾
2. 技术方案讨论
3. 下阶段计划

### 决议

- 项目按计划推进
- 采用新的技术栈
- 下次会议时间：2024-01-22

---

> 会议纪要由系统自动生成
`);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── 对外开放接口 ───────────────────────────────────────────
app.use('/open',  (req, res, next) => routeModules.external.router(req, res, next));

// ─── CopilotCli Agent ────────────────────────────────────────
app.use('/agent', (req, res, next) => routeModules.agent.router(req, res, next));

// ─── Python & Shell Tools ────────────────────────────────────
app.use('/tools', (req, res, next) => routeModules.tools.router(req, res, next));

// ─── Applications ────────────────────────────────────────────
app.use('/jump_game', express.static(path.join(__dirname, 'application', 'jump_game')));
app.use('/models3d', express.static(path.join(__dirname, 'application', 'hunyuan', 'models')));

// Get file tree
function getFileTree(dir, basePath = '') {
  const items = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      items.push({
        type: 'folder',
        name: entry.name,
        path: relativePath,
        children: getFileTree(path.join(dir, entry.name), relativePath)
      });
    } else if (/\.(md|json|txt|yaml|yml|toml|csv|xml|html|js|ts|py|sh)$/.test(entry.name)) {
      items.push({
        type: 'file',
        name: entry.name,
        path: relativePath
      });
    }
  }
  return items;
}

// API: Get file tree
app.get('/api/tree', (req, res) => {
  try {
    const tree = getFileTree(DOCS_DIR);
    res.json({ success: true, tree });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Get file content
app.get('/api/file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ success: false, error: 'Path required' });
  
  const fullPath = path.join(DOCS_DIR, filePath);
  if (!fullPath.startsWith(DOCS_DIR)) {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }
  
  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    const html = marked(content);
    res.json({ success: true, content, html });
  } catch (err) {
    res.status(404).json({ success: false, error: 'File not found' });
  }
});

// API: Save file content
app.post('/api/file', (req, res) => {
  const { path: filePath, content } = req.body;
  if (!filePath) return res.status(400).json({ success: false, error: 'Path required' });
  
  const fullPath = path.join(DOCS_DIR, filePath);
  if (!fullPath.startsWith(DOCS_DIR)) {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }
  
  try {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
    const html = marked(content);
    res.json({ success: true, html });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Create new file
app.post('/api/create', (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath) return res.status(400).json({ success: false, error: 'Path required' });
  
  const normalizedPath = filePath.endsWith('.md') ? filePath : `${filePath}.md`;
  const fullPath = path.join(DOCS_DIR, normalizedPath);
  if (!fullPath.startsWith(DOCS_DIR)) {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }
  
  try {
    if (fs.existsSync(fullPath)) {
      return res.status(409).json({ success: false, error: 'File already exists' });
    }
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    const defaultContent = `# ${path.basename(normalizedPath, '.md')}\n\n在这里开始编写你的文档...\n`;
    fs.writeFileSync(fullPath, defaultContent, 'utf-8');
    res.json({ success: true, path: normalizedPath });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Create directory
app.post('/api/mkdir', (req, res) => {
  const { path: dirPath } = req.body;
  if (!dirPath || !dirPath.trim()) return res.status(400).json({ success: false, error: 'Path required' });

  const fullPath = path.join(DOCS_DIR, dirPath.trim());
  if (!fullPath.startsWith(DOCS_DIR)) {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }
  try {
    if (fs.existsSync(fullPath)) {
      return res.status(409).json({ success: false, error: '目录已存在' });
    }
    fs.mkdirSync(fullPath, { recursive: true });
    res.json({ success: true, path: dirPath.trim() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Delete file
app.delete('/api/file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ success: false, error: 'Path required' });
  
  const fullPath = path.join(DOCS_DIR, filePath);
  if (!fullPath.startsWith(DOCS_DIR)) {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }
  
  try {
    fs.unlinkSync(fullPath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Delete folder (recursive)
app.delete('/api/folder', (req, res) => {
  const folderPath = req.query.path;
  if (!folderPath) return res.status(400).json({ success: false, error: 'Path required' });

  const fullPath = path.join(DOCS_DIR, folderPath);
  if (!fullPath.startsWith(DOCS_DIR) || fullPath === DOCS_DIR) {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }

  try {
    fs.rmSync(fullPath, { recursive: true, force: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Dialogue / Session API ──────────────────────────────────
const DIALOGUE_DIR = path.join(DOCS_DIR, 'dialogue');

app.get('/api/dialogue', (req, res) => {
  try {
    if (!fs.existsSync(DIALOGUE_DIR)) return res.json({ success: true, sessions: [] });
    const files = fs.readdirSync(DIALOGUE_DIR).filter(f => f.endsWith('.md'));
    const sessions = files.map(f => {
      try {
        const cfg = JSON.parse(fs.readFileSync(path.join(DIALOGUE_DIR, f), 'utf-8'));
        return { id: f, ...cfg };
      } catch {
        return { id: f, name: f.replace('.md', ''), model: '', historyDoc: '', systemDocs: [] };
      }
    });
    res.json({ success: true, sessions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/dialogue', (req, res) => {
  const { name, model, historyDoc, systemDocs } = req.body;
  const id = `session-${Date.now()}.md`;
  const cfg = { name: name || '新会话', model: model || 'claude-sonnet-4.6', historyDoc: historyDoc || '', systemDocs: systemDocs || [] };
  try {
    fs.mkdirSync(DIALOGUE_DIR, { recursive: true });
    fs.writeFileSync(path.join(DIALOGUE_DIR, id), JSON.stringify(cfg, null, 2), 'utf-8');
    res.json({ success: true, id, ...cfg });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/dialogue/:id', (req, res) => {
  const { id } = req.params;
  if (id.includes('/') || id.includes('\\')) return res.status(403).json({ success: false, error: 'Invalid id' });
  const fullPath = path.join(DIALOGUE_DIR, id);
  try {
    let existing = {};
    if (fs.existsSync(fullPath)) {
      try { existing = JSON.parse(fs.readFileSync(fullPath, 'utf-8')); } catch {}
    }
    const updated = { ...existing, ...req.body };
    fs.mkdirSync(DIALOGUE_DIR, { recursive: true });
    fs.writeFileSync(fullPath, JSON.stringify(updated, null, 2), 'utf-8');
    res.json({ success: true, id, ...updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/dialogue/:id', (req, res) => {
  const { id } = req.params;
  if (id.includes('/') || id.includes('\\')) return res.status(403).json({ success: false, error: 'Invalid id' });
  const fullPath = path.join(DIALOGUE_DIR, id);
  try {
    fs.unlinkSync(fullPath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Render markdown
app.post('/api/render', (req, res) => {
  const { content } = req.body;
  try {
    const html = marked(content || '');
    res.json({ success: true, html });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Upload files via drag-and-drop
// Body: { folder: string, files: [{ name: string, content: string, encoding: 'utf8'|'base64' }] }
app.post('/api/upload', (req, res) => {
  const { folder = '', files } = req.body;
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ success: false, error: '未提供文件' });
  }

  const targetDir = path.join(DOCS_DIR, folder);
  if (!targetDir.startsWith(DOCS_DIR)) {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }

  const results = [];
  const errors = [];

  try {
    fs.mkdirSync(targetDir, { recursive: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: `创建目录失败: ${err.message}` });
  }

  for (const file of files) {
    try {
      let { name, content, encoding = 'utf8' } = file;
      if (!name || typeof content === 'undefined') {
        errors.push({ name: name || '?', error: '缺少文件名或内容' });
        continue;
      }
      // Sanitize filename: no path traversal
      const safeName = path.basename(name.replace(/\\/g, '/'));
      if (!safeName) {
        errors.push({ name, error: '无效文件名' });
        continue;
      }
      const fullPath = path.join(targetDir, safeName);
      if (!fullPath.startsWith(DOCS_DIR)) {
        errors.push({ name, error: 'Access denied' });
        continue;
      }
      const buf = encoding === 'base64'
        ? Buffer.from(content, 'base64')
        : Buffer.from(content, 'utf8');
      fs.writeFileSync(fullPath, buf);
      results.push({ name: safeName, path: folder ? `${folder}/${safeName}` : safeName });
    } catch (err) {
      errors.push({ name: file.name, error: err.message });
    }
  }

  res.json({ success: true, saved: results, errors });
});

// ─── File Watch SSE ──────────────────────────────────────────
const watchClients = new Set();

app.get('/api/watch', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  watchClients.add(res);
  req.on('close', () => watchClients.delete(res));
});

fs.watch(DOCS_DIR, { recursive: true }, (eventType, filename) => {
  if (!filename || !filename.endsWith('.md')) return;
  const filePath = filename.replace(/\\/g, '/');
  const payload = `event: file-changed\ndata: ${JSON.stringify({ path: filePath })}\n\n`;
  watchClients.forEach(res => { if (!res.writableEnded) res.write(payload); });
});

// ─── 图生3D API (Hunyuan) ────────────────────────────────────
function sha256hex(str) { return crypto.createHash('sha256').update(str).digest('hex'); }
function hmacsha256(key, str) { return crypto.createHmac('sha256', key).update(str).digest(); }

function hyBuildHeaders(action, payload) {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const host = 'ai3d.tencentcloudapi.com';
  const payloadStr = JSON.stringify(payload);
  const canonicalHeaders = `content-type:application/json\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const credentialScope = `${date}/ai3d/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, credentialScope,
    sha256hex(['POST', '/', '', canonicalHeaders, signedHeaders, sha256hex(payloadStr)].join('\n'))].join('\n');
  const sig = crypto.createHmac('sha256',
    hmacsha256(hmacsha256(hmacsha256(Buffer.from('TC3' + HY_SECRET_KEY), date), 'ai3d'), 'tc3_request')
  ).update(stringToSign).digest('hex');
  return {
    'Authorization': `TC3-HMAC-SHA256 Credential=${HY_SECRET_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${sig}`,
    'Content-Type': 'application/json',
    'Host': host,
    'X-TC-Action': action,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Version': '2025-05-13',
    'X-TC-Region': 'ap-guangzhou',
  };
}

function hyCallApi(action, payload) {
  return new Promise((resolve, reject) => {
    const headers = hyBuildHeaders(action, payload);
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'ai3d.tencentcloudapi.com', method: 'POST', path: '/',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

function hyDownloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close(); fs.unlinkSync(dest);
        return hyDownloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
  });
}

function hyUploadToCos(localPath, cosKey) {
  return new Promise((resolve, reject) => {
    const cos = new COS({ SecretId: HY_SECRET_ID, SecretKey: HY_SECRET_KEY });
    cos.putObject({
      Bucket: HY_BUCKET, Region: HY_REGION, Key: cosKey,
      Body: fs.createReadStream(localPath),
      ContentLength: fs.statSync(localPath).size,
    }, (err, data) => {
      if (err) return reject(err);
      resolve(`https://${HY_BUCKET}.cos.${HY_REGION}.myqcloud.com/${cosKey}`);
    });
  });
}

// ─── 文生图 API (Hunyuan TextToImage) ───────────────────────
function hyT2IBuildHeaders(action, payload) {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const host = 'hunyuan.tencentcloudapi.com';
  const payloadStr = JSON.stringify(payload);
  const canonicalHeaders = `content-type:application/json\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const credentialScope = `${date}/hunyuan/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, credentialScope,
    sha256hex(['POST', '/', '', canonicalHeaders, signedHeaders, sha256hex(payloadStr)].join('\n'))].join('\n');
  const sig = crypto.createHmac('sha256',
    hmacsha256(hmacsha256(hmacsha256(Buffer.from('TC3' + HY_SECRET_KEY), date), 'hunyuan'), 'tc3_request')
  ).update(stringToSign).digest('hex');
  return {
    'Authorization': `TC3-HMAC-SHA256 Credential=${HY_SECRET_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${sig}`,
    'Content-Type': 'application/json',
    'Host': host,
    'X-TC-Action': action,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Version': '2023-09-01',
    'X-TC-Region': 'ap-guangzhou',
  };
}

function hyT2ICallApi(action, payload) {
  return new Promise((resolve, reject) => {
    const headers = hyT2IBuildHeaders(action, payload);
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'hunyuan.tencentcloudapi.com', method: 'POST', path: '/',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body); req.end();
  });
}

// POST /api/t2i/generate — 文生图 (TextToImageLite)
app.post('/api/t2i/generate', async (req, res) => {
  const { prompt, negativePrompt = '', model = 'hunyuan-standard', resolution = '1:1' } = req.body;
  if (!prompt) return res.status(400).json({ success: false, error: '请输入提示词' });
  // Map ratio → pixel resolution (TextToImageLite format)
  const resMap = { '1:1': '768:768', '3:4': '768:1024', '4:3': '1024:768', '16:9': '1280:720', '9:16': '720:1280' };
  const pixelRes = resMap[resolution] || '768:768';
  // Map model → style string
  const styleMap = { 'hunyuan-anime': '101', 'hunyuan-sketch': '102' };
  const style = styleMap[model] || '201';
  try {
    const payload = {
      Prompt: prompt,
      Resolution: pixelRes,
      Style: style,
      RspImgType: 'base64',
    };
    if (negativePrompt) payload.NegativePrompt = negativePrompt;
    const result = await hyT2ICallApi('TextToImageLite', payload);
    if (!result.Response || result.Response.Error) {
      return res.status(500).json({ success: false, error: result.Response?.Error?.Message || JSON.stringify(result) });
    }
    const images = result.Response.ResultImage || [];
    if (!images.length) return res.status(500).json({ success: false, error: '未返回图片' });
    res.json({ success: true, base64: images[0] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/comfyui/generate — 文生图 via ComfyUI/Flux (port 8188)
const COMFYUI_BASE = 'http://localhost:8188';
app.post('/api/comfyui/generate', async (req, res) => {
  const { prompt = 'a beautiful image', width = 1024, height = 1024, steps = 4, seed = -1 } = req.body;
  // Build a minimal Flux workflow
  const workflow = {
    "1": { "class_type": "CLIPTextEncode", "inputs": { "text": prompt, "clip": ["2", 0] } },
    "2": { "class_type": "DualCLIPLoader", "inputs": { "clip_name1": "t5xxl_fp8", "clip_name2": "clip_l", "type": "flux" } },
    "3": { "class_type": "KSampler", "inputs": { "seed": seed, "steps": steps, "cfg": 0.0, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0, "model": ["4", 0], "positive": ["1", 0], "negative": ["5", 0], "latent_image": ["6", 0] } },
    "4": { "class_type": "UNETLoader", "inputs": { "unet_name": "flux1-schnell-Q2_K.gguf", "weight_dtype": "fp8_e4m3fn" } },
    "5": { "class_type": "CLIPTextEncode", "inputs": { "text": "", "clip": ["2", 0] } },
    "6": { "class_type": "EmptyLatentImage", "inputs": { "width": width, "height": height, "batch_size": 1 } },
  };
  try {
    // Submit job
    const submitRes = await fetch(`${COMFYUI_BASE}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
    });
    if (!submitRes.ok) return res.status(502).json({ success: false, error: `ComfyUI submit failed: ${submitRes.status}` });
    const { prompt_id } = await submitRes.json();

    // Poll history until done (max 3 min)
    const deadline = Date.now() + 3 * 60 * 1000;
    let filename = null;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000));
      const histRes = await fetch(`${COMFYUI_BASE}/history/${prompt_id}`);
      const hist = await histRes.json();
      const job = hist[prompt_id];
      if (!job) continue;
      if (job.status === 'error') return res.status(500).json({ success: false, error: job.error || 'ComfyUI job failed' });
      if (job.status === 'done') {
        filename = job.outputs?.images?.[0]?.filename;
        break;
      }
    }
    if (!filename) return res.status(504).json({ success: false, error: '生成超时，请稍后重试' });

    // Fetch image and return as base64
    const imgRes = await fetch(`${COMFYUI_BASE}/view?filename=${encodeURIComponent(filename)}`);
    if (!imgRes.ok) return res.status(502).json({ success: false, error: '获取图片失败' });
    const buf = Buffer.from(await imgRes.arrayBuffer());
    res.json({ success: true, base64: buf.toString('base64'), filename });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/sdxl/generate — 文生图 via SDXL Service (port 8189, CivitAI models)
const SDXL_BASE = 'http://localhost:8189';
app.post('/api/sdxl/generate', async (req, res) => {
  const {
    prompt = 'a beautiful image',
    negative_prompt,
    model = 'wai-sdxl',
    width,
    height,
    steps,
    guidance_scale,
    seed = -1,
  } = req.body;
  try {
    const genRes = await fetch(`${SDXL_BASE}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, negative_prompt, model, width, height, steps, guidance_scale, seed }),
      signal: AbortSignal.timeout(5 * 60 * 1000),
    });
    if (!genRes.ok) {
      const err = await genRes.text();
      return res.status(502).json({ success: false, error: `SDXL service error: ${err}` });
    }
    const data = await genRes.json();
    if (!data.success) return res.status(500).json({ success: false, error: data.detail || 'SDXL generation failed' });

    // Fetch image and return as base64
    const imgRes = await fetch(`${SDXL_BASE}/outputs/${data.filename}`);
    if (!imgRes.ok) return res.status(502).json({ success: false, error: '获取图片失败' });
    const buf = Buffer.from(await imgRes.arrayBuffer());
    res.json({ success: true, base64: buf.toString('base64'), filename: data.filename, model: data.model, seed: data.seed, elapsed: data.elapsed_seconds });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// multer upload (images, max 10MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('只支持图片文件'));
    cb(null, true);
  },
});

// POST /api/i2t — 图生文 (Image-to-Text via Hunyuan Vision)
// 接口由 comfyui-service 对外暴露，此处为 server.js 直连版本（credentials 已在此服务中配置）
app.post('/api/i2t', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: '请上传图片' });
  const mime = req.file.mimetype || 'image/jpeg';
  const dataUrl = `data:${mime};base64,${req.file.buffer.toString('base64')}`;
  const payload = {
    Model: 'hunyuan-vision',
    Messages: [{
      Role: 'user',
      Contents: [
        { Type: 'image_url', ImageUrl: { Url: dataUrl } },
        { Type: 'text', Text: '请详细描述这张图片的内容，包括：主体对象、颜色、风格、构图等，用于生成3D模型的参考提示词，尽量简洁（100字以内）。' },
      ],
    }],
  };
  try {
    const result = await hyT2ICallApi('ChatCompletions', payload);
    if (!result.Response || result.Response.Error) {
      return res.status(500).json({ success: false, error: result.Response?.Error?.Message || JSON.stringify(result) });
    }
    const choices = result.Response.Choices || [];
    if (!choices.length) return res.status(500).json({ success: false, error: '未返回描述' });
    const description = choices[0]?.Message?.Content || '';
    res.json({ success: true, description });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

const imgJobs = {}; // in-memory job tracking

// POST /api/img3d/submit — upload image and submit job
app.post('/api/img3d/submit', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: '请上传图片' });
  const base64Image = req.file.buffer.toString('base64');
  const prompt = req.body.prompt || '';
  try {
    const payload = { ImageBase64: base64Image, Model: '3.0' };
    if (prompt) payload.Prompt = prompt;
    const submitRes = await hyCallApi('SubmitHunyuanTo3DProJob', payload);
    if (!submitRes.Response || submitRes.Response.Error) {
      return res.status(500).json({ success: false, error: submitRes.Response?.Error?.Message || JSON.stringify(submitRes) });
    }
    const jobId = submitRes.Response.JobId;
    imgJobs[jobId] = { status: 'WAIT', submittedAt: new Date().toISOString() };
    res.json({ success: true, jobId });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/img3d/status/:jobId — poll job status
app.get('/api/img3d/status/:jobId', async (req, res) => {
  const { jobId } = req.params;
  try {
    const queryRes = await hyCallApi('QueryHunyuanTo3DProJob', { JobId: jobId });
    if (!queryRes.Response) return res.status(500).json({ success: false, error: JSON.stringify(queryRes) });
    const { Status, ResultFile3Ds, ErrorCode, ErrorMessage } = queryRes.Response;
    if (imgJobs[jobId]) imgJobs[jobId].status = Status;
    res.json({ success: true, jobId, status: Status, files: ResultFile3Ds || [], errorCode: ErrorCode, errorMessage: ErrorMessage });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/img3d/download/:jobId — download GLB and serve locally
app.post('/api/img3d/download/:jobId', async (req, res) => {
  const { jobId } = req.params;
  try {
    const queryRes = await hyCallApi('QueryHunyuanTo3DProJob', { JobId: jobId });
    const { Status, ResultFile3Ds } = queryRes.Response;
    if (Status !== 'DONE') return res.status(400).json({ success: false, error: '任务尚未完成', status: Status });

    const results = [];
    for (const file of ResultFile3Ds || []) {
      const ext = (file.Type || 'glb').toLowerCase();
      const localName = `img3d_${jobId}.${ext}`;
      const localPath = path.join(MODELS3D_DIR, localName);
      await hyDownloadFile(file.Url, localPath);
      results.push({ type: file.Type, localUrl: `/models3d/${localName}`, name: localName });
    }
    res.json({ success: true, jobId, results });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/img3d/list — list generated image-to-3d models
app.get('/api/img3d/list', (req, res) => {
  try {
    const files = fs.readdirSync(MODELS3D_DIR)
      .filter(f => f.startsWith('img3d_') && f.endsWith('.glb'))
      .map(name => {
        const stat = fs.statSync(path.join(MODELS3D_DIR, name));
        return { name, size: stat.size, modified: stat.mtime, localUrl: `/models3d/${name}` };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));
    res.json({ success: true, files });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// API: Restart server via rundoc.bat
app.post('/api/restart', (req, res) => {
  const { spawn } = require('child_process');
  const batPath = path.join(__dirname, 'rundoc.bat');
  if (!fs.existsSync(batPath)) {
    return res.status(404).json({ success: false, error: 'rundoc.bat 不存在' });
  }
  // Respond before this process gets killed by the bat
  res.json({ success: true, message: '正在重启服务，约 3 秒后恢复…' });
  // Detach so rundoc.bat survives after this node exits
  const child = spawn('cmd.exe', ['/c', batPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    cwd: __dirname,
  });
  child.unref();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n📚 文档服务已启动`);
  console.log(`🌐 访问地址: http://localhost:${PORT}`);
  console.log(`📁 文档目录: ${DOCS_DIR}\n`);
});
