/**
 * 对外开放接口 (External API)
 * 挂载路径: /open
 *
 * 所有接口均以 JSON 响应，格式统一为:
 *   { success: true,  ...data  }
 *   { success: false, error: "..." }
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const router = express.Router();
const DOCS_DIR = path.join(__dirname, '..', 'docs');

/* ─────────────────────────────────────────────────────────────
   POST /open/submit
   提交（新建 / 覆盖）文档

   Body (JSON):
     filename  {string}  必填 — 文件名或相对路径，如 "guide" / "api/intro"
                                 可含或不含扩展名
     filetype  {string}  可选 — 文件类型，默认 "md"（目前仅支持 md）
     content   {string}  必填 — 文档正文（Markdown 文本）
     overwrite {boolean} 可选 — 是否覆盖已有文档，默认 true

   Response:
     { success, path, overwritten, message }
───────────────────────────────────────────────────────────── */
router.post('/submit', (req, res) => {
  const { filename, filetype = 'md', content, overwrite = true } = req.body;

  // ── 参数校验 ──────────────────────────────────────────────
  if (!filename || typeof filename !== 'string' || !filename.trim()) {
    return res.status(400).json({ success: false, error: 'filename 为必填项' });
  }
  if (content === undefined || content === null) {
    return res.status(400).json({ success: false, error: 'content 为必填项' });
  }

  // ── 仅支持 md ─────────────────────────────────────────────
  const ext = String(filetype).toLowerCase().replace(/^\./, '') || 'md';
  if (ext !== 'md') {
    return res.status(400).json({
      success: false,
      error: `不支持的文件类型: ${ext}，当前仅支持 md`
    });
  }

  // ── 构造文件路径 ──────────────────────────────────────────
  let relativePath = filename.trim().replace(/\\/g, '/');
  if (!relativePath.endsWith('.md')) {
    relativePath = `${relativePath}.md`;
  }

  const fullPath = path.join(DOCS_DIR, relativePath);

  // ── 路径安全检查（防目录穿越）────────────────────────────
  if (!fullPath.startsWith(DOCS_DIR + path.sep) && fullPath !== DOCS_DIR) {
    return res.status(403).json({ success: false, error: '非法路径，拒绝访问' });
  }

  // ── 是否已存在 ────────────────────────────────────────────
  const exists = fs.existsSync(fullPath);
  if (exists && !overwrite) {
    return res.status(409).json({
      success: false,
      error: '文档已存在，如需覆盖请设置 overwrite: true',
      path: relativePath
    });
  }

  // ── 写入文件 ──────────────────────────────────────────────
  try {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');

    const html = marked(content);

    return res.json({
      success: true,
      path: relativePath,
      overwritten: exists,
      message: exists ? '文档已覆盖更新' : '文档已创建',
      html   // 返回渲染结果，方便调用方预览
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   POST /open/search
   全文模糊搜索所有文档

   Body (JSON):
     q       {string}  必填 — 搜索词
     mode    {string}  可选 — 匹配模式: fuzzy | words | exact | regex，默认 fuzzy
     fields  {string}  可选 — 搜索范围: title | content | both，默认 both
     limit   {number}  可选 — 最多返回结果数，默认 20

   Response:
     { success, query, mode, total, results: [{ path, title, score, excerpts }] }
───────────────────────────────────────────────────────────── */

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

// ── 匹配函数 ──────────────────────────────────────────────
function matchFuzzy(text, q) {
  // 字符依次出现（类 fzf 子序列匹配）
  let qi = 0;
  const lower = text.toLowerCase();
  const lq = q.toLowerCase();
  for (let i = 0; i < lower.length && qi < lq.length; i++) {
    if (lower[i] === lq[qi]) qi++;
  }
  return qi === lq.length;
}

function matchWords(text, q) {
  const lower = text.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => lower.includes(w));
}

function matchExact(text, q) {
  return text.toLowerCase().includes(q.toLowerCase());
}

function matchRegex(text, q) {
  try {
    return new RegExp(q, 'im').test(text);
  } catch {
    return false;
  }
}

function getMatchFn(mode) {
  return { fuzzy: matchFuzzy, words: matchWords, exact: matchExact, regex: matchRegex }[mode] || matchFuzzy;
}

// ── 提取摘要（含上下文） ──────────────────────────────────
function extractExcerpts(content, q, mode, maxCount = 3) {
  const lines = content.split('\n');
  const excerpts = [];
  const lq = q.toLowerCase();

  for (let i = 0; i < lines.length && excerpts.length < maxCount; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let hit = false;
    if (mode === 'regex') { try { hit = new RegExp(q, 'im').test(line); } catch {} }
    else if (mode === 'fuzzy') hit = matchFuzzy(line, q);
    else if (mode === 'words') hit = matchWords(line, q);
    else hit = line.toLowerCase().includes(lq);

    if (hit) {
      const ctx = lines.slice(Math.max(0, i - 1), i + 2).join(' ').replace(/\s+/g, ' ').trim();
      excerpts.push(ctx.length > 200 ? ctx.slice(0, 200) + '…' : ctx);
    }
  }
  return excerpts;
}

router.post('/search', (req, res) => {
  const { q, mode = 'fuzzy', fields = 'both', limit = 20 } = req.body;

  if (!q || typeof q !== 'string' || !q.trim()) {
    return res.status(400).json({ success: false, error: 'q 搜索词为必填项' });
  }
  if (!['fuzzy', 'words', 'exact', 'regex'].includes(mode)) {
    return res.status(400).json({ success: false, error: 'mode 须为 fuzzy | words | exact | regex' });
  }
  if (!['title', 'content', 'both'].includes(fields)) {
    return res.status(400).json({ success: false, error: 'fields 须为 title | content | both' });
  }

  const matchFn = getMatchFn(mode);
  const results = [];

  try {
    const files = collectAllFiles(DOCS_DIR);

    for (const { rel, abs } of files) {
      const titleRaw = rel.replace(/\.md$/, '').split('/').pop();
      const content = fs.readFileSync(abs, 'utf-8');
      const firstHeading = (content.match(/^#+ (.+)/m) || [])[1] || titleRaw;

      const hitTitle   = (fields === 'title'   || fields === 'both') && matchFn(titleRaw, q);
      const hitContent = (fields === 'content'  || fields === 'both') && matchFn(content,  q);

      if (!hitTitle && !hitContent) continue;

      // 简易相关度分（标题命中权重更高）
      let score = 0;
      if (hitTitle) score += 10;
      if (hitContent) {
        const lower = content.toLowerCase();
        const lq = q.toLowerCase();
        let pos = 0, count = 0;
        while ((pos = lower.indexOf(lq, pos)) !== -1) { count++; pos++; }
        score += count;
      }

      const excerpts = hitContent ? extractExcerpts(content, q, mode) : [];

      results.push({ path: rel, title: firstHeading, score, excerpts });
    }

    results.sort((a, b) => b.score - a.score);
    const paged = results.slice(0, Math.min(Number(limit) || 20, 100));

    return res.json({ success: true, query: q, mode, fields, total: paged.length, results: paged });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /open/study
   返回《如何使用文档》的原文与 HTML 渲染，
   供外部系统展示使用帮助

   Response:
     { success, path, content, html }
───────────────────────────────────────────────────────────── */
router.get('/study', (req, res) => {
  const filePath = path.join(DOCS_DIR, '如何使用文档.md');
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(content);
  } catch (err) {
    return res.status(404).json({ success: false, error: '使用文档不存在: ' + err.message });
  }
});

/* ─────────────────────────────────────────────────────────────
   GET /open/tree
   返回 docs/ 文件树，文件节点含 size 字段（字节数）
───────────────────────────────────────────────────────────── */
function buildFileTree(dir, basePath = '') {
  const items = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return items; }
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });
  for (const entry of entries) {
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      items.push({ type: 'folder', name: entry.name, path: relativePath, children: buildFileTree(path.join(dir, entry.name), relativePath) });
    } else if (/\.(md|json|txt|yaml|yml|toml|csv|xml|html|js|ts|py|sh)$/.test(entry.name)) {
      let size = 0;
      try { size = fs.statSync(path.join(dir, entry.name)).size; } catch {}
      items.push({ type: 'file', name: entry.name, path: relativePath, size });
    }
  }
  return items;
}

router.get('/tree', (req, res) => {
  try {
    const tree = buildFileTree(DOCS_DIR);
    res.json({ success: true, tree });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── MagicWorld 应用配置 (application_doc/magicworld/config.json) ──────────────
const MAGICWORLD_CONFIG_PATH = path.join(DOCS_DIR, 'application_doc', 'magicworld', 'config.json');
const MAGICWORLD_DIR = path.join(__dirname, '..', 'application', 'MagicWorld');
const http = require('http');
const { spawn } = require('child_process');

function checkMagicWorldRunning() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:8033/api/config', { timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

router.get('/app-config/magicworld', (req, res) => {
  try {
    const cfg = fs.existsSync(MAGICWORLD_CONFIG_PATH)
      ? JSON.parse(fs.readFileSync(MAGICWORLD_CONFIG_PATH, 'utf8'))
      : {};
    res.json({ success: true, ...cfg });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/app-config/magicworld', (req, res) => {
  try {
    const current = fs.existsSync(MAGICWORLD_CONFIG_PATH)
      ? JSON.parse(fs.readFileSync(MAGICWORLD_CONFIG_PATH, 'utf8'))
      : {};
    const updated = { ...current, ...req.body };
    fs.writeFileSync(MAGICWORLD_CONFIG_PATH, JSON.stringify(updated, null, 2), 'utf8');
    res.json({ success: true, config: updated });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 检查 MagicWorld 是否运行，未运行则自动启动
router.post('/magicworld/ensure', async (req, res) => {
  try {
    const running = await checkMagicWorldRunning();
    if (running) return res.json({ success: true, running: true, starting: false });
    // 启动 MagicWorld
    const batPath = path.join(MAGICWORLD_DIR, 'start.bat');
    if (!fs.existsSync(batPath)) {
      return res.status(404).json({ success: false, error: 'start.bat 不存在' });
    }
    spawn('cmd.exe', ['/c', batPath], {
      detached: true,
      stdio: 'ignore',
      cwd: MAGICWORLD_DIR,
      windowsHide: true,
    }).unref();
    res.json({ success: true, running: false, starting: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 轮询 MagicWorld 是否已就绪
router.get('/magicworld/status', async (req, res) => {
  const running = await checkMagicWorldRunning();
  res.json({ success: true, running });
});

// ── 从 GitHub 拉取最新代码 ──────────────────────────────────────
router.post('/update', (req, res) => {
  const { exec } = require('child_process');
  const cwd = path.join(__dirname, '..');
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  // Step 1: git pull
  exec('git pull origin master', { cwd, env, timeout: 60000 }, (err1, out1, err1s) => {
    const gitOut = (out1 + '\n' + err1s).trim();
    if (err1 && err1.code !== 0) {
      return res.json({ success: false, stdout: gitOut, stderr: '', exitCode: err1.code });
    }
    // Step 2: npm install
    exec('npm install --prefer-offline', { cwd, env, timeout: 60000 }, (err2, out2, err2s) => {
      const npmOut = (out2 + '\n' + err2s).trim();
      res.json({
        success: true,
        stdout: `[git pull]\n${gitOut}\n\n[npm install]\n${npmOut}`,
        stderr: '',
        exitCode: 0,
      });
    });
  });
});

/* ─────────────────────────────────────────────────────────────
   POST /open/rename
   重命名文件或文件夹

   Body (JSON):
     oldPath {string} 必填 — 原相对路径（相对于 docs/）
     newPath {string} 必填 — 新相对路径（相对于 docs/）

   Response:
     { success, newPath }
───────────────────────────────────────────────────────────── */
router.post('/rename', (req, res) => {
  const { oldPath, newPath } = req.body;
  if (!oldPath || !newPath) {
    return res.status(400).json({ success: false, error: 'oldPath and newPath required' });
  }

  const fullOld = path.join(DOCS_DIR, oldPath);
  const fullNew = path.join(DOCS_DIR, newPath);

  if (!fullOld.startsWith(DOCS_DIR) || !fullNew.startsWith(DOCS_DIR)) {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }
  if (!fs.existsSync(fullOld)) {
    return res.status(404).json({ success: false, error: '源文件不存在' });
  }
  if (fs.existsSync(fullNew)) {
    return res.status(409).json({ success: false, error: '目标名称已存在' });
  }

  try {
    fs.renameSync(fullOld, fullNew);
    res.json({ success: true, newPath });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
