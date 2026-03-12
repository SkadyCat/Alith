const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const app = express();
const PORT = 8331;
const ALICE_PORT = 7439;

const DOCS_DIR = path.join(__dirname, 'data', 'docs');
fs.mkdirSync(DOCS_DIR, { recursive: true });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ─── Helpers ─── */
function safePath(name) {
  // Allow a/b/c style paths but block traversal
  return (name || '').replace(/\.\./g, '').replace(/^[/\\]+/, '').replace(/[/\\]+/g, '/').trim();
}

/* ─── Document API ─── */

const SUPPORTED_EXTS = ['.md', '.json', '.session'];

function fileDisplayName(filename) {
  for (const ext of SUPPORTED_EXTS) {
    if (filename.endsWith(ext)) return filename.slice(0, -ext.length);
  }
  return filename;
}

function isSupportedFile(filename) {
  return SUPPORTED_EXTS.some(ext => filename.endsWith(ext));
}

// Flat list (for sidebar quick-load)
app.get('/docs/api/list', (req, res) => {
  try {
    const results = [];
    function walk(dir, base) {
      fs.readdirSync(dir, { withFileTypes: true }).forEach(item => {
        const rel = base ? `${base}/${item.name}` : item.name;
        if (item.isDirectory()) {
          walk(path.join(dir, item.name), rel);
        } else if (isSupportedFile(item.name)) {
          const stat = fs.statSync(path.join(dir, item.name));
          results.push({ name: rel.replace(/\.(md|json)$/, ''), updatedAt: stat.mtimeMs, size: stat.size });
        }
      });
    }
    walk(DOCS_DIR, '');
    results.sort((a, b) => b.updatedAt - a.updatedAt);
    res.json({ success: true, docs: results });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Tree structure (folders + files, recursive)
app.get('/docs/api/tree', (req, res) => {
  function buildTree(dir, base) {
    const items = [];
    try {
      fs.readdirSync(dir, { withFileTypes: true }).forEach(item => {
        const rel = base ? `${base}/${item.name}` : item.name;
        if (item.isDirectory()) {
          items.push({ type: 'folder', name: item.name, path: rel, children: buildTree(path.join(dir, item.name), rel) });
        } else if (isSupportedFile(item.name)) {
          const stat = fs.statSync(path.join(dir, item.name));
          const ext = SUPPORTED_EXTS.find(e => item.name.endsWith(e)) || '';
          // .md files keep path without extension (backward compat); .json keeps full name
          const filePath = ext === '.md' ? rel.replace(/\.md$/, '') : rel;
          items.push({ type: 'file', name: item.name, path: filePath, displayName: fileDisplayName(item.name), ext, updatedAt: stat.mtimeMs, size: stat.size });
        }
      });
    } catch (_) {}
    return items.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh');
    });
  }
  res.json({ success: true, tree: buildTree(DOCS_DIR, '') });
});

// Get a document
app.get('/docs/api/get', (req, res) => {
  const name = safePath(req.query.name);
  if (!name) return res.json({ success: false, error: 'name required' });
  // Try exact path first, then with .md, then .json
  const candidates = [
    path.join(DOCS_DIR, name),
    path.join(DOCS_DIR, name + '.md'),
    path.join(DOCS_DIR, name + '.json'),
  ];
  const filePath = candidates.find(p => fs.existsSync(p));
  if (!filePath) return res.json({ success: false, error: 'not found' });
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const ext = path.extname(filePath);
    res.json({ success: true, name, content, ext });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Save (create/overwrite) a document — supports sub-paths like "folder/docname"
app.post('/docs/api/save', (req, res) => {
  const { name, content } = req.body || {};
  const safeName = safePath(name);
  if (!safeName) return res.json({ success: false, error: 'name required' });
  // If name already has a supported extension, use it directly; otherwise default to .md
  const hasExt = SUPPORTED_EXTS.some(ext => safeName.endsWith(ext));
  const filePath = path.join(DOCS_DIR, hasExt ? safeName : safeName + '.md');
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content || '', 'utf8');
    res.json({ success: true, name: safeName });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Create a folder
app.post('/docs/api/mkdir', (req, res) => {
  const { name } = req.body || {};
  const safeName = safePath(name);
  if (!safeName) return res.json({ success: false, error: 'name required' });
  const dirPath = path.join(DOCS_DIR, safeName);
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    res.json({ success: true, name: safeName });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Delete a document or folder
app.delete('/docs/api/delete', (req, res) => {
  const name = safePath(req.query.name);
  if (!name) return res.json({ success: false, error: 'name required' });
  // Try exact path, then with each supported extension, then as folder
  const candidates = [
    path.join(DOCS_DIR, name),
    ...SUPPORTED_EXTS.map(ext => path.join(DOCS_DIR, name + ext)),
  ];
  const dirPath = path.join(DOCS_DIR, name);
  try {
    const filePath = candidates.find(p => fs.existsSync(p) && fs.statSync(p).isFile());
    if (filePath) {
      fs.unlinkSync(filePath);
    } else if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    } else {
      return res.json({ success: false, error: 'not found' });
    }
    res.json({ success: true });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Rename a document or folder
app.post('/docs/api/rename', (req, res) => {
  const { oldName, newName } = req.body || {};
  const safOld = safePath(oldName);
  const safNew = safePath(newName);
  if (!safOld || !safNew) return res.json({ success: false, error: 'oldName and newName required' });

  // Check if it's a directory first
  const dirPath = path.join(DOCS_DIR, safOld);
  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
    const newDirPath = path.join(DOCS_DIR, safNew);
    try {
      fs.mkdirSync(path.dirname(newDirPath), { recursive: true });
      fs.renameSync(dirPath, newDirPath);
      return res.json({ success: true, name: safNew, type: 'folder' });
    } catch (e) {
      return res.json({ success: false, error: e.message });
    }
  }

  // Find old file (try exact then with extensions)
  const oldCandidates = [path.join(DOCS_DIR, safOld), ...SUPPORTED_EXTS.map(ext => path.join(DOCS_DIR, safOld + ext))];
  const oldPath = oldCandidates.find(p => fs.existsSync(p) && fs.statSync(p).isFile());
  if (!oldPath) return res.json({ success: false, error: 'not found' });
  const ext = path.extname(oldPath);
  const hasNewExt = SUPPORTED_EXTS.some(e => safNew.endsWith(e));
  const newPath = path.join(DOCS_DIR, hasNewExt ? safNew : safNew + ext);
  try {
    fs.mkdirSync(path.dirname(newPath), { recursive: true });
    fs.renameSync(oldPath, newPath);
    res.json({ success: true, name: safNew, type: 'file' });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Serve elements.json (WBP widget definitions) — stored in docs/config/
const ELEMENTS_FILE = path.join(DOCS_DIR, 'config', 'elements.json');
app.get('/api/elements', (req, res) => {
  try {
    if (!fs.existsSync(ELEMENTS_FILE)) return res.json({ success: false, error: 'elements.json not found' });
    const data = JSON.parse(fs.readFileSync(ELEMENTS_FILE, 'utf8'));
    res.json({ success: true, ...data });
  } catch (e) {
    res.json({ success: false, error: e.message });
  }
});

// Session persistence
const SESSIONS_DIR = path.join(DOCS_DIR, 'sessions');
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

app.get('/api/session/:name', (req, res) => {
  const name = safePath(req.params.name).replace(/\.session$/, '') + '.session';
  const file = path.join(SESSIONS_DIR, name);
  if (!fs.existsSync(file)) return res.json({ success: true, data: null });
  try {
    res.json({ success: true, data: JSON.parse(fs.readFileSync(file, 'utf8')) });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post('/api/session/:name', (req, res) => {
  const name = safePath(req.params.name).replace(/\.session$/, '') + '.session';
  const file = path.join(SESSIONS_DIR, name);
  try {
    fs.writeFileSync(file, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

app.get('/api/sessions', (req, res) => {
  try {
    const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.session'))
      .map(f => {
        const stat = fs.statSync(path.join(SESSIONS_DIR, f));
        return { name: f.replace(/\.session$/, ''), updatedAt: stat.mtimeMs };
      }).sort((a, b) => b.updatedAt - a.updatedAt);
    res.json({ success: true, sessions: files });
  } catch (e) { res.json({ success: false, error: e.message }); }
});

// Proxy: forward agent task requests to Alice (localhost:7439)
function proxyToAlice(req, res, alicePath) {
  const qs = req.method === 'GET' && Object.keys(req.query).length
    ? '?' + new URLSearchParams(req.query).toString()
    : '';
  const body = req.method !== 'GET' ? JSON.stringify(req.body || {}) : '';
  const options = {
    hostname: 'localhost', port: ALICE_PORT,
    path: alicePath + qs,
    method: req.method,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  };
  const proxy = http.request(options, r => {
    let data = '';
    r.on('data', c => data += c);
    r.on('end', () => {
      try { res.json(JSON.parse(data)); } catch { res.status(500).json({ success: false, error: 'proxy parse error' }); }
    });
  });
  proxy.on('error', e => res.status(502).json({ success: false, error: e.message }));
  if (body) proxy.write(body);
  proxy.end();
}

app.post('/proxy/agent/task', (req, res) => proxyToAlice(req, res, '/agent/task'));
app.get('/proxy/agent/task-status', (req, res) => proxyToAlice(req, res, '/agent/task-status'));
app.get('/proxy/agent/chat-history', (req, res) => proxyToAlice(req, res, '/agent/chat-history'));
app.get('/proxy/agent/sessions-list', (req, res) => proxyToAlice(req, res, '/agent/sessions-list'));

app.listen(PORT, () => {
  console.log(`Canvas Editor running at http://localhost:${PORT}`);
});
