/* ============================================
   DocSpace - Application Logic
   ============================================ */

// ===== GLOBAL CONFIG =====
window.ALITH_CONFIG = {
  // Session bubble container: max height in px before scrolling kicks in
  bubbleMaxHeight: 420,
};

// ===== STATE =====
const state = {
  currentFile: null,
  isDirty: false,
  sidebarCollapsed: false,
  allFiles: [],           // for search
};

// ===== FILE TYPE FILTER =====
const FILE_TYPE_DEFAULTS = ['.md', '.json'];
const FILE_TYPE_ALL = ['.md', '.json', '.txt', '.yaml', '.yml', '.toml', '.csv', '.xml', '.html', '.js', '.ts', '.py', '.sh', '.wav', '.mp3', '.ogg', '.m4a'];
const AUDIO_EXTS = new Set(['.wav', '.mp3', '.ogg', '.m4a']);
let activeFileTypes = (() => {
  try {
    const saved = localStorage.getItem('docspace_file_types');
    return saved ? JSON.parse(saved) : [...FILE_TYPE_DEFAULTS];
  } catch { return [...FILE_TYPE_DEFAULTS]; }
})();

function saveFileTypeState() {
  localStorage.setItem('docspace_file_types', JSON.stringify(activeFileTypes));
}

function openFileTypeSettings() {
  const list = document.getElementById('fileTypeList');
  list.innerHTML = '';
  FILE_TYPE_ALL.forEach(ext => {
    const checked = activeFileTypes.includes(ext);
    const item = document.createElement('label');
    item.className = 'filetype-item';
    item.innerHTML = `<input type="checkbox" value="${ext}" ${checked ? 'checked' : ''}><span>${ext}</span>`;
    list.appendChild(item);
  });
  // Show any custom types not in FILE_TYPE_ALL
  activeFileTypes.forEach(ext => {
    if (!FILE_TYPE_ALL.includes(ext)) {
      const item = document.createElement('label');
      item.className = 'filetype-item';
      item.innerHTML = `<input type="checkbox" value="${ext}" checked><span>${ext} <em>(自定义)</em></span>`;
      list.appendChild(item);
    }
  });
  document.getElementById('fileTypeCustomInput').value = '';
  document.getElementById('fileTypeSettingsOverlay').classList.add('show');
}

function closeFileTypeSettings() {
  document.getElementById('fileTypeSettingsOverlay').classList.remove('show');
}

function addCustomFileType() {
  const input = document.getElementById('fileTypeCustomInput');
  let val = input.value.trim().toLowerCase();
  if (!val) return;
  if (!val.startsWith('.')) val = '.' + val;
  const list = document.getElementById('fileTypeList');
  if (list.querySelector(`input[value="${val}"]`)) {
    input.value = '';
    return;
  }
  const item = document.createElement('label');
  item.className = 'filetype-item';
  item.innerHTML = `<input type="checkbox" value="${val}" checked><span>${val} <em>(自定义)</em></span>`;
  list.appendChild(item);
  input.value = '';
}

function applyFileTypeSettings() {
  const checkboxes = document.querySelectorAll('#fileTypeList input[type="checkbox"]');
  activeFileTypes = Array.from(checkboxes).filter(c => c.checked).map(c => c.value);
  if (activeFileTypes.length === 0) activeFileTypes = ['.md'];
  saveFileTypeState();
  closeFileTypeSettings();
  refreshTree();
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  loadFileTree();
  initDragDrop();
  initDocDragTargets();
  setupKeyboardShortcuts();
  setupResizeHandle();
  setupContextMenu();
  initMagicWorldBtn();

  // Auto-save dialogue when any agent config changes
  ['agentHistoryDoc', 'agentTaskPrefix', 'agentModel', 'agentSaveAs', 'agentMaxCont', 'agentUseHistory', 'agentHideTrace', 'agentPeerUrl'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => {
      if (activeDialogueId) saveCurrentDialogue(activeDialogueId);
    });
  });

  // Auto-save PyAgent dialogue when any pyagent config changes
  ['pyagentModel', 'pyagentHistoryDoc', 'pyagentTaskPrefix'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => {
      if (window.activePyAgentSession) saveCurrentPyDialogue(window.activePyAgentSession.id);
    });
  });

  // Real-time file change updates via SSE
  const watchSource = new EventSource('/api/watch');
  watchSource.addEventListener('file-changed', e => {
    const { path: changedPath } = JSON.parse(e.data);
    if (state.currentFile && state.currentFile === changedPath && !state.isDirty) {
      fetch(`/api/file?path=${encodeURIComponent(changedPath)}`)
        .then(r => r.json())
        .then(data => {
          if (data.success) {
            document.getElementById('editorTextarea').value = data.content;
            renderMarkdown(data.html);
          }
        });
    }
  });
  
  // Mark highlight.js renderer
  if (typeof hljs !== 'undefined') {
    const renderer = {
      code(code, language) {
        const validLang = language && hljs.getLanguage(language) ? language : null;
        const highlighted = validLang
          ? hljs.highlight(code, { language: validLang }).value
          : hljs.highlightAuto(code).value;
        return `<pre><code class="hljs language-${validLang || 'text'}">${highlighted}</code></pre>`;
      }
    };
    // We use server-side marked, but highlight on client after render
  }
  // ── Alice poll status bubble ──────────────────────────────────
  startPollBubble();
});

// ===== POLL STATUS BUBBLE =====
let pollBubbleTimer = null;

function startPollBubble() {
  updatePollBubble();
  pollBubbleTimer = setInterval(updatePollBubble, 4000);
}

async function updatePollBubble() {
  try {
    const res = await fetch('/open/poll-status');
    const data = await res.json();
    const bubble = document.getElementById('pollBubble');
    const countEl = document.getElementById('pollBubbleCount');
    if (!bubble) return;

    if (data.status && data.status.trim()) {
      // Parse counter from status like "Waiting for task... (3/20) - 10:30:00"
      const match = data.status.match(/\((\d+)\/(\d+)\)/);
      if (match) {
        countEl.textContent = `${match[1]}/${match[2]}`;
        bubble.title = data.status;
      } else {
        countEl.textContent = '';
        bubble.title = data.status;
      }
      bubble.classList.add('visible');
      bubble.classList.toggle('active', !!data.active);
    } else {
      bubble.classList.remove('visible', 'active');
      countEl.textContent = '';
    }
  } catch {
    // silently ignore network errors
  }
}


async function loadFileTree() {
  try {
    const res = await fetch('/api/tree');
    const data = await res.json();
    state.allFiles = [];
    if (data.success) {
      renderTree(data.tree, document.getElementById('fileTree'));
    }
  } catch (e) {
    document.getElementById('fileTree').innerHTML = 
      '<div class="empty-tree">加载失败，请刷新</div>';
  }
}

function refreshTree() {
  document.getElementById('fileTree').innerHTML = `
    <div class="tree-loading">
      <div class="loading-dots"><span></span><span></span><span></span></div>
    </div>`;
  loadFileTree();
}

function renderTree(items, container, depth = 0) {
  container.innerHTML = '';
  if (items.length === 0) {
    container.innerHTML = `
      <div class="empty-tree">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <div>暂无文档</div>
      </div>`;
    return;
  }
  appendTreeItems(items, container);
}

function appendTreeItems(items, container) {
  items.forEach((item, idx) => {
    const el = document.createElement('div');
    if (item.type === 'folder') {
      el.className = 'tree-folder';
      el.style.animationDelay = `${idx * 0.03}s`;
      el.innerHTML = `
        <span class="tree-folder-icon">📁</span>
        <span class="tree-name">${item.name}</span>
        <span class="tree-chevron">▶</span>`;
      
      const childContainer = document.createElement('div');
      childContainer.className = 'tree-children hidden';
      appendTreeItems(item.children || [], childContainer);
      
      el.addEventListener('click', () => {
        el.classList.toggle('open');
        childContainer.classList.toggle('hidden');
      });
      el.addEventListener('contextmenu', (e) => showContextMenu(e, { type: 'folder', path: item.path }));
      attachFolderDrop(el, item.path);

      container.appendChild(el);
      container.appendChild(childContainer);
    } else {
      // Filter by active file types
      const ext = item.name.includes('.') ? '.' + item.name.split('.').pop().toLowerCase() : '';
      if (!activeFileTypes.includes(ext)) return;

      el.className = 'tree-file';
      el.style.animationDelay = `${idx * 0.03}s`;
      el.dataset.path = item.path;
      el.draggable = true;
      
      const dotIdx = item.name.lastIndexOf('.');
      const nameWithoutExt = dotIdx > 0 ? item.name.slice(0, dotIdx) : item.name;
      const fileExt = dotIdx > 0 ? item.name.slice(dotIdx) : '';
      state.allFiles.push({ name: item.name, path: item.path, el });
      
      const sizeLabel = item.size != null ? `<span class="tree-file-size">${formatBytes(item.size)}</span>` : '';
      el.innerHTML = `
        <span class="tree-file-icon">📄</span>
        <span class="tree-name">${nameWithoutExt}</span>
        <span class="tree-file-ext">${fileExt}</span>${sizeLabel}`;
      
      el.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/doc-path', item.path);
        e.dataTransfer.setData('text/plain', item.path);
        e.dataTransfer.effectAllowed = 'copy';
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
      el.addEventListener('click', () => openFile(item.path));
      el.addEventListener('contextmenu', (e) => showContextMenu(e, { type: 'file', path: item.path }));
      
      if (state.currentFile === item.path) el.classList.add('active');
      
      container.appendChild(el);
    }
  });
}

// ===== DOC DRAG-TO-AGENT TARGETS =====

function initDocDragTargets() {
  const agentPanel = document.getElementById('agentPanel');
  const overlay    = document.getElementById('agentDocDropOverlay');
  const dropName   = document.getElementById('agentDocDropName');
  if (!agentPanel || !overlay) return;

  let panelDragDepth = 0;

  // ── Detect when a *doc* drag enters the agent panel ────────────────────────────
  agentPanel.addEventListener('dragenter', e => {
    if (!isDocDrag(e)) return;
    panelDragDepth++;
    overlay.classList.add('visible');
  });

  agentPanel.addEventListener('dragleave', e => {
    if (!isDocDrag(e)) return;
    // Only hide when cursor truly leaves the panel (not entering a child element)
    if (agentPanel.contains(e.relatedTarget)) return;
    panelDragDepth = 0;
    overlay.classList.remove('visible');
    clearZoneHighlight();
  });

  // Must preventDefault on dragover so drop fires
  agentPanel.addEventListener('dragover', e => {
    if (!isDocDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  // ── Individual drop zones ───────────────────────────────────────────
  const zones = [
    { id: 'dropZoneSysdoc',  fn: addDocToSysdoc   },
    { id: 'dropZoneHistory', fn: setDocAsHistory   },
    { id: 'dropZoneTask',    fn: insertDocIntoTask },
  ];

  zones.forEach(({ id, fn }) => {
    const zone = document.getElementById(id);
    if (!zone) return;

    zone.addEventListener('dragenter', e => {
      if (!isDocDrag(e)) return;
      zone.classList.add('active');
    });
    zone.addEventListener('dragleave', e => {
      if (!zone.contains(e.relatedTarget)) zone.classList.remove('active');
    });
    zone.addEventListener('dragover', e => {
      if (!isDocDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    zone.addEventListener('drop', e => {
      e.preventDefault();
      const docPath = e.dataTransfer.getData('text/doc-path');
      panelDragDepth = 0;
      overlay.classList.remove('visible');
      clearZoneHighlight();
      if (docPath) fn(docPath);
    });
  });

  // Update the doc name label during drag
  // (values are readable only on drop; we use text/plain as a fallback label)
  agentPanel.addEventListener('dragover', e => {
    if (!isDocDrag(e)) return;
    // Try to read plain text (readable during dragover in Chrome)
    try {
      const p = e.dataTransfer.getData('text/plain');
      if (p && dropName.textContent !== p) dropName.textContent = p;
    } catch {}
  });

  function clearZoneHighlight() {
    document.querySelectorAll('.agent-doc-drop-zone.active')
      .forEach(z => z.classList.remove('active'));
  }
}

function isDocDrag(e) {
  return e.dataTransfer && e.dataTransfer.types &&
    e.dataTransfer.types.includes('text/doc-path');
}

function addDocToSysdoc(docPath) {
  if (!selectedSystemDocs.includes(docPath)) {
    selectedSystemDocs.push(docPath);
    renderSysdocTags();
    showToast(`已添务系统设定: ${docPath}`, 'success');
  } else {
    showToast(`「${docPath}」已在系统设定中`, 'info');
  }
}

function setDocAsHistory(docPath) {
  const sel = document.getElementById('agentHistoryDoc');
  if (!sel) return;
  let opt = sel.querySelector(`option[value="${docPath}"]`);
  if (!opt) {
    opt = document.createElement('option');
    opt.value = docPath;
    opt.textContent = docPath;
    sel.appendChild(opt);
  }
  sel.value = docPath;
  sel.dispatchEvent(new Event('change'));
  showToast(`历史文档已设为: ${docPath}`, 'success');
}

function insertDocIntoTask(docPath) {
  const ta = document.getElementById('agentTask');
  if (!ta) return;
  const ref = `@${docPath}`;
  ta.value = ta.value ? `${ta.value}\n${ref}` : ref;
  ta.focus();
  ta.dispatchEvent(new Event('input'));
  showToast(`已插入任务: ${ref}`, 'success');
}

// ===== MAGICWORLD BUTTON =====
// 点击时动态从本地配置读取公网 URL，并确保 MagicWorld 服务正在运行
async function initMagicWorldBtn() {
  const btn = document.getElementById('magicWorldBtn');
  if (!btn) return;
  await refreshMagicWorldBtn(btn);
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    // 先刷新 URL，再在用户手势上下文中立即打开窗口（避免弹窗拦截）
    await refreshMagicWorldBtn(btn);
    const newWin = window.open('about:blank', '_blank');
    // 检查并确保 MagicWorld 服务运行
    try {
      const r = await fetch('/open/magicworld/ensure', { method: 'POST', signal: AbortSignal.timeout(5000) });
      const data = await r.json();
      if (data.starting) {
        // 服务正在启动，轮询等待
        const originalTitle = btn.title;
        btn.title = '🚀 MagicWorld 正在启动，请稍候...';
        btn.style.opacity = '0.6';
        let ready = false;
        for (let i = 0; i < 30; i++) {
          await new Promise(res => setTimeout(res, 2000));
          const s = await fetch('/open/magicworld/status').then(r => r.json()).catch(() => ({}));
          if (s.running) { ready = true; break; }
        }
        btn.style.opacity = '';
        btn.title = originalTitle;
        if (!ready) {
          if (newWin) newWin.close();
          alert('MagicWorld 启动超时，请手动启动后再试');
          return;
        }
      }
    } catch (_) { /* 检测失败时直接跳转 */ }
    if (newWin) newWin.location.href = btn.href;
    else window.open(btn.href, '_blank');
  });
}
async function refreshMagicWorldBtn(btn) {
  try {
    const res = await fetch('/open/app-config/magicworld', { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      const publicIp = data.publicIp || data.publicUrl;
      if (publicIp) {
        const url = publicIp.startsWith('http') ? publicIp : `http://${publicIp}`;
        btn.href = url;
        btn.title = `MagicWorld 图像工作室（公网：${publicIp}）`;
        return;
      }
    }
  } catch (_) { /* ignore */ }
  btn.href = 'http://localhost:8033';
  btn.title = 'MagicWorld 图像工作室';
}

async function updateAlith() {
  const btn = document.getElementById('updateBtn');
  if (!btn) return;
  if (!confirm('从 GitHub 拉取最新代码？\n（更新完成后建议重启服务）')) return;
  btn.disabled = true;
  btn.title = '更新中…';
  const origText = btn.innerHTML;
  btn.innerHTML = btn.innerHTML.replace('更新', '更新中…');
  try {
    const res = await fetch('/open/update', { method: 'POST', signal: AbortSignal.timeout(90000) });
    const data = await res.json();
    const output = [data.stdout, data.stderr].filter(Boolean).join('\n').trim();
    if (data.success) {
      alert('✅ 更新成功！\n\n' + (output || '代码已为最新') + '\n\n建议点击"重启"使新代码生效。');
    } else {
      alert('❌ 更新失败：\n' + output);
    }
  } catch (e) {
    alert('❌ 更新请求失败：' + e.message);
  } finally {
    btn.disabled = false;
    btn.title = '从 GitHub 拉取最新代码';
    btn.innerHTML = origText;
  }
}

async function restartServer() {
  const btn = document.getElementById('restartBtn');
  if (!btn) return;
  if (!confirm('确认重启服务器？重启期间（约3秒）页面将短暂无响应。')) return;
  btn.classList.add('restarting');
  btn.title = '重启中…';
  try {
    await fetch('/api/restart', { method: 'POST' });
  } catch (_) { /* server exits, fetch may throw */ }
  // Poll until server is back
  const poll = async () => {
    try {
      const r = await fetch('/api/tree', { cache: 'no-store' });
      if (r.ok) { location.reload(); return; }
    } catch (_) {}
    setTimeout(poll, 800);
  };
  setTimeout(poll, 2500);
}

// ===== DRAG & DROP UPLOAD =====

// Module-level state for drag tracking
let _dragDropFolder = '';   // active target folder path ('' = root)
let _dragDepth      = 0;    // sidebar enter/leave depth counter

function initDragDrop() {
  const sidebar  = document.getElementById('leftMenu');
  const dropHint = document.getElementById('sidebarDropHint');

  // Prevent browser default file-open for the whole page
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop',     e => { if (hasFiles(e)) e.preventDefault(); });

  sidebar.addEventListener('dragenter', e => {
    if (!hasFiles(e)) return;
    _dragDepth++;
    sidebar.classList.add('drag-over');
  });

  sidebar.addEventListener('dragleave', e => {
    if (!hasFiles(e)) return;
    _dragDepth--;
    if (_dragDepth <= 0) {
      _dragDepth = 0;
      sidebar.classList.remove('drag-over');
      clearAllDropTargets();
      _dragDropFolder = '';
      dropHint.textContent = '\u4e0a\u4f20\u5230\u6839\u76ee\u5f55';
    }
  });

  sidebar.addEventListener('dragover', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  sidebar.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    _dragDepth = 0;
    sidebar.classList.remove('drag-over');
    clearAllDropTargets();
    const folder = _dragDropFolder;
    _dragDropFolder = '';
    dropHint.textContent = '\u4e0a\u4f20\u5230\u6839\u76ee\u5f55';
    uploadFiles(Array.from(e.dataTransfer.files), folder);
  });
}

function hasFiles(e) {
  return e.dataTransfer && e.dataTransfer.types &&
    (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('application/x-moz-file'));
}

function clearAllDropTargets() {
  document.querySelectorAll('.tree-folder.drop-target').forEach(el => el.classList.remove('drop-target'));
}

// Called from appendTreeItems to wire up folder drop targets
function attachFolderDrop(folderEl, folderPath) {
  const dropHint = document.getElementById('sidebarDropHint');

  folderEl.addEventListener('dragenter', e => {
    if (!hasFiles(e)) return;
    // Don't stopPropagation — let sidebar counter work
    clearAllDropTargets();
    folderEl.classList.add('drop-target');
    _dragDropFolder = folderPath;
    dropHint.textContent = `\u4e0a\u4f20\u5230 ${folderPath}`;
  });

  folderEl.addEventListener('dragleave', e => {
    if (!hasFiles(e)) return;
    // Check if we're leaving to outside the folder element
    if (!folderEl.contains(e.relatedTarget)) {
      folderEl.classList.remove('drop-target');
      _dragDropFolder = '';
      dropHint.textContent = '\u4e0a\u4f20\u5230\u6839\u76ee\u5f55';
    }
  });
}

async function uploadFiles(fileList, targetFolder) {
  if (!fileList || fileList.length === 0) return;

  // Show toast placeholder
  const toast = showUploadToast(`上传 ${fileList.length} 个文件…`);

  const filesToSend = [];
  for (const file of fileList) {
    try {
      const { content, encoding } = await readFileForUpload(file);
      filesToSend.push({ name: file.name, content, encoding });
    } catch (err) {
      appendToastItem(toast, `✗ ${file.name}: 读取失败`, 'err');
    }
  }

  if (filesToSend.length === 0) {
    finalizeToast(toast, '无可上传文件');
    return;
  }

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: targetFolder, files: filesToSend })
    });
    const data = await res.json();
    if (data.success) {
      clearToastBody(toast);
      (data.saved || []).forEach(f => appendToastItem(toast, `✓ ${f.name}`, 'ok'));
      (data.errors || []).forEach(e => appendToastItem(toast, `✗ ${e.name}: ${e.error}`, 'err'));
      // Refresh file tree
      await loadFileTree();
      // Auto-open single md file
      if (data.saved.length === 1 && data.saved[0].path.endsWith('.md')) {
        openFile(data.saved[0].path);
      }
    } else {
      appendToastItem(toast, `✗ ${data.error}`, 'err');
    }
  } catch (err) {
    appendToastItem(toast, `✗ 网络错误: ${err.message}`, 'err');
  }

  finalizeToast(toast);
}

function readFileForUpload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    // Try to read as text; for binary files fall back to base64
    const isText = /\.(md|txt|json|yaml|yml|csv|log|sh|bat|ps1|ini|toml|xml|html|css|js|ts)$/i.test(file.name);
    if (isText) {
      reader.onload = () => resolve({ content: reader.result, encoding: 'utf8' });
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file, 'utf-8');
    } else {
      reader.onload = () => {
        // result is data:mime;base64,XXXX  →  strip prefix
        const b64 = reader.result.split(',')[1] || '';
        resolve({ content: b64, encoding: 'base64' });
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    }
  });
}

// ── Toast helpers ────────────────────────────────────────────
function showUploadToast(title) {
  const el = document.createElement('div');
  el.className = 'upload-toast';
  el.innerHTML = `<div class="upload-toast-title">${title}</div><div class="upload-toast-body"></div>`;
  document.body.appendChild(el);
  return el;
}

function appendToastItem(toast, text, type = '') {
  const body = toast.querySelector('.upload-toast-body');
  const item = document.createElement('div');
  item.className = `upload-toast-item ${type ? 'upload-toast-' + type : ''}`;
  item.textContent = text;
  body.appendChild(item);
}

function clearToastBody(toast) {
  const t = toast.querySelector('.upload-toast-title');
  if (t) t.textContent = '上传完成';
  const b = toast.querySelector('.upload-toast-body');
  if (b) b.innerHTML = '';
}

function finalizeToast(toast) {
  setTimeout(() => {
    toast.style.transition = 'opacity 0.4s';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 450);
  }, 3500);
}

// ===== SEARCH / FILTER =====
function filterTree(query) {
  const searchInput = document.getElementById('treeSearchInput');
  const wasFocused = document.activeElement === searchInput;

  // 在所有同步事件处理器完成后（包括可能乘机调用 ta.focus() 的 _runSearch），
  // 如果树搜索框原本有焦点且编辑器搜索面板未打开，则恢复焦点
  const _restoreFocus = () => {
    if (!wasFocused) return;
    requestAnimationFrame(() => {
      if (document.activeElement === searchInput) return; // 焦点还在，无需处理
      const panel = document.getElementById('editorSearchPanel');
      if (panel && panel.style.display === 'block') return; // 用户主动打开编辑器搜索，不干预
      searchInput.focus();
    });
  };

  const q = query.toLowerCase().trim();
  if (!q) {
    loadFileTree().finally(_restoreFocus);
    return;
  }
  
  const container = document.getElementById('fileTree');
  const matched = state.allFiles.filter(f => 
    f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
  );
  
  container.innerHTML = '';
  if (matched.length === 0) {
    container.innerHTML = `<div class="empty-tree">未找到匹配的文档</div>`;
    _restoreFocus();
    return;
  }
  
  matched.forEach(f => {
    const el = document.createElement('div');
    el.className = 'tree-file';
    if (state.currentFile === f.path) el.classList.add('active');
    el.dataset.path = f.path;
    const nameWithoutExt = f.name.replace(/\.md$/, '');
    const highlighted = nameWithoutExt.replace(
      new RegExp(q, 'gi'), 
      m => `<mark style="background:var(--accent-dim);color:var(--text-accent);border-radius:2px;">${m}</mark>`
    );
    el.innerHTML = `
      <span class="tree-file-icon">📄</span>
      <span class="tree-name">${highlighted}</span>
      <span class="tree-file-ext" style="margin-left:auto;font-size:10px;color:var(--text-muted)">${f.path}</span>`;
    el.addEventListener('click', () => openFile(f.path));
    container.appendChild(el);
  });
  _restoreFocus();
}

// ===== OPEN FILE =====
async function openFile(filePath) {
  try {
    // ── 音频文件：显示播放器 ─────────────────────────────────
    const ext = filePath.includes('.') ? '.' + filePath.split('.').pop().toLowerCase() : '';
    if (AUDIO_EXTS.has(ext)) {
      openAudioFile(filePath);
      return;
    }

    const res = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
    const data = await res.json();
    if (!data.success) {
      showToast('文件加载失败', 'error');
      return;
    }
    
    state.currentFile = filePath;
    state.isDirty = false;
    
    // Update UI
    document.getElementById('welcomeScreen').style.display = 'none';
    document.getElementById('docArea').style.display = 'flex';
    document.getElementById('saveBtn').style.display = 'flex';
    
    // Always show split: editor left, preview right
    const editorPane = document.getElementById('editorPane');
    const previewPane = document.getElementById('previewPane');
    const splitDivider = document.getElementById('splitDivider');
    editorPane.style.display = 'flex';
    editorPane.style.flex = '1';
    splitDivider.style.display = 'block';
    previewPane.style.display = 'flex';
    previewPane.style.flex = '1';
    document.getElementById('previewHeader').style.display = 'flex';
    
    // Set content
    document.getElementById('editorTextarea').value = data.content;
    renderMarkdown(data.html);
    
    // Update breadcrumb & title
    updateBreadcrumb(filePath);
    const name = filePath.split('/').pop().replace(/\.md$/, '');
    document.getElementById('docTitle').textContent = name;
    document.title = `${name} — DocSpace`;
    
    // Update active state in tree
    document.querySelectorAll('.tree-file').forEach(el => {
      el.classList.toggle('active', el.dataset.path === filePath);
    });
    
    // Focus editor
    document.getElementById('editorTextarea').focus();
    
  } catch (e) {
    showToast('网络错误', 'error');
  }
}

function openAudioFile(filePath) {
  state.currentFile = filePath;
  state.isDirty = false;

  // Hide normal doc UI, show welcome area (reused as audio player container)
  document.getElementById('welcomeScreen').style.display = 'none';
  document.getElementById('saveBtn').style.display = 'none';
  document.getElementById('docArea').style.display = 'flex';

  // Hide editor + divider, use full preview pane for audio player
  const editorPane = document.getElementById('editorPane');
  const splitDivider = document.getElementById('splitDivider');
  const previewPane = document.getElementById('previewPane');
  const previewHeader = document.getElementById('previewHeader');
  editorPane.style.display = 'none';
  splitDivider.style.display = 'none';
  previewPane.style.display = 'flex';
  previewPane.style.flex = '1';
  previewHeader.style.display = 'none';

  const name = filePath.split('/').pop();
  const audioUrl = `/open/audio?path=${encodeURIComponent(filePath)}`;

  document.getElementById('markdownBody').innerHTML = `
    <div class="audio-player-wrap">
      <div class="audio-player-icon">🎵</div>
      <div class="audio-player-name">${escapeHtml(name)}</div>
      <audio class="audio-player-el" controls preload="metadata" src="${audioUrl}">
        您的浏览器不支持 audio 标签
      </audio>
      <div class="audio-player-path">${escapeHtml(filePath)}</div>
    </div>`;

  updateBreadcrumb(filePath);
  document.getElementById('docTitle').textContent = name;
  document.title = `${name} — DocSpace`;

  document.querySelectorAll('.tree-file').forEach(el => {
    el.classList.toggle('active', el.dataset.path === filePath);
  });
}

function renderMarkdown(html) {
  const body = document.getElementById('markdownBody');
  body.innerHTML = html;
  // Highlight code blocks
  body.querySelectorAll('pre code').forEach(el => {
    if (typeof hljs !== 'undefined') {
      hljs.highlightElement(el);
    }
  });
  // Scroll to top
  body.scrollTop = 0;
}

function updateBreadcrumb(filePath) {
  const parts = filePath.split('/');
  const breadcrumb = document.getElementById('breadcrumb');
  let html = '<span class="breadcrumb-home">主页</span>';
  parts.forEach((part, i) => {
    const name = i === parts.length - 1 ? part.replace(/\.md$/, '') : part;
    html += `<span class="breadcrumb-sep">›</span>`;
    html += `<span class="breadcrumb-item">${name}</span>`;
  });
  breadcrumb.innerHTML = html;
}

// ===== EDITOR =====
let renderDebounce = null;

function onEditorInput() {
  state.isDirty = true;
  clearTimeout(renderDebounce);
  
  // Always re-render preview in real time
  renderDebounce = setTimeout(async () => {
    const content = document.getElementById('editorTextarea').value;
    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      const data = await res.json();
      if (data.success) {
        const body = document.getElementById('markdownBody');
        const scrollTop = body.scrollTop;
        renderMarkdown(data.html);
        body.scrollTop = scrollTop;
      }
    } catch (e) {}
  }, 300);
  
  // Show unsaved indicator
  const title = state.currentFile ? 
    state.currentFile.split('/').pop().replace(/\.md$/, '') : '';
  document.getElementById('docTitle').textContent = `● ${title}`;
}

function onEditorKeydown(e) {
  // Tab indentation
  if (e.key === 'Tab') {
    e.preventDefault();
    const textarea = e.target;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + 2;
  }
  // Ctrl+F — open search panel
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    e.stopPropagation();
    openEditorSearch();
  }
}

// ===== EDITOR SEARCH (VSCode-style) =====
const _search = {
  matches: [],    // [{start, end}, ...]
  current: -1,
  caseSensitive: false,
  useRegex: false,
};

function openEditorSearch() {
  const panel = document.getElementById('editorSearchPanel');
  panel.style.display = 'block';
  const input = document.getElementById('searchInput');
  // Pre-fill with selected text
  const ta = document.getElementById('editorTextarea');
  const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
  if (sel && !sel.includes('\n')) input.value = sel;
  // Defer focus to next tick so browser doesn't steal it back after keydown
  setTimeout(() => { input.focus(); input.select(); }, 0);
  _runSearch();
}

function closeEditorSearch() {
  document.getElementById('editorSearchPanel').style.display = 'none';
  _search.matches = [];
  _search.current = -1;
  document.getElementById('editorTextarea').focus();
}

function toggleReplaceRow() {
  const row = document.getElementById('replaceRow');
  const chevron = document.getElementById('replaceChevron');
  const open = row.style.display === 'none';
  row.style.display = open ? 'flex' : 'none';
  chevron.style.transform = open ? 'rotate(90deg)' : '';
  if (open) document.getElementById('replaceInput').focus();
}

function _buildPattern(term) {
  if (!term) return null;
  if (_search.useRegex) {
    try { return new RegExp(term, _search.caseSensitive ? 'g' : 'gi'); }
    catch { return null; }
  }
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, _search.caseSensitive ? 'g' : 'gi');
}

function _runSearch() {
  // 仅在编辑器搜索面板明确打开时执行，防止被其他输入框（如文件树搜索）意外触发
  const panel = document.getElementById('editorSearchPanel');
  if (!panel || panel.style.display !== 'block') return;

  const term = document.getElementById('searchInput').value;
  const ta = document.getElementById('editorTextarea');
  const countEl = document.getElementById('searchCount');
  const wrap = document.querySelector('.search-input-wrap');
  _search.matches = [];
  _search.current = -1;

  if (!term) {
    countEl.textContent = '';
    wrap.classList.remove('search-no-result');
    countEl.classList.remove('no-result');
    _updateNavButtons();
    return;
  }

  const pat = _buildPattern(term);
  if (!pat) {
    countEl.textContent = '无效正则';
    wrap.classList.add('search-no-result');
    _updateNavButtons();
    return;
  }

  const text = ta.value;
  let m;
  while ((m = pat.exec(text)) !== null) {
    _search.matches.push({ start: m.index, end: m.index + m[0].length });
    if (pat.lastIndex === m.index) pat.lastIndex++; // guard infinite loop
  }

  const total = _search.matches.length;
  if (total === 0) {
    countEl.textContent = '无结果';
    countEl.classList.add('no-result');
    wrap.classList.add('search-no-result');
  } else {
    wrap.classList.remove('search-no-result');
    countEl.classList.remove('no-result');
    // Select first match after cursor or first overall
    const cur = ta.selectionStart;
    let idx = _search.matches.findIndex(m => m.start >= cur);
    if (idx < 0) idx = 0;
    _search.current = idx;
    _highlightMatch(idx);
    countEl.textContent = `${idx + 1} / ${total}`;
  }
  _updateNavButtons();
}

function _highlightMatch(idx) {
  if (idx < 0 || idx >= _search.matches.length) return;
  const ta = document.getElementById('editorTextarea');
  const m = _search.matches[idx];
  // 只有编辑器搜索面板明确打开（display==='block'）时才操作 editor，
  // 防止文件树搜索等其他输入框触发时隐式聚焦 editorTextarea 抢走焦点
  const panel = document.getElementById('editorSearchPanel');
  if (!panel || panel.style.display !== 'block') return;
  ta.focus();
  ta.setSelectionRange(m.start, m.end);
  // Scroll into view (approximate line height)
  const linesBefore = ta.value.substring(0, m.start).split('\n').length - 1;
  const lineH = parseInt(getComputedStyle(ta).lineHeight) || 20;
  ta.scrollTop = Math.max(0, linesBefore * lineH - ta.clientHeight / 2);
  document.getElementById('searchCount').textContent =
    `${idx + 1} / ${_search.matches.length}`;
}

function _updateNavButtons() {
  const has = _search.matches.length > 0;
  document.getElementById('searchPrev').disabled = !has;
  document.getElementById('searchNext').disabled = !has;
}

function navigateSearch(dir) {
  if (!_search.matches.length) return;
  _search.current = (_search.current + dir + _search.matches.length) % _search.matches.length;
  _highlightMatch(_search.current);
}

function replaceCurrentMatch() {
  if (_search.current < 0 || !_search.matches.length) return;
  const ta = document.getElementById('editorTextarea');
  const replacement = document.getElementById('replaceInput').value;
  const m = _search.matches[_search.current];
  ta.focus();
  ta.setSelectionRange(m.start, m.end);
  document.execCommand('insertText', false, replacement);
  _runSearch();
}

function replaceAllMatches() {
  const ta = document.getElementById('editorTextarea');
  const term = document.getElementById('searchInput').value;
  const replacement = document.getElementById('replaceInput').value;
  if (!term) return;
  const pat = _buildPattern(term);
  if (!pat) return;
  const newVal = ta.value.replace(pat, replacement);
  ta.value = newVal;
  onEditorInput(); // trigger preview re-render & dirty flag
  _runSearch();
}

// Wire up live search on input
(function _initSearch() {
  const ready = () => {
    const input = document.getElementById('searchInput');
    if (!input) { setTimeout(ready, 200); return; }
    input.addEventListener('input', _runSearch);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        navigateSearch(e.shiftKey ? -1 : 1);
      }
      if (e.key === 'Escape') closeEditorSearch();
    });
    document.getElementById('searchCaseSensitive').addEventListener('click', function() {
      _search.caseSensitive = !_search.caseSensitive;
      this.setAttribute('aria-pressed', _search.caseSensitive);
      _runSearch();
    });
    document.getElementById('searchRegex').addEventListener('click', function() {
      _search.useRegex = !_search.useRegex;
      this.setAttribute('aria-pressed', _search.useRegex);
      _runSearch();
    });
    document.getElementById('replaceInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); replaceCurrentMatch(); }
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();

// ===== SAVE =====
async function saveFile() {
  if (!state.currentFile) return;
  
  const content = document.getElementById('editorTextarea').value;
  const saveBtn = document.getElementById('saveBtn');
  saveBtn.disabled = true;
  
  try {
    const res = await fetch('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: state.currentFile, content })
    });
    const data = await res.json();
    
    if (data.success) {
      state.isDirty = false;
      renderMarkdown(data.html);
      
      const name = state.currentFile.split('/').pop().replace(/\.md$/, '');
      document.getElementById('docTitle').textContent = name;
      document.title = `${name} — DocSpace`;
      
      showToast('✓ 保存成功', 'success');
    } else {
      showToast('保存失败', 'error');
    }
  } catch (e) {
    showToast('网络错误', 'error');
  } finally {
    saveBtn.disabled = false;
  }
}

// ===== NEW FILE / FOLDER =====
let _modalType = 'file';   // 'file' | 'folder'

function showNewFileDialog(prefix = '', type = 'file') {
  _modalType = type;
  const isFolder = type === 'folder';
  document.getElementById('modalTitle').textContent = isFolder ? '新建文件夹' : '新建文档';
  document.getElementById('modalLabel').innerHTML = isFolder
    ? '文件夹名称'
    : '文件名 <span class="hint">(.md 可省略)</span>';
  document.getElementById('modalCreateBtn').textContent = isFolder ? '创建文件夹' : '创建';
  const input = document.getElementById('newFileName');
  input.value = prefix ? prefix + '/' : '';
  input.placeholder = isFolder
    ? (prefix ? `在 ${prefix}/ 内新建` : '例如: notes 或 api/v2')
    : (prefix ? `${prefix}/文件名` : '例如: my-document 或 notes/todo');
  document.getElementById('modalOverlay').classList.add('show');
  setTimeout(() => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, 50);
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('show');
  document.getElementById('newFileName').value = '';
}

async function createNewItem() {
  const name = document.getElementById('newFileName').value.trim();
  if (!name) return;
  if (_modalType === 'folder') {
    try {
      const res = await fetch('/api/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: name })
      });
      const data = await res.json();
      if (data.success) {
        closeModal();
        await loadFileTree();
        showToast('✓ 文件夹已创建', 'success');
      } else {
        showToast(data.error || '创建失败', 'error');
      }
    } catch (e) { showToast('网络错误', 'error'); }
  } else {
    try {
      const res = await fetch('/api/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: name })
      });
      const data = await res.json();
      if (data.success) {
        closeModal();
        await loadFileTree();
        setTimeout(() => openFile(data.path), 100);
        showToast('✓ 文档已创建', 'success');
      } else {
        showToast(data.error || '创建失败', 'error');
      }
    } catch (e) { showToast('网络错误', 'error'); }
  }
}

// 兼容旧调用
function createNewFile() { createNewItem(); }

// ===== SIDEBAR TOGGLE =====
document.getElementById('sidebarToggle').addEventListener('click', () => {
  const sidebar = document.getElementById('leftMenu');
  const handle = document.getElementById('resizeHandle');
  state.sidebarCollapsed = !state.sidebarCollapsed;
  sidebar.classList.toggle('collapsed', state.sidebarCollapsed);
  handle.style.display = state.sidebarCollapsed ? 'none' : '';
});

// ===== RESIZE HANDLE =====
function setupResizeHandle() {
  const handle = document.getElementById('resizeHandle');
  const sidebar = document.getElementById('leftMenu');
  let isResizing = false;
  let startX, startWidth;
  
  handle.addEventListener('mousedown', (e) => {
    isResizing = true;
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    handle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const delta = e.clientX - startX;
    const newWidth = Math.min(420, Math.max(160, startWidth + delta));
    sidebar.style.width = `${newWidth}px`;
    sidebar.style.minWidth = `${newWidth}px`;
  });
  
  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      handle.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
  });
}

// ===== KEYBOARD SHORTCUTS =====
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveFile();
    }
    // Ctrl+F — open editor search if a file is open
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      const docArea = document.getElementById('docArea');
      if (docArea && docArea.style.display !== 'none') {
        e.preventDefault();
        e.stopPropagation();
        openEditorSearch();
      }
    }
    if (e.key === 'Escape') {
      // Close search panel first if visible
      const searchPanel = document.getElementById('editorSearchPanel');
      if (searchPanel && searchPanel.style.display !== 'none') {
        closeEditorSearch();
        return;
      }
      closeModal();
      hideContextMenu();
      // 关闭 Agent 面板（如果已打开）
      const agentPanel = document.getElementById('agentPanel');
      if (agentPanel && agentPanel.classList.contains('open')) {
        toggleAgentPanel();
      }
    }
  });
}

// ===== CONTEXT MENU =====
// target: { type: 'file'|'folder'|'root', path?: string }
let contextMenuTarget = null;

function setupContextMenu() {
  document.addEventListener('click', hideContextMenu);

  document.getElementById('ctxNewFile').addEventListener('click', () => {
    const prefix = contextMenuTarget && contextMenuTarget.type === 'folder' ? contextMenuTarget.path : '';
    hideContextMenu();
    showNewFileDialog(prefix, 'file');
  });

  document.getElementById('ctxNewFolder').addEventListener('click', () => {
    const prefix = contextMenuTarget && contextMenuTarget.type === 'folder' ? contextMenuTarget.path : '';
    hideContextMenu();
    showNewFileDialog(prefix, 'folder');
  });

  document.getElementById('ctxCopyPath').addEventListener('click', () => {
    if (contextMenuTarget && contextMenuTarget.path) {
      navigator.clipboard.writeText(contextMenuTarget.path).then(() => {
        showToast('✓ 路径已复制', 'success');
      }).catch(() => {
        showToast('复制失败', 'error');
      });
    }
    hideContextMenu();
  });

  document.getElementById('ctxRename').addEventListener('click', () => {
    if (contextMenuTarget) renameItem(contextMenuTarget);
    hideContextMenu();
  });

  document.getElementById('ctxOpenFolder').addEventListener('click', async () => {
    if (contextMenuTarget && contextMenuTarget.path) {
      try {
        const r = await fetch('/open/open-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: contextMenuTarget.path, select: contextMenuTarget.type === 'file' }),
        });
        const d = await r.json();
        if (!d.success) showToast('打开失败: ' + d.error, 'error');
      } catch (e) {
        showToast('打开失败: ' + e.message, 'error');
      }
    }
    hideContextMenu();
  });

  document.getElementById('ctxDelete').addEventListener('click', () => {
    if (contextMenuTarget && contextMenuTarget.type === 'file') deleteFile(contextMenuTarget.path);
    else if (contextMenuTarget && contextMenuTarget.type === 'folder') deleteFolder(contextMenuTarget.path);
    hideContextMenu();
  });

  // 右键文件树空白区域
  document.getElementById('fileTree').addEventListener('contextmenu', (e) => {
    if (!e.target.closest('.tree-file, .tree-folder')) {
      showContextMenu(e, { type: 'root' });
    }
  });
}

function showContextMenu(e, target) {
  e.preventDefault();
  e.stopPropagation();
  contextMenuTarget = typeof target === 'string' ? { type: 'file', path: target } : target;
  const isRoot = contextMenuTarget.type === 'root';
  const isFile = contextMenuTarget.type === 'file';
  document.getElementById('ctxCopyPath').style.display = isRoot ? 'none' : 'flex';
  document.getElementById('ctxRename').style.display = isRoot ? 'none' : 'flex';
  document.getElementById('ctxOpenFolder').style.display = isRoot ? 'none' : 'flex';
  document.getElementById('ctxDelete').style.display = isRoot ? 'none' : 'flex';
  document.getElementById('ctxDivider').style.display = isRoot ? 'none' : 'block';
  const menu = document.getElementById('contextMenu');
  // 防止超出视口
  const x = Math.min(e.clientX, window.innerWidth - 180);
  const y = Math.min(e.clientY, window.innerHeight - 120);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  menu.classList.add('show');
}

function hideContextMenu() {
  document.getElementById('contextMenu').classList.remove('show');
}

async function deleteFile(filePath) {
  if (!confirm(`确定要删除 "${filePath}" 吗？此操作不可撤销。`)) return;
  
  try {
    const res = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    
    if (data.success) {
      if (state.currentFile === filePath) {
        state.currentFile = null;
        document.getElementById('docArea').style.display = 'none';
        document.getElementById('welcomeScreen').style.display = 'flex';
        document.getElementById('saveBtn').style.display = 'none';
        document.getElementById('docTitle').textContent = '选择或创建文档';
        document.getElementById('breadcrumb').innerHTML = '<span class="breadcrumb-home">主页</span>';
        document.title = '📚 文档中心';
      }
      await loadFileTree();
      showToast('✓ 已删除', 'success');
    } else {
      showToast('删除失败', 'error');
    }
  } catch (e) {
    showToast('网络错误', 'error');
  }
}

async function deleteFolder(folderPath) {
  if (!confirm(`确定要删除文件夹 "${folderPath}" 及其所有内容吗？此操作不可撤销。`)) return;

  try {
    const res = await fetch(`/api/folder?path=${encodeURIComponent(folderPath)}`, {
      method: 'DELETE'
    });
    const data = await res.json();

    if (data.success) {
      if (state.currentFile && state.currentFile.startsWith(folderPath + '/')) {
        state.currentFile = null;
        document.getElementById('docArea').style.display = 'none';
        document.getElementById('welcomeScreen').style.display = 'flex';
        document.getElementById('saveBtn').style.display = 'none';
        document.getElementById('docTitle').textContent = '选择或创建文档';
        document.getElementById('breadcrumb').innerHTML = '<span class="breadcrumb-home">主页</span>';
        document.title = '📚 文档中心';
      }
      await loadFileTree();
      showToast('✓ 文件夹已删除', 'success');
    } else {
      showToast('删除失败', 'error');
    }
  } catch (e) {
    showToast('网络错误', 'error');
  }
}

async function renameItem(target) {
  const oldPath = target.path;
  const parts = oldPath.split('/');
  const oldName = parts[parts.length - 1];
  const newName = prompt('请输入新名称：', oldName);
  if (!newName || newName === oldName) return;

  parts[parts.length - 1] = newName;
  const newPath = parts.join('/');

  try {
    const res = await fetch('/open/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPath, newPath })
    });
    const data = await res.json();

    if (data.success) {
      if (target.type === 'file' && state.currentFile === oldPath) {
        state.currentFile = data.newPath;
        document.getElementById('docTitle').textContent = newName.replace(/\.md$/, '');
        document.title = `📄 ${newName.replace(/\.md$/, '')}`;
      } else if (target.type === 'folder' && state.currentFile && state.currentFile.startsWith(oldPath + '/')) {
        state.currentFile = state.currentFile.replace(oldPath, newPath);
      }
      await loadFileTree();
      showToast('✓ 已重命名', 'success');
    } else {
      showToast(data.error || '重命名失败', 'error');
    }
  } catch (e) {
    showToast('网络错误', 'error');
  }
}

// ===== TOAST =====
let toastTimer = null;
function showToast(message, type = '') {
  let toast = document.getElementById('toast-el');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast-el';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `toast ${type}`;
  // Force reflow
  toast.offsetHeight;
  toast.classList.add('show');
  
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2400);
}

// ===== AGENT PANEL =====
let agentEventSource = null;
let agentRunning = false;
let agentElapsedTimer = null;
let agentStartTime = null;
let pendingContinueTask = null;  // 用户请求继续时暂存的追加任务
let agentMdBuffer = '';      // 累计 stdout 用于 实时 Markdown 渲染
let agentMdBlock = null;     // <div class="agent-md-block"> 引用
let agentMdTimer = null;     // Markdown 渲染防抖定时器
let agentMaxTokens = 64000;  // 当前模型的最大 Token
let selectedSystemDocs = []; // 已选系统设定文档列表
let selectedPySystemDocs = []; // PyAgent 已选系统设定文档
let _sysdocTarget = 'agent'; // 'agent' | 'pyagent'
let allDocsList = [];        // 弹窗缓存的全部文档
let _permLocked = false;     // 权限确认栏锁定标志，防止被其它事件覆盖
let _contextPressure = false;    // Token 使用达到 80% 阈值
let _contextCompressing = false; // 自动压缩任务进行中

// ── 每会话狠立状态 ──────────────────────────────────────────
const sessionSources = new Map(); // sessionId → EventSource
const sessionStates  = new Map(); // sessionId → { outputHtml, mdBuffer, running, permLocked, pendingContinueTask }

function getActiveSessionId() {
  return activeDialogueId || 'default';
}

function ensureSessionState(sid) {
  if (!sessionStates.has(sid)) {
    sessionStates.set(sid, {
      outputHtml: '',
      mdBuffer: '',
      running: false,
      permLocked: false,
      pendingContinueTask: null,
    });
  }
  return sessionStates.get(sid);
}

function saveCurrentSessionOutput() {
  const sid = getActiveSessionId();
  const st = ensureSessionState(sid);
  st.outputHtml           = document.getElementById('agentOutput').innerHTML;
  st.mdBuffer             = agentMdBuffer;
  st.running              = agentRunning;
  st.permLocked           = _permLocked;
  st.pendingContinueTask  = pendingContinueTask;
  // 保存 UI 状态
  const dot = document.getElementById('agentStatusDot');
  const lbl = document.getElementById('agentStatusText');
  st.statusClass = dot ? dot.className : '';
  st.statusText  = lbl ? lbl.textContent : '';
  st.elapsed     = document.getElementById('agentElapsed').textContent || '';
  st.startBtnDisabled = document.getElementById('agentStartBtn').disabled;
  st.stopBtnDisabled  = document.getElementById('agentStopBtn').disabled;
  const confirmBar = document.getElementById('agentConfirmBar');
  st.confirmBarVisible = confirmBar ? confirmBar.style.display !== 'none' : false;
}

function restoreSessionOutput(sid) {
  const st = ensureSessionState(sid);
  const output = document.getElementById('agentOutput');
  output.innerHTML        = st.outputHtml || '';
  agentMdBuffer           = st.mdBuffer || '';
  agentMdBlock            = output.querySelector('.agent-md-block:last-of-type') || null;
  agentRunning            = st.running || false;
  _permLocked             = st.permLocked || false;
  pendingContinueTask     = st.pendingContinueTask || null;
  output.scrollTop        = output.scrollHeight;
  // 恢复 UI 状态
  if (st.statusClass) {
    const dot = document.getElementById('agentStatusDot');
    const lbl = document.getElementById('agentStatusText');
    if (dot) dot.className = st.statusClass;
    if (lbl) lbl.textContent = st.statusText || '';
  }
  document.getElementById('agentElapsed').textContent = st.elapsed || '';
  document.getElementById('agentStartBtn').disabled = !!st.startBtnDisabled;
  document.getElementById('agentStopBtn').disabled  = !!st.stopBtnDisabled;
  if (st.confirmBarVisible) {
    const bar = document.getElementById('agentConfirmBar');
    if (bar) bar.style.display = 'flex';
  }
  if (st.running) { startElapsedTimer(); } else { clearInterval(agentElapsedTimer); }
}

// Markdown 防抖渲染
function scheduleMdRender() {
  clearTimeout(agentMdTimer);
  agentMdTimer = setTimeout(() => {
    if (!agentMdBlock) return;
    agentMdBlock.innerHTML = marked.parse(agentMdBuffer);
    agentMdBlock.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
    const output = document.getElementById('agentOutput');
    output.scrollTop = output.scrollHeight;
  }, 80);
}

// Token 计数显示
function updateTokenCounter(tokenEst) {
  const el = document.getElementById('agentTokenCounter');
  if (!el) return;
  const pct = Math.min(100, Math.round(tokenEst / agentMaxTokens * 100));
  const color = pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : 'var(--text-muted)';
  el.style.color = color;
  el.textContent = `Token ~${tokenEst.toLocaleString()} / ${agentMaxTokens.toLocaleString()} (${pct}%)`;
  if (pct >= 80 && agentRunning && !_contextCompressing) {
    _contextPressure = true;
  }
}

// 加载历史文档列表
async function loadHistoryDocs() {
  try {
    const res = await fetch('/agent/history-docs');
    const data = await res.json();
    const docs = data.docs || [];

    function fillHistorySel(selId, currentVal) {
      const sel = document.getElementById(selId);
      if (!sel) return;
      sel.innerHTML = '<option value="">— 不记录历史 —</option>';
      docs.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p.replace(/\.md$/, '');
        if (p === currentVal) opt.selected = true;
        sel.appendChild(opt);
      });
      if (currentVal && !sel.querySelector(`option[value="${currentVal}"]`)) {
        const opt = document.createElement('option');
        opt.value = currentVal;
        opt.textContent = currentVal.replace(/\.md$/, '');
        opt.selected = true;
        sel.appendChild(opt);
      }
    }

    const sel = document.getElementById('agentHistoryDoc');
    const activeSession = activeDialogueId ? dialogueSessions.find(s => s.id === activeDialogueId) : null;
    fillHistorySel('agentHistoryDoc', (activeSession && activeSession.historyDoc) || (sel && sel.value));

    const pySel = document.getElementById('pyagentHistoryDoc');
    fillHistorySel('pyagentHistoryDoc', pySel && pySel.value);
  } catch (e) {}
}

async function createHistoryDoc() {
  const name = prompt('新建历史文档名称\n（存入 docs/history/ 目录，可包含子目录 如 project/session1）');
  if (!name || !name.trim()) return;
  try {
    const res = await fetch('/agent/history-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    const data = await res.json();
    if (!data.success) { showToast(data.error, 'error'); return; }
    showToast(`已创建: history/${data.path}`, 'success');
    await loadHistoryDocs();
    // 自动选中新建的并保存到会话
    const sel = document.getElementById('agentHistoryDoc');
    for (const opt of sel.options) {
      if (opt.value === data.path) { opt.selected = true; break; }
    }
    sel.dispatchEvent(new Event('change'));
    loadFileTree(); // 刷新左侧文件树
  } catch (e) {
    showToast('创建失败: ' + e.message, 'error');
  }
}

async function createPyHistoryDoc() {
  const name = prompt('新建历史文档名称\n（存入 docs/history/ 目录，可包含子目录 如 project/session1）');
  if (!name || !name.trim()) return;
  try {
    const res = await fetch('/agent/history-docs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    });
    const data = await res.json();
    if (!data.success) { showToast(data.error, 'error'); return; }
    showToast(`已创建: history/${data.path}`, 'success');
    await loadHistoryDocs();
    // 自动选中新建的（PyAgent 选择器）并保存到会话
    const sel = document.getElementById('pyagentHistoryDoc');
    if (sel) {
      for (const opt of sel.options) {
        if (opt.value === data.path) { opt.selected = true; break; }
      }
    }
    if (window.activePyAgentSession) saveCurrentPyDialogue(window.activePyAgentSession.id);
    loadFileTree();
  } catch (e) {
    showToast('创建失败: ' + e.message, 'error');
  }
}

// ── 历史文件实时轮询（1秒）─────────────────────────────────────
let _historyPoller = null;
let _historyLastContent = '';

function startHistoryPolling() {
  if (_historyPoller) return;
  _historyPoller = setInterval(async () => {
    const docName = document.getElementById('agentHistoryDoc')?.value;
    if (!docName) return;
    try {
      const res = await fetch('/api/file?path=' + encodeURIComponent('history/' + docName));
      const data = await res.json();
      if (!data.success) return;
      if (data.content === _historyLastContent) return;
      _historyLastContent = data.content;
      // 渲染到会话区域
      const output = document.getElementById('agentOutput');
      const div = document.createElement('div');
      div.className = 'agent-md-block agent-history-view';
      div.innerHTML = data.html || marked.parse(data.content || '');
      div.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
      output.innerHTML = '';
      output.appendChild(div);
      output.scrollTop = output.scrollHeight;
      // 同步内部状态
      agentMdBuffer = '';
      agentMdBlock = null;
    } catch (_) {}
  }, 1000);
}

function stopHistoryPolling() {
  if (_historyPoller) { clearInterval(_historyPoller); _historyPoller = null; }
  _historyLastContent = '';
}

async function loadAgentModels() {
  try {
    const res = await fetch('/agent/models');
    const data = await res.json();
    const models = data.models || [];

    function fillModelSelect(selId, preserveVal) {
      const sel = document.getElementById(selId);
      if (!sel) return;
      const current = preserveVal || sel.value;
      sel.innerHTML = '';
      models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.label + (m.maxTokens >= 1000000 ? ' ★' : '');
        opt.dataset.maxTokens = m.maxTokens;
        sel.appendChild(opt);
      });
      const restored = current && sel.querySelector(`[value="${CSS.escape(current)}"]`);
      const pref = restored || sel.querySelector('[value="claude-sonnet-4.6"]');
      if (pref) pref.selected = true;
      return sel;
    }

    const sel = fillModelSelect('agentModel');
    if (sel) {
      const pref = sel.options[sel.selectedIndex];
      agentMaxTokens = parseInt(pref && pref.dataset.maxTokens) || 64000;
      updateTokenCounter(0);
    }
    fillModelSelect('pyagentModel');
  } catch (e) {}
}

function onModelChange() {
  const sel = document.getElementById('agentModel');
  const opt = sel.options[sel.selectedIndex];
  agentMaxTokens = parseInt(opt.dataset.maxTokens) || 64000;
  updateTokenCounter(0);
  if (activeDialogueId) saveCurrentDialogue(activeDialogueId);
}

function onPyModelChange() {
  if (window.activePyAgentSession) saveCurrentPyDialogue(window.activePyAgentSession.id);
}

function toggleAgentPanel() {
  const panel = document.getElementById('agentPanel');
  const sessionPanel = document.getElementById('sessionPanel');
  const btn = document.getElementById('agentToggleBtn');
  const isOpen = panel.classList.toggle('open');
  btn.classList.toggle('active', isOpen);
  sessionPanel.classList.toggle('open', isOpen);
  document.body.classList.toggle('agent-panel-open', isOpen);
  if (isOpen) {
    populateAgentDocSelector();
    loadAgentModels();
    loadHistoryDocs();
    loadTaskPrefixDocs();
    // loadDialogues 完成后，若尚未连接则加载当前会话历史
    loadDialogues().then(() => {
      const sid = getActiveSessionId();
      if (!sessionSources.has(sid)) {
        const activeSession = activeDialogueId
          ? dialogueSessions.find(s => s.id === activeDialogueId)
          : null;
        loadSessionHistoryDoc(activeSession ? activeSession.historyDoc : null, sid);
      }
    });
  }
}

function connectAgentStream(sessionId, noReplay) {
  const sid = sessionId || getActiveSessionId();
  // 只关闭同一 sessionId 的旧连接（重连），保留其他会话的 SSE 连接
  // 这样后台会话能持续接收事件（静默处理），不会因切换会话导致"同时结束"的假象
  if (sessionSources.has(sid)) {
    sessionSources.get(sid).close();
    sessionSources.delete(sid);
  }
  if (sid === getActiveSessionId()) {
    agentEventSource = null;
    _contextPressure = false;
    _contextCompressing = false;
  }

  const url = '/agent/stream?sessionId=' + encodeURIComponent(sid) + (noReplay ? '&noReplay=1' : '');
  const es = new EventSource(url);
  sessionSources.set(sid, es);
  if (sid === getActiveSessionId()) agentEventSource = es;

  // 判断此 SSE 的事件是否对应当前活跃会话（事件触发时动态判断）
  const isActive = () => sid === getActiveSessionId();

  // 后台会话的 waiting-confirm：静默自动确认，不更新 UI
  const bgConfirm = () => fetch('/agent/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'done', sessionId: sid }),
  }).catch(() => {});

  es.addEventListener('start', (e) => {
    if (!isActive()) return;
    const { task, tokenEst, maxTokens } = JSON.parse(e.data);
    agentRunning = true;
    agentStartTime = Date.now();
    agentMdBuffer = '';
    agentMdBlock = null;
    _contextPressure = false;
    stopHistoryPolling();
    setAgentStatus('running', `运行中`);
    updateAgentActionBar('idle', '');
    appendAgentLine(`▶ 任务已启动: ${task}`, 'system');
    startElapsedTimer();
    document.getElementById('agentStartBtn').disabled = true;
    document.getElementById('agentStopBtn').disabled = false;
    if (maxTokens) agentMaxTokens = maxTokens;
    updateTokenCounter(tokenEst || 0);
    // 同步 dialogueSessions 内存，使切回此会话时能立即读到 isLaunched=true
    const _si = dialogueSessions.findIndex(s => s.id === sid);
    if (_si >= 0) dialogueSessions[_si] = { ...dialogueSessions[_si], isLaunched: true };
  });

  es.addEventListener('output', (e) => {
    if (!isActive()) return;
    const { text, stream, tokenEst, maxTokens } = JSON.parse(e.data);
    if (maxTokens) agentMaxTokens = maxTokens;
    if (tokenEst !== undefined) updateTokenCounter(tokenEst);
    if (stream === 'stderr') {
      if (text) appendAgentLine(text, 'stderr');
      return;
    }
    if (stream === 'system-ack') {
      // 系统 ACK：立即显示为独立行，不进入 markdown 缓冲
      if (text) appendAgentLine(text, 'system-ack');
      return;
    }
    if (stream === 'user-msg') {
      // 用户留言：先强制渲染已积累的 markdown，避免重放时内容丢失
      if (agentMdBuffer && agentMdBlock) {
        agentMdBlock.innerHTML = marked.parse(agentMdBuffer);
        agentMdBlock.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
      }
      agentMdBuffer = '';
      agentMdBlock = null;
      if (text) {
        const clean = text.replace(/^💬\s*/, '');
        const msgDiv = document.createElement('div');
        msgDiv.className = 'agent-md-block user-msg-block';
        try {
          msgDiv.innerHTML = marked.parse(`> 💬 **[用户留言]**\n>\n> ${clean.replace(/\n/g, '\n> ')}\n`);
        } catch (_e) {
          msgDiv.textContent = `💬 ${clean}`;
        }
        document.getElementById('agentOutput').appendChild(msgDiv);
        document.getElementById('agentOutput').scrollTop = document.getElementById('agentOutput').scrollHeight;
      }
      return;
    }
    // stdout — 累计 Markdown 内容，实时渲染
    if (!text) return;
    agentMdBuffer += text;
    if (!agentMdBlock) {
      agentMdBlock = document.createElement('div');
      agentMdBlock.className = 'agent-md-block';
      document.getElementById('agentOutput').appendChild(agentMdBlock);
    }
    scheduleMdRender();
  });

  es.addEventListener('heartbeat', (e) => {
    if (!isActive()) return;
    const { elapsedSec, tokenEst, maxTokens } = JSON.parse(e.data);
    document.getElementById('agentElapsed').textContent = `已运行 ${elapsedSec}s`;
    if (maxTokens) agentMaxTokens = maxTokens;
    if (tokenEst !== undefined) updateTokenCounter(tokenEst);
  });

  es.addEventListener('token-update', (e) => {
    if (!isActive()) return;
    const { tokenEst, maxTokens } = JSON.parse(e.data);
    if (maxTokens) agentMaxTokens = maxTokens;
    if (tokenEst !== undefined) updateTokenCounter(tokenEst);
  });

  es.addEventListener('waiting-confirm', (e) => {
    const { code, elapsed } = JSON.parse(e.data);
    const ok = code === 0;
    if (!isActive()) {
      // 后台会话：静默自动确认，不影响当前 UI
      bgConfirm();
      return;
    }
    // 立即解锁 UI，不等 done 事件（防止 SSE 断开导致按钮永久禁用）
    agentRunning = false;
    _permLocked = false;
    clearInterval(agentElapsedTimer);
    document.getElementById('agentStartBtn').disabled = false;
    document.getElementById('agentStopBtn').disabled = true;
    setAgentStatus(ok ? 'done' : 'error', ok ? `完成 (${elapsed}s)` : `错误 (code ${code})`);
    updateAgentActionBar('idle', '');
    if (ok && _contextPressure && !_contextCompressing) {
      triggerContextCompression();
    } else if (!_contextCompressing) {
      // 自动确认，不显示确认栏
      confirmAgentDone();
    }
  });

  es.addEventListener('continue-queued', (e) => {
    if (!isActive()) return;
    const { task } = JSON.parse(e.data);
    document.getElementById('agentTask').value = task;
    startAgent();
  });

  es.addEventListener('request-input', (e) => {
    if (!isActive()) return;
    const { prompt = '', placeholder = '' } = JSON.parse(e.data);
    openUserInputBar(prompt, placeholder);
  });

  es.addEventListener('done', (e) => {
    if (!isActive()) return;
    const { code, elapsed, task } = JSON.parse(e.data);
    agentRunning = false;
    _permLocked = false;
    clearInterval(agentElapsedTimer);
    const ok = code === 0;
    setAgentStatus(ok ? 'done' : 'error', ok ? `完成 (${elapsed}s)` : `错误 (code ${code})`);
    updateAgentActionBar('idle', '');
    appendAgentLine(`${ok ? '✓' : '✗'} 任务结束，耗时 ${elapsed}s，退出码 ${code}`, ok ? 'success' : 'error');
    hideAgentConfirmBar();
    document.getElementById('agentStartBtn').disabled = false;
    document.getElementById('agentStopBtn').disabled = true;
    startHistoryPolling();
    // 同步 dialogueSessions 内存（done 时 isLaunched 已被服务端写为 false）
    const _si = dialogueSessions.findIndex(s => s.id === sid);
    if (_si >= 0) dialogueSessions[_si] = { ...dialogueSessions[_si], isLaunched: false };
    if (pendingContinueTask) {
      const followUp = pendingContinueTask;
      pendingContinueTask = null;
      document.getElementById('agentTask').value = followUp;
      setTimeout(() => startAgent(), 200);
    } else if (_contextCompressing) {
      finishContextCompression();
    }
  });

  es.addEventListener('stopped', () => {
    if (!isActive()) return;
    agentRunning = false;
    _permLocked = false;
    _contextPressure = false;
    _contextCompressing = false;
    clearInterval(agentElapsedTimer);
    setAgentStatus('idle', '已停止');
    updateAgentActionBar('idle', '');
    hideAgentConfirmBar();
    appendAgentLine('■ Agent 已手动停止', 'system');
    document.getElementById('agentStartBtn').disabled = false;
    document.getElementById('agentStopBtn').disabled = true;
    startHistoryPolling();
    // 同步 dialogueSessions 内存
    const _si = dialogueSessions.findIndex(s => s.id === sid);
    if (_si >= 0) dialogueSessions[_si] = { ...dialogueSessions[_si], isLaunched: false };
  });

  es.addEventListener('agent-action', (e) => {
    const { type, label } = JSON.parse(e.data);
    // Always update the session bubble regardless of which session is active
    if (window.updateBubbleAction) window.updateBubbleAction(sid, { type, label });
    if (!isActive()) return;
    updateAgentActionBar(type, label);
  });

  // POLL / set-status 通知：服务端状态变化时同步前端 UI
  es.addEventListener('session-status', (e) => {
    const { status, task, processAlive, isLaunched } = JSON.parse(e.data);
    if (!isActive()) return;
    const active = processAlive || isLaunched;
    const hintBtn = document.getElementById('agentHintBtn');
    if ((status === 'waiting' || status === 'running') && active) {
      // 进程活着（POLL 或刚唤醒），确保 UI 正确显示活跃状态
      document.getElementById('agentStartBtn').disabled = true;
      document.getElementById('agentStopBtn').disabled = false;
      // 提示按钮：仅在 running（执行任务中）时显示
      if (hintBtn) hintBtn.style.display = status === 'running' ? '' : 'none';
      if (status === 'waiting') {
        setAgentStatus('running', 'POLL 等待中');
        if (task) updateAgentActionBar('poll', task.slice(0, 40));
      }
    } else {
      if (hintBtn) hintBtn.style.display = 'none';
    }
  });

  es.addEventListener('history-saved', (e) => {
    if (!isActive()) return;
    loadFileTree();
  });

  es.addEventListener('saved', (e) => {
    if (!isActive()) return;
    const { path } = JSON.parse(e.data);
    appendAgentLine(`💾 已保存为文档: ${path}`, 'system');
    loadFileTree(); // 刷新文件树
  });

  es.addEventListener('error', (e) => {
    if (!isActive()) return;
    try {
      const d = JSON.parse(e.data);
      appendAgentLine(`[错误] ${d.message}`, 'error');
      if (d.resetHint) {
        appendAgentResetHint();
      }
    } catch {}
    setAgentStatus('error', '错误');
    agentRunning = false;
    document.getElementById('agentStartBtn').disabled = false;
    document.getElementById('agentStopBtn').disabled = true;
  });

  // ── GitHub 认证事件（全局广播，只有活跃会话处理 UI）──────
  es.addEventListener('auth-start', () => {
    if (!isActive()) return;
    document.getElementById('agentOutput').innerHTML = '';
    agentMdBuffer = ''; agentMdBlock = null;
    appendAgentLine('🔐 GitHub 认证流程已启动...', 'system');
    appendAgentLine('请点击下方链接，在浏览器中完成 GitHub 授权', 'system');
    document.getElementById('agentAuthBtn').disabled = true;
    document.getElementById('agentAuthCancelBtn').disabled = false;
  });

  es.addEventListener('auth-output', (e) => {
    if (!isActive()) return;
    const { text, stream } = JSON.parse(e.data);
    appendAgentLineHTML(text, stream === 'stderr' ? 'stderr' : '');
  });

  es.addEventListener('auth-done', (e) => {
    if (!isActive()) return;
    const { code, cancelled } = JSON.parse(e.data);
    if (cancelled) {
      appendAgentLine('■ 认证已取消', 'system');
    } else {
      const ok = code === 0;
      appendAgentLine(ok ? '✓ GitHub 认证成功！现在可以启动 Agent 了' : `✗ 认证失败 (code ${code})`, ok ? 'success' : 'error');
    }
    document.getElementById('agentAuthBtn').disabled = false;
    document.getElementById('agentAuthCancelBtn').disabled = true;
  });

  es.addEventListener('auth-error', (e) => {
    if (!isActive()) return;
    const { message, notInstalled } = JSON.parse(e.data);
    if (notInstalled) {
      // 多行清晰说明，直接逐行输出
      appendAgentLine(message, 'error');
    } else {
      appendAgentLine(`✗ 认证错误: ${message}`, 'error');
    }
    document.getElementById('agentAuthBtn').disabled = false;
    document.getElementById('agentAuthCancelBtn').disabled = true;
  });

  // SSE 断线/重连检测
  let _sseConnected = true;
  es.onerror = () => {
    if (!_sseConnected) return; // 已在重连中，避免重复提示
    _sseConnected = false;
    if (isActive()) appendAgentLine('⚠️ SSE 连接断开，正在自动重连…', 'system');
  };
  es.onopen = () => {
    if (_sseConnected) return; // 初次连接，不提示
    _sseConnected = true;
    if (isActive()) appendAgentLine('✓ SSE 已重新连接', 'system');
  };
}

function startElapsedTimer() {
  clearInterval(agentElapsedTimer);
  agentElapsedTimer = setInterval(() => {
    if (!agentStartTime) return;
    const s = Math.floor((Date.now() - agentStartTime) / 1000);
    document.getElementById('agentElapsed').textContent = `已运行 ${s}s`;
  }, 1000);
}

function setAgentStatus(state, text) {
  const dot = document.getElementById('agentStatusDot');
  const label = document.getElementById('agentStatusText');
  dot.className = `agent-status-dot ${state}`;
  label.textContent = text;
}

function updateAgentActionBar(type, label) {
  const bar = document.getElementById('agentActionBar');
  if (!bar) return;

  // While waiting for user to click Allow/Deny, ignore everything except
  // an explicit perm update (re-lock) or an explicit idle/clear call from
  // sendAgentInput / done / stopped (those call with forceUnlock=true).
  if (_permLocked && type !== 'perm') return;

  if (!type || type === 'idle' || !label) {
    _permLocked = false;
    bar.style.display = 'none';
    bar.className = 'agent-action-bar';
    bar.innerHTML = '<span class="agent-action-icon" id="agentActionIcon">⚙️</span><span class="agent-action-label" id="agentActionLabel">处理中…</span>';
    return;
  }
  bar.style.display = 'flex';
  bar.className = `agent-action-bar type-${type}`;

  if (type === 'perm') {
    _permLocked = true;   // lock bar until user responds
    bar.innerHTML = '';
    const icon = document.createElement('span');
    icon.className = 'agent-action-icon';
    icon.textContent = '🔐';
    const lbl = document.createElement('span');
    lbl.className = 'agent-action-label';
    lbl.textContent = label;
    const btnY = document.createElement('button');
    btnY.className = 'agent-perm-btn approve';
    btnY.textContent = '✓ 允许';
    btnY.title = '向 Agent 发送 y（允许此操作）';
    btnY.onclick = () => sendAgentInput('y');
    const btnN = document.createElement('button');
    btnN.className = 'agent-perm-btn deny';
    btnN.textContent = '✗ 拒绝';
    btnN.title = '向 Agent 发送 n（拒绝此操作）';
    btnN.onclick = () => sendAgentInput('n');
    bar.appendChild(icon);
    bar.appendChild(lbl);
    bar.appendChild(btnY);
    bar.appendChild(btnN);
  } else {
    bar.innerHTML = '<span class="agent-action-icon" id="agentActionIcon">⚙️</span><span class="agent-action-label" id="agentActionLabel"></span>';
    document.getElementById('agentActionLabel').textContent = label;
  }
}

async function sendAgentInput(text) {
  _permLocked = false;   // unlock immediately so bar can clear after send
  try {
    const res = await fetch('/agent/input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, sessionId: getActiveSessionId() }),
    });
    const data = await res.json();
    if (!data.success) showToast('发送失败: ' + data.error, 'error');
    updateAgentActionBar('idle', '');
  } catch (e) {
    showToast('发送失败: ' + e.message, 'error');
  }
}

function toggleUserInputBar() {
  openUserInputBar();
}

// 统一输入框模式: 'task'（发送留言）或 'input'（响应 Agent 请求输入）
let _agentInputMode = 'task';

function openUserInputBar(prompt = '', placeholder = '') {
  const textarea = document.getElementById('agentTask');
  const promptBar = document.getElementById('agentUnifiedPrompt');
  const promptText = document.getElementById('agentUnifiedPromptText');
  const sendBtn = document.getElementById('agentSendInputBtn');
  const startBtn = document.getElementById('agentStartBtn');
  if (!textarea) return;
  _agentInputMode = 'input';
  if (promptBar) {
    promptText.textContent = prompt || '请向 Agent 发送输入：';
    promptBar.style.display = 'flex';
  }
  textarea.placeholder = placeholder || '向 Agent 发送输入（多行，Ctrl+Enter 发送）…';
  if (sendBtn) sendBtn.style.display = '';
  if (startBtn) startBtn.style.display = 'none';
  textarea.focus();
}

function closeUserInputBar() {
  const textarea = document.getElementById('agentTask');
  const promptBar = document.getElementById('agentUnifiedPrompt');
  const sendBtn = document.getElementById('agentSendInputBtn');
  const startBtn = document.getElementById('agentStartBtn');
  _agentInputMode = 'task';
  if (promptBar) promptBar.style.display = 'none';
  if (textarea) textarea.placeholder = '输入任务描述...\n例如：分析 docs 目录结构，生成一份摘要报告\n（运行中时，Ctrl+Enter 发送留言给 Agent）';
  if (sendBtn) sendBtn.style.display = 'none';
  if (startBtn) startBtn.style.display = '';
}

async function sendTaskInput() {
  const textarea = document.getElementById('agentTask');
  const text = textarea.value;
  if (!text.trim()) return;
  // 如果当前是 Agent 请求输入模式，走 sendUserInput 逻辑
  if (_agentInputMode === 'input') {
    try {
      const res = await fetch('/agent/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, sessionId: getActiveSessionId() }),
      });
      const data = await res.json();
      if (data.success) {
        textarea.value = '';
        closeUserInputBar();
        showToast('已发送', 'success');
      } else {
        showToast('发送失败: ' + data.error, 'error');
      }
    } catch (e) {
      showToast('发送失败: ' + e.message, 'error');
    }
    return;
  }
  // 普通留言模式
  const historyDoc = document.getElementById('agentHistoryDoc')?.value || '';
  try {
    const res = await fetch('/agent/input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, sessionId: getActiveSessionId(), historyDoc }),
    });
    const data = await res.json();
    if (data.success) {
      textarea.value = '';
      showToast('已发送给 Agent', 'success');
    } else {
      showToast('发送失败: ' + data.error, 'error');
    }
  } catch (e) {
    showToast('发送失败: ' + e.message, 'error');
  }
}

async function sendUserInput() {
  // 兼容旧调用：直接转发给 sendTaskInput（已统一处理）
  await sendTaskInput();
}

async function sendAgentHint() {
  const textarea = document.getElementById('agentTask');
  const text = textarea.value.trim();
  if (!text) { showToast('请先输入提示内容', 'warning'); return; }
  try {
    const res = await fetch('/agent/hint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, sessionId: getActiveSessionId() }),
    });
    const data = await res.json();
    if (data.success) {
      textarea.value = '';
      showToast('💡 提示已发送，Agent 下一步会看到', 'success');
    } else {
      showToast('发送失败: ' + data.error, 'error');
    }
  } catch (e) {
    showToast('发送失败: ' + e.message, 'error');
  }
}

function showAgentConfirmBar() {
  const bar = document.getElementById('agentConfirmBar');
  const input = document.getElementById('agentConfirmInput');
  if (!bar) return;
  input.value = '';
  bar.style.display = 'flex';
  input.focus();
}

function hideAgentConfirmBar() {
  const bar = document.getElementById('agentConfirmBar');
  if (bar) bar.style.display = 'none';
}

async function confirmAgentDone() {
  hideAgentConfirmBar();
  try {
    await fetch('/agent/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'done', sessionId: getActiveSessionId() }),
    });
  } catch (e) {
    showToast('确认失败: ' + e.message, 'error');
  }
}

async function continueAgentTask() {
  const input = document.getElementById('agentConfirmInput');
  const followUp = input ? input.value.trim() : '';
  if (!followUp) { showToast('请输入追加需求', 'error'); return; }
  pendingContinueTask = followUp;
  hideAgentConfirmBar();
  try {
    await fetch('/agent/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'done', sessionId: getActiveSessionId() }),
    });
  } catch (e) {
    pendingContinueTask = null;
    showToast('提交失败: ' + e.message, 'error');
  }
}

// ── 上下文压缩 ────────────────────────────────────────────
function triggerContextCompression() {
  _contextCompressing = true;
  _contextPressure = false;
  const historyDoc = document.getElementById('agentHistoryDoc').value;
  const compressionPrompt = historyDoc
    ? `请将本次会话的全部工作内容精炼为结构化的"会话压缩记忆"，以 Markdown 格式追加到历史文档（history/${historyDoc}）的末尾。` +
      `格式要求如下：\n\n## 会话压缩记忆（${new Date().toLocaleDateString('zh-CN')}）\n\n` +
      `### 已完成任务\n- （逐条列出本次会话完成的关键任务）\n\n` +
      `### 重要决策与代码\n- （保留关键决策、架构选择、重要代码片段或配置）\n\n` +
      `### 当前状态与下一步\n- （记录当前进展、未完成项、下次继续的切入点）\n\n` +
      `请使用文件编辑工具将上述内容追加到文档末尾，完成后输出一行：COMPRESSION_COMPLETE`
    : `请将本次会话的全部工作内容精炼为结构化摘要，直接输出 Markdown 格式：\n\n` +
      `## 会话压缩记忆（${new Date().toLocaleDateString('zh-CN')}）\n### 已完成任务\n### 重要决策\n### 当前状态`;
  pendingContinueTask = compressionPrompt;
  // 确认当前任务完成 → done 事件触发 pendingContinueTask 自动启动压缩任务
  fetch('/agent/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'done', sessionId: getActiveSessionId() }),
  }).catch(e => {
    _contextCompressing = false;
    showToast('压缩触发失败: ' + e.message, 'error');
    showAgentConfirmBar();
  });
}

async function finishContextCompression() {
  _contextCompressing = false;
  const sid = getActiveSessionId();
  const historyDoc = document.getElementById('agentHistoryDoc').value;
  try {
    await fetch('/agent/clear-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sid }),
    });
    document.getElementById('agentOutput').innerHTML = '';
    agentMdBuffer = ''; agentMdBlock = null;
    updateTokenCounter(0);
    loadSessionHistoryDoc(historyDoc, sid);
  } catch (e) {
    showToast('重置上下文失败: ' + e.message, 'error');
  }
}

function appendAgentLine(text, cls = '') {
  const output = document.getElementById('agentOutput');
  const lines = text.split('\n');
  lines.forEach(line => {
    if (line === '' && cls === '') return;
    const span = document.createElement('span');
    span.className = `agent-line ${cls}`;
    span.textContent = line;
    output.appendChild(span);
    output.appendChild(document.createTextNode('\n'));
  });
  output.scrollTop = output.scrollHeight;
}

// 带 HTML 的行输出（用于可点击链接），其余文本做安全转义
function appendAgentLineHTML(text, cls = '') {
  const output = document.getElementById('agentOutput');
  const escapeHTML = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // 先整体转义，再把 URL 还原为可点击链接
  const safeText = escapeHTML(text).replace(
    /(https?:\/\/[^\s<>"]+)/g,
    '<a href="$1" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:underline;word-break:break-all">$1</a>'
  );
  const lines = safeText.split('\n');
  lines.forEach(line => {
    if (!line.trim()) return;
    const span = document.createElement('span');
    span.className = `agent-line ${cls}`;
    span.innerHTML = line;
    output.appendChild(span);
    output.appendChild(document.createTextNode('\n'));
  });
  output.scrollTop = output.scrollHeight;
}

// ── 系统设定文档：弹窗选择 ────────────────────────────────

function renderSysdocTags() {
  const wrap = document.getElementById('sysdocTags');
  wrap.innerHTML = '';
  if (!selectedSystemDocs.length) {
    wrap.innerHTML = '<span class="sysdoc-empty">未选择</span>';
    return;
  }
  selectedSystemDocs.forEach(p => {
    const tag = document.createElement('span');
    tag.className = 'sysdoc-tag';
    tag.title = p;
    const label = document.createElement('span');
    label.className = 'sysdoc-tag-label';
    label.textContent = p.replace(/\.md$/, '').split('/').pop();
    const open = document.createElement('button');
    open.className = 'sysdoc-tag-open';
    open.textContent = '↗';
    open.title = '打开文档: ' + p;
    open.onclick = (e) => { e.stopPropagation(); openFile(p); };
    const del = document.createElement('button');
    del.className = 'sysdoc-tag-del';
    del.textContent = '×';
    del.title = '移除';
    del.onclick = () => removeSysdocTag(p);
    tag.appendChild(label);
    tag.appendChild(open);
    tag.appendChild(del);
    wrap.appendChild(tag);
  });
}

function removeSysdocTag(p) {
  selectedSystemDocs = selectedSystemDocs.filter(x => x !== p);
  renderSysdocTags();
  if (activeDialogueId) saveCurrentDialogue(activeDialogueId);
}

function renderPySysdocTags() {
  const wrap = document.getElementById('pyagentSysdocTags');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!selectedPySystemDocs.length) {
    wrap.innerHTML = '<span class="sysdoc-empty">未选择</span>';
    return;
  }
  selectedPySystemDocs.forEach(p => {
    const tag = document.createElement('span');
    tag.className = 'sysdoc-tag';
    tag.title = p;
    const label = document.createElement('span');
    label.className = 'sysdoc-tag-label';
    label.textContent = p.replace(/\.md$/, '').split('/').pop();
    const open = document.createElement('button');
    open.className = 'sysdoc-tag-open';
    open.textContent = '↗';
    open.title = '打开文档: ' + p;
    open.onclick = (e) => { e.stopPropagation(); openFile(p); };
    const del = document.createElement('button');
    del.className = 'sysdoc-tag-del';
    del.textContent = '×';
    del.title = '移除';
    del.onclick = () => removePySysdocTag(p);
    tag.appendChild(label);
    tag.appendChild(open);
    tag.appendChild(del);
    wrap.appendChild(tag);
  });
}

function removePySysdocTag(p) {
  selectedPySystemDocs = selectedPySystemDocs.filter(x => x !== p);
  renderPySysdocTags();
  if (window.activePyAgentSession) saveCurrentPyDialogue(window.activePyAgentSession.id);
}

async function openPySystemDocModal() {
  _sysdocTarget = 'pyagent';
  await openSystemDocModal();
}

async function openSystemDocModal() {
  if (_sysdocTarget !== 'pyagent') _sysdocTarget = 'agent';
  // 加载文档列表（仅限 agent/ 目录）
  if (!allDocsList.length) {
    try {
      const res = await fetch('/agent/docs');
      const data = await res.json();
      allDocsList = (data.docs || []).filter(p => p.startsWith('agent/'));
    } catch (e) { showToast('加载文档列表失败', 'error'); return; }
  }
  document.getElementById('sysdocSearch').value = '';
  renderSysdocModalList(allDocsList);
  document.getElementById('sysdocModalOverlay').classList.add('open');
  document.getElementById('sysdocSearch').focus();
}

function closeSystemDocModal() {
  document.getElementById('sysdocModalOverlay').classList.remove('open');
}

function closeSysdocModalOnOverlay(e) {
  if (e.target === document.getElementById('sysdocModalOverlay')) closeSystemDocModal();
}

function renderSysdocModalList(docs) {
  const list = document.getElementById('sysdocModalList');
  const pending = new Set(Array.from(list.querySelectorAll('input:checked')).map(el => el.value));
  // 首次渲染用 selectedSystemDocs / selectedPySystemDocs，后续保留弹窗内勾选状态
  const activeDocs = _sysdocTarget === 'pyagent' ? selectedPySystemDocs : selectedSystemDocs;
  const checked = pending.size ? pending : new Set(activeDocs);
  list.innerHTML = '';
  if (!docs.length) {
    list.innerHTML = '<div class="sysdoc-modal-empty">没有可选文档</div>';
    updateSysdocSelCount();
    return;
  }
  docs.forEach(p => {
    const row = document.createElement('label');
    row.className = 'sysdoc-modal-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = p;
    cb.checked = checked.has(p);
    cb.onchange = updateSysdocSelCount;
    const name = document.createElement('span');
    name.className = 'sysdoc-modal-item-name';
    name.textContent = p.replace(/\.md$/, '');
    row.appendChild(cb);
    row.appendChild(name);
    list.appendChild(row);
  });
  updateSysdocSelCount();
}

function filterSysdocList() {
  const q = document.getElementById('sysdocSearch').value.toLowerCase();
  const filtered = allDocsList.filter(p => p.toLowerCase().includes(q));
  // 保留当前勾选状态再重渲
  const list = document.getElementById('sysdocModalList');
  const checked = new Set(Array.from(list.querySelectorAll('input:checked')).map(el => el.value));
  list.innerHTML = '';
  filtered.forEach(p => {
    const row = document.createElement('label');
    row.className = 'sysdoc-modal-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = p;
    cb.checked = checked.has(p);
    cb.onchange = updateSysdocSelCount;
    const name = document.createElement('span');
    name.className = 'sysdoc-modal-item-name';
    name.textContent = p.replace(/\.md$/, '');
    const highlight = q ? p.replace(new RegExp(`(${q})`, 'gi'), '<mark>$1</mark>') : p.replace(/\.md$/, '');
    name.innerHTML = highlight.replace(/\.md$/, '');
    row.appendChild(cb);
    row.appendChild(name);
    list.appendChild(row);
  });
  updateSysdocSelCount();
}

function updateSysdocSelCount() {
  const n = document.getElementById('sysdocModalList').querySelectorAll('input:checked').length;
  document.getElementById('sysdocSelCount').textContent = `已选 ${n} 项`;
}

function confirmSystemDocSelection() {
  const checked = Array.from(document.getElementById('sysdocModalList').querySelectorAll('input:checked')).map(el => el.value);
  if (_sysdocTarget === 'pyagent') {
    selectedPySystemDocs = checked;
    renderPySysdocTags();
    closeSystemDocModal();
    if (window.activePyAgentSession) saveCurrentPyDialogue(window.activePyAgentSession.id);
  } else {
    selectedSystemDocs = checked;
    renderSysdocTags();
    closeSystemDocModal();
    if (activeDialogueId) saveCurrentDialogue(activeDialogueId);
  }
  _sysdocTarget = 'agent';
}

async function loadTaskPrefixDocs() {
  try {
    const res = await fetch('/agent/docs');
    const data = await res.json();
    const docs = data.docs || [];

    function fillPrefixSel(selId) {
      const sel = document.getElementById(selId);
      if (!sel) return;
      const current = sel.value;
      sel.innerHTML = '<option value="">— 无前缀 —</option>';
      docs.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p.replace(/\.md$/, '');
        sel.appendChild(opt);
      });
      if (current) sel.value = current;
    }

    fillPrefixSel('agentTaskPrefix');
    fillPrefixSel('pyagentTaskPrefix');
  } catch (e) {}
}

async function populateAgentDocSelector() {
  // 预加载文档列表供弹窗使用（仅 agent/ 目录）
  try {
    const res = await fetch('/agent/docs');
    const data = await res.json();
    allDocsList = (data.docs || []).filter(p => p.startsWith('agent/'));
  } catch (e) {}
}

async function previewSystemDoc() {
  if (!selectedSystemDocs.length) { showToast('请先添加系统设定文档', 'error'); return; }
  const output = document.getElementById('agentOutput');
  output.innerHTML = '';
  for (const doc of selectedSystemDocs) {
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(doc)}`);
      const data = await res.json();
      if (!data.success) { appendAgentLine(`读取失败: ${doc}`, 'error'); continue; }
      appendAgentLine(`── 预览: ${doc} ──`, 'system');
      appendAgentLine(data.content, '');
    } catch (e) {
      appendAgentLine(`预览失败: ${doc}`, 'error');
    }
  }
}

async function startAgent() {
  const task = document.getElementById('agentTask').value.trim();
  if (!task) { showToast('请输入任务描述', 'error'); return; }

  const saveAs = document.getElementById('agentSaveAs').value.trim();
  const maxContinues = parseInt(document.getElementById('agentMaxCont').value) || 10;
  const useHistory = document.getElementById('agentUseHistory').checked;
  const hideTrace = document.getElementById('agentHideTrace').checked;
  const systemDocs = selectedSystemDocs.slice();
  const model = document.getElementById('agentModel').value || undefined;
  const historyDoc = document.getElementById('agentHistoryDoc').value || undefined;
  const taskPrefixDoc = document.getElementById('agentTaskPrefix').value || undefined;

  document.getElementById('agentOutput').innerHTML = '';
  document.getElementById('agentElapsed').textContent = '';
  agentMdBuffer = ''; agentMdBlock = null;
  updateTokenCounter(0);

  if (systemDocs.length) appendAgentLine(`📄 系统设定: ${systemDocs.join(', ')}`, 'system');
  if (historyDoc) appendAgentLine(`📜 历史文档: history/${historyDoc}（读取上下文，会话结束后追加）`, 'system');
  if (taskPrefixDoc) appendAgentLine(`📋 任务前缀: ${taskPrefixDoc}`, 'system');

  try {
    const res = await fetch('/agent/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, maxContinues, saveAs: saveAs || undefined, useHistory, hideTrace, systemDocs: systemDocs.length ? systemDocs : undefined, model, historyDoc, taskPrefixDoc, sessionId: getActiveSessionId() }),
    });
    const data = await res.json();
    if (!data.success) {
      if (data.notInstalled) {
        appendAgentLine('❌ Copilot CLI 未安装，无法启动 Agent', 'error');
        appendAgentLine('请在终端运行: npm install -g @github/copilot', 'system');
        appendAgentLine('安装后需认证: copilot auth', 'system');
      } else {
        showToast(data.error, 'error');
      }
    }
  } catch (e) {
    showToast('启动失败: ' + e.message, 'error');
  }
}

async function stopAgent() {
  try {
    await fetch('/agent/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: getActiveSessionId() }),
    });
  } catch (e) {
    showToast('停止失败', 'error');
  }
}

function clearAgentOutput() {
  document.getElementById('agentOutput').innerHTML = '';
  document.getElementById('agentElapsed').textContent = '';
  agentMdBuffer = '';
  agentMdBlock = null;
  setAgentStatus('idle', '空闲');
  updateTokenCounter(0);
}

async function loadAgentHistory() {
  try {
    const res = await fetch('/agent/history?sessionId=' + encodeURIComponent(getActiveSessionId()));
    const data = await res.json();
    const output = document.getElementById('agentOutput');
    output.innerHTML = '';
    if (data.total === 0) {
      appendAgentLine('（暂无历史记录）', 'system');
      return;
    }
    appendAgentLine(`── 历史记录（共 ${data.total} 条）──`, 'system');
    data.history.forEach(h => {
      appendAgentLine(`#${h.index} [${h.time}] 耗时 ${h.elapsed}s  任务: ${h.task}`, '');
    });
  } catch (e) {
    showToast('加载历史失败', 'error');
  }
}

function appendAgentResetHint() {
  const output = document.getElementById('agentOutput');
  const wrap = document.createElement('div');
  wrap.className = 'agent-reset-hint';
  wrap.innerHTML = `
    <span class="agent-reset-hint-label">⚠️ Prompt 过长导致启动失败</span>
    <button class="agent-btn primary" onclick="resetAgentContext()">重置上下文</button>
  `;
  output.appendChild(wrap);
  output.scrollTop = output.scrollHeight;
}

async function resetAgentContext() {
  try {
    await fetch('/agent/clear-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: getActiveSessionId() }),
    });
    selectedSystemDocs = [];
    renderSysdocTags();
    const histSel = document.getElementById('agentHistoryDoc');
    if (histSel) histSel.value = '';
    showToast('上下文已重置：内存历史、系统设定文档已清除', 'success');
    appendAgentLine('✓ 上下文已重置，可重新开始任务。', 'success');
  } catch (e) {
    showToast('重置失败: ' + e.message, 'error');
  }
}

async function clearAgentHistory() {
  if (!confirm('确定要清除所有 Agent 历史记录吗？')) return;
  await fetch('/agent/history?sessionId=' + encodeURIComponent(getActiveSessionId()), { method: 'DELETE' });
  showToast('历史已清除', 'success');
}

async function startAgentAuth() {
  try {
    const res = await fetch('/agent/auth', { method: 'POST' });
    const data = await res.json();
    if (!data.success) {
      appendAgentLine(`✗ ${data.error}`, 'error');
    }
  } catch (e) {
    showToast('认证启动失败: ' + e.message, 'error');
  }
}

async function cancelAgentAuth() {
  try {
    await fetch('/agent/auth', { method: 'DELETE' });
  } catch (e) {
    showToast('取消失败', 'error');
  }
}

async function checkAgentEnv() {
  appendAgentLine('正在检测 Copilot CLI 环境...', 'system');
  try {
    const res = await fetch('/agent/detect');
    const data = await res.json();
    if (data.available) {
      appendAgentLine(`✓ Copilot CLI 可用`, 'success');
      appendAgentLine(`  路径: ${data.cmd} ${data.args.join(' ')}`, 'system');
      appendAgentLine(`  版本: ${data.version}`, 'system');
    } else {
      appendAgentLine(`✗ Copilot CLI 不可用`, 'error');
      appendAgentLine(`  尝试路径: ${data.cmd}`, 'system');
      appendAgentLine(`  错误: ${data.error || data.version}`, 'error');
      appendAgentLine(`  请安装: npm install -g @github/copilot`, 'system');
    }
  } catch (e) {
    appendAgentLine(`检测失败: ${e.message}`, 'error');
  }
}

// ===== DIALOGUE / SESSION PANEL =====
let dialogueSessions = [];       // loaded sessions
let activeDialogueId = null;     // currently active session id
let _loadSessionAC   = null;     // AbortController for in-flight loadSessionHistoryDoc

async function loadDialogues() {
  try {
    // Try dedicated API first (available after server restart)
    const res = await fetch('/api/dialogue', { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      dialogueSessions = data.sessions || [];
      renderSessionList();
      return;
    }
  } catch (e) {}
  // Fallback: use file tree API
  try {
    const treeRes = await fetch('/open/tree', { signal: AbortSignal.timeout(5000) });
    const treeData = await treeRes.json();
    const dialogueFolder = (treeData.tree || []).find(item => item.type === 'folder' && item.name === 'dialogue');
    const files = dialogueFolder ? (dialogueFolder.children || []).filter(f => f.type === 'file') : [];
    dialogueSessions = await Promise.all(files.map(async f => {
      try {
        const fr = await fetch(`/api/file?path=${encodeURIComponent(f.path)}`, { signal: AbortSignal.timeout(4000) });
        const fd = await fr.json();
        const cfg = JSON.parse(fd.content || '{}');
        return { id: f.path, name: cfg.name || f.name.replace('.md',''), model: cfg.model||'', historyDoc: cfg.historyDoc||'', systemDocs: cfg.systemDocs||[] };
      } catch {
        return { id: f.path, name: f.name.replace('.md',''), model:'', historyDoc:'', systemDocs:[] };
      }
    }));
    renderSessionList();
  } catch (e) {}
}

function renderSessionList() {
  const list = document.getElementById('sessionList');
  list.innerHTML = '';
  if (!dialogueSessions.length) {
    list.innerHTML = '<div class="session-loading">暂无会话</div>';
    return;
  }
  dialogueSessions.forEach(s => {
    const isPyAgent = s.type === 'pyagent';
    const item = document.createElement('div');
    item.className = 'session-item' + (s.id === activeDialogueId ? ' active' : '') + (isPyAgent ? ' pyagent-session' : '');
    item.dataset.id = s.id;

    const btn = document.createElement('button');
    btn.className = 'session-item-btn';
    btn.title = s.name;
    const namePrefix = isPyAgent ? '🐍 ' : '';
    const metaText = isPyAgent ? 'PyAgent' : (s.historyDoc ? s.historyDoc.replace(/^history\//, '') : (s.model || ''));
    btn.innerHTML = `<span class="session-item-name">${namePrefix}${escHtml(s.name)}</span>
      <span class="session-item-meta">${escHtml(metaText)}</span>`;
    btn.onclick = () => {
      if (isPyAgent) {
        const pyPanel = document.getElementById('pyagentPanel');
        // Close agent panel if open
        const agentPanel = document.getElementById('agentPanel');
        if (agentPanel && agentPanel.classList.contains('open')) {
          agentPanel.classList.remove('open');
          document.body.classList.remove('agent-panel-open');
          const btn2 = document.getElementById('agentToggleBtn');
          if (btn2) btn2.classList.remove('active');
        }
        if (!pyPanel.classList.contains('open')) togglePyAgentPanel();
        applyPyAgentDialogue(s);
      } else {
        const agentPanel = document.getElementById('agentPanel');
        // Close pyagent panel if open
        const pyPanel = document.getElementById('pyagentPanel');
        if (pyPanel && pyPanel.classList.contains('open')) {
          pyPanel.classList.remove('open');
          const sessPanel = document.getElementById('sessionPanel');
          if (sessPanel) sessPanel.classList.remove('open');
        }
        if (!agentPanel.classList.contains('open')) toggleAgentPanel();
        applyDialogue(s);
      }
    };

    const open = document.createElement('button');
    open.className = 'session-open-btn';
    open.title = '在编辑器中打开会话文件';
    open.textContent = '📂';
    open.onclick = (e) => { e.stopPropagation(); openFile('dialogue/' + s.id); };

    const del = document.createElement('button');
    del.className = 'session-del-btn';
    del.title = '删除会话';
    del.textContent = '×';
    del.onclick = (e) => { e.stopPropagation(); deleteDialogue(s.id); };

    item.appendChild(btn);
    item.appendChild(open);
    item.appendChild(del);
    list.appendChild(item);
  });
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function applyDialogue(cfg) {
  // 切换前保存当前会话的输出和按钮状态，切回时可恢复
  saveCurrentSessionOutput();
  activeDialogueId = cfg.id;
  renderSessionList();

  // 应用模型
  const modelSel = document.getElementById('agentModel');
  if (cfg.model) {
    for (const opt of modelSel.options) {
      if (opt.value === cfg.model) {
        opt.selected = true;
        agentMaxTokens = parseInt(opt.dataset.maxTokens) || 64000;
        updateTokenCounter(0);
        break;
      }
    }
  }
  // 应用 historyDoc 选择器
  const histSel = document.getElementById('agentHistoryDoc');
  const histVal = cfg.historyDoc || '';
  let histFound = false;
  for (const opt of histSel.options) {
    if (opt.value === histVal) { opt.selected = true; histFound = true; break; }
  }
  if (!histFound && histVal) {
    const opt = document.createElement('option');
    opt.value = histVal;
    opt.textContent = histVal.replace(/\.md$/, '');
    histSel.appendChild(opt);
    histSel.value = histVal;
  }
  // 应用 systemDocs
  selectedSystemDocs = Array.isArray(cfg.systemDocs) ? cfg.systemDocs.slice() : [];
  renderSysdocTags();
  // 应用任务前缀文档
  const prefSel = document.getElementById('agentTaskPrefix');
  const prefVal = cfg.taskPrefixDoc || '';
  let prefFound = false;
  for (const opt of prefSel.options) {
    if (opt.value === prefVal) { opt.selected = true; prefFound = true; break; }
  }
  if (!prefFound && prefVal) {
    const opt = document.createElement('option');
    opt.value = prefVal;
    opt.textContent = prefVal.replace(/\.md$/, '');
    prefSel.appendChild(opt);
    prefSel.value = prefVal;
  }
  // 应用其它配置选项
  document.getElementById('agentSaveAs').value = cfg.saveAs || '';
  document.getElementById('agentMaxCont').value = cfg.maxContinues != null ? cfg.maxContinues : 10;
  document.getElementById('agentUseHistory').checked = cfg.useHistory !== false;
  document.getElementById('agentHideTrace').checked = !!cfg.hideTrace;
  const peerUrlEl = document.getElementById('agentPeerUrl');
  if (peerUrlEl) peerUrlEl.value = cfg.peerUrl || '';

  // 重置 UI
  stopHistoryPolling();
  agentMdBuffer = ''; agentMdBlock = null;
  agentRunning = false; _permLocked = false;
  pendingContinueTask = null;
  clearInterval(agentElapsedTimer);
  document.getElementById('agentElapsed').textContent = '';
  updateTokenCounter(0);
  updateAgentActionBar('idle', '');
  hideAgentConfirmBar();

  // 【核心修复】直接从 session 文件的 isRunning/isLaunched 字段立即设置按钮状态
  // 优先使用 isRunning（新字段），兼容旧字段 isLaunched
  const _fileIsLaunched = !!(cfg.isRunning ?? cfg.isLaunched);
  document.getElementById('agentStartBtn').disabled = _fileIsLaunched;
  document.getElementById('agentStopBtn').disabled  = !_fileIsLaunched;

  // 清空输出区，立即建立 SSE 连接（同步），确保在用户点击"启动"前连接已就绪，避免竞态丢失事件
  document.getElementById('agentOutput').innerHTML = '';
  connectAgentStream(cfg.id, /* noReplay= */ true);

  // 从服务端获取最新进程状态（补充 processAlive 等实时信息，也可校正文件状态）
  // 同时刷新文件中的 isLaunched 到 dialogueSessions 内存
  fetch(`/api/file?path=${encodeURIComponent('dialogue/' + cfg.id)}`)
    .then(r => r.json())
    .then(d => {
      try {
        const fresh = JSON.parse(d.content || '{}');
        const isLaunched = !!(fresh.isRunning ?? fresh.isLaunched);
        // 更新内存中的会话配置，防止下次切回时用旧数据
        const idx = dialogueSessions.findIndex(s => s.id === cfg.id);
        if (idx >= 0) dialogueSessions[idx] = { ...dialogueSessions[idx], ...fresh, id: cfg.id };
        // 按文件最新状态设置按钮
        document.getElementById('agentStartBtn').disabled = isLaunched;
        document.getElementById('agentStopBtn').disabled  = !isLaunched;
      } catch (_) {}
    })
    .catch(() => {});

  // 额外查询进程级状态（status=running/waiting 等），仅用于更新状态文字，不再覆盖按钮
  // 按钮状态由第二层 fetch（读取文件 isRunning）决定，isRunning 是唯一状态源
  fetch(`/agent/status?sessionId=${encodeURIComponent(cfg.id)}`)
    .then(r => r.json())
    .then(data => {
      const active = data.isRunning ?? data.isLaunched;
      // 用文件 isRunning 同步按钮（唯一源），确保与第二层一致
      document.getElementById('agentStartBtn').disabled = !!active;
      document.getElementById('agentStopBtn').disabled  = !active;
      if (active) {
        if (data.status === 'waiting') {
          setAgentStatus('running', 'POLL 等待中');
        } else if (data.status === 'running') {
          agentRunning = true;
          setAgentStatus('running', '运行中');
        } else {
          // isRunning=true 但无进程（手动标记或重启过渡）
          setAgentStatus('running', '活跃中');
        }
      }
    })
    .catch(() => {});

  // 异步载入历史记录（不再在内部重连 SSE）
  if (_loadSessionAC) _loadSessionAC.abort();
  _loadSessionAC = new AbortController();
  loadSessionHistoryDoc(cfg.historyDoc, cfg.id, _loadSessionAC.signal);

  // 若配置了对端服务地址，从对端同步上下文和进程状态
  if (cfg.peerUrl) {
    fetch('/agent/sync-peer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: cfg.id, peerUrl: cfg.peerUrl, historyDoc: cfg.historyDoc }),
    }).then(r => r.json()).then(data => {
      if (!data.success) {
        showToast(`对端同步失败: ${data.error || '未知错误'}`, 'warn');
        return;
      }
      // 对端进程活跃：更新按钮状态
      if (data.peerAlive) {
        document.getElementById('agentStartBtn').disabled = true;
        document.getElementById('agentStopBtn').disabled = false;
        setAgentStatus('running', '对端运行中');
      }
      // 历史文档已从对端拉取并保存本地：重新载入显示
      if (data.historyFetched) {
        document.getElementById('agentOutput').innerHTML = '';
        if (_loadSessionAC) _loadSessionAC.abort();
        _loadSessionAC = new AbortController();
        loadSessionHistoryDoc(cfg.historyDoc, cfg.id, _loadSessionAC.signal);
        showToast('历史文档已从对端同步', 'success');
      } else if (data.peerAlive) {
        showToast('已同步对端进程状态', 'info');
      }
    }).catch(e => showToast(`对端连接失败: ${e.message}`, 'warn'));
  }

  showToast(`已切换: ${cfg.name}`, 'success');
}

// 通过 session ID 切换到对应会话（供气泡点击使用）
window.switchToSession = function(sid) {
  const cfg = dialogueSessions.find(s => s.id === sid);
  if (cfg) {
    if (cfg.type === 'pyagent') {
      const pyPanel = document.getElementById('pyagentPanel');
      const agentPanel = document.getElementById('agentPanel');
      if (agentPanel && agentPanel.classList.contains('open')) {
        agentPanel.classList.remove('open');
        document.body.classList.remove('agent-panel-open');
        const btn = document.getElementById('agentToggleBtn');
        if (btn) btn.classList.remove('active');
      }
      if (!pyPanel.classList.contains('open')) togglePyAgentPanel();
      applyPyAgentDialogue(cfg);
    } else {
      const panel = document.getElementById('agentPanel');
      const pyPanel = document.getElementById('pyagentPanel');
      if (pyPanel && pyPanel.classList.contains('open')) {
        pyPanel.classList.remove('open');
        const sessPanel = document.getElementById('sessionPanel');
        if (sessPanel) sessPanel.classList.remove('open');
      }
      if (!panel.classList.contains('open')) toggleAgentPanel();
      applyDialogue(cfg);
    }
    return;
  }
  // 面板未开或数据未加载：先加载，再切换
  loadDialogues().then(() => {
    const found = dialogueSessions.find(s => s.id === sid);
    if (!found) return;
    if (found.type === 'pyagent') {
      const pyPanel = document.getElementById('pyagentPanel');
      const agentPanel = document.getElementById('agentPanel');
      if (agentPanel && agentPanel.classList.contains('open')) {
        agentPanel.classList.remove('open');
        document.body.classList.remove('agent-panel-open');
        const btn = document.getElementById('agentToggleBtn');
        if (btn) btn.classList.remove('active');
      }
      if (!pyPanel.classList.contains('open')) togglePyAgentPanel();
      applyPyAgentDialogue(found);
    } else {
      const panel = document.getElementById('agentPanel');
      const pyPanel = document.getElementById('pyagentPanel');
      if (pyPanel && pyPanel.classList.contains('open')) {
        pyPanel.classList.remove('open');
        const sessPanel = document.getElementById('sessionPanel');
        if (sessPanel) sessPanel.classList.remove('open');
      }
      if (!panel.classList.contains('open')) toggleAgentPanel();
      applyDialogue(found);
    }
  });
};


async function loadSessionHistoryDoc(historyDoc, sessionId, signal) {
  const output = document.getElementById('agentOutput');
  // 先插入一个占位符，历史内容将被插入到它之前（这样不会覆盖已到达的 SSE 实时输出）
  const placeholder = document.createElement('div');
  placeholder.className = 'agent-history-placeholder';
  output.insertBefore(placeholder, output.firstChild);

  // 优先从 agent/chat/{sessionId} 加载聊天记录
  let chatLoaded = false;
  if (sessionId) {
    try {
      const chatPath = 'agent/chat/' + sessionId;
      const res = await fetch(`/api/file?path=${encodeURIComponent(chatPath)}`, {
        signal: signal || AbortSignal.timeout(10000),
      });
      if (signal && signal.aborted) { placeholder.remove(); return; }
      const data = await res.json();
      if (signal && signal.aborted) { placeholder.remove(); return; }
      if (data.success && data.content && data.content.trim()) {
        const block = document.createElement('div');
        block.className = 'agent-md-block agent-history-block';
        block.innerHTML = marked.parse(data.content);
        block.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
        output.insertBefore(block, placeholder);
        placeholder.remove();
        output.scrollTop = output.scrollHeight;
        setAgentStatus('idle', '空闲');
        chatLoaded = true;
      }
    } catch (e) {
      if (e.name === 'AbortError') { placeholder.remove(); return; }
    }
  }

  if (!chatLoaded && historyDoc) {
    try {
      const filePath = 'history/' + historyDoc;
      const res = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`, {
        signal: signal || AbortSignal.timeout(10000),
      });
      // 被 abort 时直接退出，不更新 UI（用户已切换到其他会话）
      if (signal && signal.aborted) { placeholder.remove(); return; }
      const data = await res.json();
      if (signal && signal.aborted) { placeholder.remove(); return; }
      if (data.success && data.content) {
        // 渲染 markdown 历史内容，插入到占位符位置（在所有实时输出之前）
        const block = document.createElement('div');
        block.className = 'agent-md-block agent-history-block';
        block.innerHTML = marked.parse(data.content);
        block.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
        const divider = document.createElement('div');
        divider.className = 'agent-history-divider';
        divider.textContent = '── 以上为历史记录 ──';
        output.insertBefore(divider, placeholder);
        output.insertBefore(block, divider);
        placeholder.remove();
        output.scrollTop = output.scrollHeight;
        setAgentStatus('idle', '空闲');
      } else {
        placeholder.textContent = '（暂无历史记录）';
        placeholder.className = 'agent-line system';
      }
    } catch (e) {
      if (e.name === 'AbortError') { placeholder.remove(); return; }
      placeholder.textContent = '（历史记录加载失败）';
      placeholder.className = 'agent-line system';
    }
  } else if (!chatLoaded) {
    placeholder.textContent = '（此会话暂无聊天记录）';
    placeholder.className = 'agent-line system';
  }

  if (signal && signal.aborted) return;

  // SSE 连接已在 applyDialogue 中同步建立，此处只同步后端状态到 UI
  // noReplay=true 时不会收到历史事件，需要主动查询后端状态来同步 UI
  try {
    const stRes = await fetch('/agent/status?sessionId=' + encodeURIComponent(sessionId), {
      signal: AbortSignal.timeout(5000),
    });
    if (signal && signal.aborted) return;
    const stData = await stRes.json();
    if (signal && signal.aborted) return;
    if (stData.success) {
      const s = stData.status;
      if (s === 'running') {
        agentRunning = true;
        document.getElementById('agentStartBtn').disabled = true;
        document.getElementById('agentStopBtn').disabled = false;
        setAgentStatus('running', '运行中');
        startElapsedTimer();
      } else if (s === 'waiting') {
        if (stData.pid) {
          // 进程仍活跃（POLL 等待中）→ 保持 Start 禁用，显示 POLL 状态
          agentRunning = true;
          document.getElementById('agentStartBtn').disabled = true;
          document.getElementById('agentStopBtn').disabled = false;
          setAgentStatus('running', 'POLL 等待中');
          startElapsedTimer();
        } else {
          // 进程已结束，自动确认
          agentRunning = false;
          document.getElementById('agentStartBtn').disabled = false;
          document.getElementById('agentStopBtn').disabled = true;
          setAgentStatus('done', `已完成`);
          confirmAgentDone();
        }
      }
      // idle / done / error → 保持已重置的空闲状态
      if (s === 'idle' || s === 'done' || s === 'error') {
        startHistoryPolling();  // 空闲时启动历史文件轮询
      }
    }
  } catch (_) {}
}

async function saveCurrentDialogue(id) {
  if (!id) return;
  const model = document.getElementById('agentModel').value || '';
  const historyDoc = document.getElementById('agentHistoryDoc').value || '';
  const taskPrefixDoc = document.getElementById('agentTaskPrefix').value || '';
  const systemDocs = selectedSystemDocs.slice();
  const saveAs = document.getElementById('agentSaveAs').value.trim() || '';
  const maxContinues = parseInt(document.getElementById('agentMaxCont').value) || 10;
  const useHistory = document.getElementById('agentUseHistory').checked;
  const hideTrace = document.getElementById('agentHideTrace').checked;
  const peerUrl = (document.getElementById('agentPeerUrl') || {}).value || '';
  const existing = dialogueSessions.find(s => s.id === id) || {};
  await fetch(`/api/dialogue/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...existing, model, historyDoc, taskPrefixDoc, systemDocs, saveAs, maxContinues, useHistory, hideTrace, peerUrl }),
  });
  await loadDialogues();
}

async function saveCurrentPyDialogue(id) {
  if (!id) return;
  const model = (document.getElementById('pyagentModel') || {}).value || '';
  const historyDoc = (document.getElementById('pyagentHistoryDoc') || {}).value || '';
  const taskPrefixDoc = (document.getElementById('pyagentTaskPrefix') || {}).value || '';
  const systemDocs = selectedPySystemDocs.slice();
  const existing = dialogueSessions.find(s => s.id === id) || {};
  await fetch(`/api/dialogue/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...existing, type: 'pyagent', model, historyDoc, taskPrefixDoc, systemDocs }),
  });
  await loadDialogues();
}

async function createDialogue() {
  const name = prompt('新建会话名称：');
  if (!name || !name.trim()) return;
  const trimName = name.trim();
  const model = document.getElementById('agentModel').value || 'claude-sonnet-4.6';

  // 默认配置
  const defaultTaskPrefixDoc = 'agent/setting/thinking.md';
  const defaultSystemDocs    = ['agent/application.md', 'agent/工具文档.md'];
  const defaultHideTrace     = true;
  const defaultUseHistory    = true;
  const defaultMaxContinues  = 10;

  // 自动创建历史文档（docs/history/<会话名>.md）
  let historyDoc = '';
  try {
    const safeFileName = trimName.replace(/[\/\\:*?"<>|]/g, '_');
    const histRes = await fetch('/open/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: `history/${safeFileName}`,
        content: `# ${trimName}\n\n> 会话创建于 ${new Date().toLocaleString('zh-CN')}\n`,
        overwrite: false,
      }),
    });
    const histData = await histRes.json();
    if (histData.success) {
      // path 形如 "history/xxx.md"，去掉前缀 "history/" 得到 historyDoc 值
      historyDoc = histData.path.replace(/^history\//, '');
    }
  } catch (_) {}

  const res = await fetch('/api/dialogue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: trimName,
      model,
      historyDoc,
      taskPrefixDoc: defaultTaskPrefixDoc,
      systemDocs:    defaultSystemDocs,
      saveAs:        '',
      maxContinues:  defaultMaxContinues,
      useHistory:    defaultUseHistory,
      hideTrace:     defaultHideTrace,
    }),
  });
  const data = await res.json();
  if (data.success) {
    activeDialogueId = data.id;
    await loadDialogues();
    const histMsg = historyDoc ? `，历史文档: history/${historyDoc}` : '';
    showToast(`已创建: ${trimName}${histMsg}`, 'success');
  }
}

async function deleteDialogue(id) {
  const s = dialogueSessions.find(x => x.id === id);
  if (!confirm(`删除会话「${s ? s.name : id}」？`)) return;
  try {
    await fetch(`/api/dialogue/${encodeURIComponent(id)}`, { method: 'DELETE' });
    // 清理 agent 状态，让气泡消失
    await fetch('/agent/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: id }),
    }).catch(() => {});
    await fetch('/agent/set-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: id, status: 'idle', task: '' }),
    }).catch(() => {});
    if (activeDialogueId === id) activeDialogueId = null;
    await loadDialogues();
  } catch (e) {
    showToast('删除失败', 'error');
  }
}

/* ===== API DEBUG CONSOLE ===== */
let consoleHistory = JSON.parse(localStorage.getItem('apiConsoleHistory') || '[]');
let consoleOpen = false;
let consoleActiveTab = 'req';

function toggleApiConsole() {
  const panel = document.getElementById('apiConsole');
  consoleOpen = !consoleOpen;
  panel.classList.toggle('open', consoleOpen);
  const btn = document.getElementById('consoleToggleBtn');
  if (btn) btn.classList.toggle('active', consoleOpen);
  if (consoleOpen) document.getElementById('consoleUrl').focus();
}

function switchConsoleTab(tab) {
  consoleActiveTab = tab;
  document.getElementById('consoleBodyReq').style.display = tab === 'req' ? 'flex' : 'none';
  document.getElementById('consoleBodyHist').style.display = tab === 'hist' ? 'flex' : 'none';
  document.getElementById('consoleTabReq').classList.toggle('active', tab === 'req');
  document.getElementById('consoleTabHist').classList.toggle('active', tab === 'hist');
  if (tab === 'hist') renderConsoleHistory();
}

function applyConsolePreset(val) {
  if (!val) return;
  const parts = val.split('|');
  document.getElementById('consoleMethod').value = parts[0] || 'GET';
  document.getElementById('consoleUrl').value = parts[1] || '';
  if (parts[2]) {
    document.getElementById('consoleBodyInput').value = parts[2].replace(/&quot;/g, '"');
    document.getElementById('consoleBodyEditorWrap').style.display = '';
  }
  document.getElementById('consolePreset').value = '';
  updateConsoleBodyVisibility();
}

function updateConsoleBodyVisibility() {
  const method = document.getElementById('consoleMethod').value;
  const wrap = document.getElementById('consoleBodyEditorWrap');
  wrap.style.display = ['GET','DELETE'].includes(method) ? 'none' : '';
}

document.addEventListener('DOMContentLoaded', () => {
  const methodSel = document.getElementById('consoleMethod');
  if (methodSel) methodSel.addEventListener('change', updateConsoleBodyVisibility);
  updateConsoleBodyVisibility();

  // Resize handle
  const resizeEl = document.getElementById('apiConsoleResize');
  const consoleEl = document.getElementById('apiConsole');
  if (resizeEl && consoleEl) {
    let startY, startH;
    resizeEl.addEventListener('mousedown', e => {
      startY = e.clientY;
      startH = consoleEl.offsetHeight;
      document.addEventListener('mousemove', onConsoleResize);
      document.addEventListener('mouseup', () => document.removeEventListener('mousemove', onConsoleResize), { once: true });
    });
    function onConsoleResize(e) {
      const delta = startY - e.clientY;
      const newH = Math.min(Math.max(startH + delta, 160), window.innerHeight * 0.8);
      consoleEl.style.height = newH + 'px';
    }
  }
});

function formatJsonResponse(text) {
  try {
    const obj = JSON.parse(text);
    return syntaxHighlightJson(JSON.stringify(obj, null, 2));
  } catch {
    return escapeHtml(text);
  }
}

function syntaxHighlightJson(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, match => {
      let cls = 'json-num';
      if (/^"/.test(match)) cls = /:$/.test(match) ? 'json-key' : 'json-str';
      else if (/true|false/.test(match)) cls = 'json-bool';
      else if (/null/.test(match)) cls = 'json-null';
      return '<span class="' + cls + '">' + match + '</span>';
    });
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n/1024).toFixed(1) + ' KB';
  return (n/1048576).toFixed(1) + ' MB';
}

async function sendApiRequest() {
  const method = document.getElementById('consoleMethod').value;
  const url = document.getElementById('consoleUrl').value.trim();
  const bodyText = document.getElementById('consoleBodyInput').value.trim();
  const respEl = document.getElementById('consoleResponse');
  const sendBtn = document.getElementById('consoleSendBtn');

  if (!url) { document.getElementById('consoleUrl').focus(); return; }

  respEl.innerHTML = '<div class="api-console-resp-empty" style="margin-top:8px">⏳ 请求中...</div>';
  sendBtn.disabled = true;

  const t0 = Date.now();
  let status = 0, resText = '', ok = false;

  try {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (!['GET','DELETE'].includes(method) && bodyText) {
      opts.body = bodyText;
    }
    const res = await fetch(url, opts);
    status = res.status;
    ok = res.ok;
    resText = await res.text();
  } catch (err) {
    resText = err.message;
    status = 0;
    ok = false;
  }

  const elapsed = Date.now() - t0;
  const sizeStr = formatBytes(new TextEncoder().encode(resText).length);

  const statusCls = ok ? 'ok' : 'err';
  const statusLabel = status ? status + ' ' + (ok ? 'OK' : 'Error') : 'Network Error';

  respEl.innerHTML =
    '<div class="api-console-resp-meta">' +
      '<span class="api-console-status ' + statusCls + '">' + escapeHtml(statusLabel) + '</span>' +
      '<span class="api-console-resp-time">' + elapsed + ' ms</span>' +
      '<span class="api-console-resp-size">' + sizeStr + '</span>' +
    '</div>' +
    '<div class="api-console-resp-body">' + formatJsonResponse(resText) + '</div>';

  sendBtn.disabled = false;

  // Save to history
  consoleHistory.unshift({ method, url, body: bodyText, status, ok, elapsed, time: new Date().toLocaleTimeString() });
  if (consoleHistory.length > 50) consoleHistory = consoleHistory.slice(0, 50);
  localStorage.setItem('apiConsoleHistory', JSON.stringify(consoleHistory));
}

function renderConsoleHistory() {
  const list = document.getElementById('consoleHistList');
  if (!consoleHistory.length) {
    list.innerHTML = '<div class="api-console-resp-empty">暂无历史记录</div>';
    return;
  }
  list.innerHTML = consoleHistory.map((h, i) =>
    '<div class="api-console-hist-item" onclick="loadConsoleHistItem(' + i + ')">' +
      '<span class="api-console-hist-method">' + escapeHtml(h.method) + '</span>' +
      '<span class="api-console-hist-url" title="' + escapeHtml(h.url) + '">' + escapeHtml(h.url) + '</span>' +
      '<span class="api-console-hist-status ' + (h.ok ? 'ok' : 'err') + '">' + (h.status || '×') + '</span>' +
      '<span class="api-console-hist-time">' + h.elapsed + 'ms</span>' +
      '<span class="api-console-hist-time">' + escapeHtml(h.time) + '</span>' +
    '</div>'
  ).join('');
}

function loadConsoleHistItem(i) {
  const h = consoleHistory[i];
  if (!h) return;
  document.getElementById('consoleMethod').value = h.method;
  document.getElementById('consoleUrl').value = h.url;
  document.getElementById('consoleBodyInput').value = h.body || '';
  updateConsoleBodyVisibility();
  switchConsoleTab('req');
}

function clearConsoleHistory() {
  consoleHistory = [];
  localStorage.removeItem('apiConsoleHistory');
  renderConsoleHistory();
}


// ===== SESSION STATUS BUBBLES =====
(function () {
  const STATUS_LABELS = {
    running: '思考中...',
    waiting: '等待中...',
    done:    '已完成',
    error:   '出错',
    idle:    '空闲',
  };
  const STATUS_ICONS = {
    running: null,       // spinner div
    waiting: '💤',
    done:    '✅',
    error:   '❌',
    idle:    '💤',
  };

  let lastBubbleData = '';
  const _actionCache = {}; // sessionId → { type, label }

  // Called from SSE handler to instantly update action sub-line in bubble
  window.updateBubbleAction = function(sid, action) {
    _actionCache[sid] = action;
    const bubble = document.querySelector(`#sessionBubbles .sess-bubble[data-sid="${CSS.escape(sid)}"]`);
    if (!bubble) return;
    let sub = bubble.querySelector('.bubble-action-sub');
    if (action && action.label && action.type !== 'idle') {
      if (!sub) {
        sub = document.createElement('div');
        sub.className = 'alith-bubble-sub bubble-action-sub';
        const body = bubble.querySelector('.alith-bubble-body');
        if (body) body.insertBefore(sub, body.querySelector('.bubble-elapsed-sub'));
      }
      sub.textContent = '⚙️ ' + action.label;
    } else {
      if (sub) sub.remove();
    }
  };

  function renderBubbles(sessions) {
    const container = document.getElementById('sessionBubbles');
    if (!container) return;

    // Only show non-idle sessions; show 'done' briefly
    const active = sessions.filter(s => s.status !== 'idle');
    const key = JSON.stringify(active);
    if (key === lastBubbleData) return;
    lastBubbleData = key;

    // Apply max-height from global config
    const maxH = (window.ALITH_CONFIG && window.ALITH_CONFIG.bubbleMaxHeight) || 420;
    container.style.maxHeight = maxH + 'px';
    container.style.overflowY = 'auto';

    if (!active.length) { container.innerHTML = ''; return; }

    container.innerHTML = active.map(s => {
      const colorClass = { running: 'accent', waiting: 'warning', done: 'success', error: 'danger' }[s.status] || '';
      const label  = STATUS_LABELS[s.status] || s.status;
      const icon   = STATUS_ICONS[s.status];
      const iconHtml = icon
        ? `<span style="font-size:15px;flex-shrink:0">${icon}</span>`
        : `<div class="alith-spinner"></div>`;
      const name   = (s.name || s.id || '会话').slice(0, 30);
      const task   = (s.task || '准备中…').slice(0, 80);
      const elapsed = s.elapsedSec != null ? `${s.elapsedSec}s` : '';
      // Use cached action (updated via SSE) over API-polled value
      const cachedAction = _actionCache[s.id] || s.currentAction;
      const actionLabel = cachedAction && cachedAction.type !== 'idle' ? cachedAction.label : '';
      const sidEsc = escapeHtml(s.id).replace(/'/g, "\\'");
      // Context progress ring
      const ctxPct = s.contextProgress || 0;
      const ctxColor = ctxPct >= 80 ? 'var(--danger)' : ctxPct >= 60 ? 'var(--warning)' : 'var(--success)';
      const ctxStyle = ctxPct > 0 ? `--ctx-pct:${ctxPct};--ctx-ring-color:${ctxColor};--ctx-ring-opacity:1;` : '';
      return `<div class="alith-bubble sess-bubble ${colorClass}" data-sid="${escapeHtml(s.id)}" onclick="window.switchToSession('${sidEsc}')" style="cursor:pointer;${ctxStyle}" title="点击切换到此会话">
        ${iconHtml}
        <div class="alith-bubble-body">
          <div class="alith-bubble-label">${escapeHtml(name)} · ${label}${ctxPct > 0 ? ` · 📊${ctxPct}%` : ''}</div>
          <div class="alith-bubble-main">${escapeHtml(task)}</div>
          ${actionLabel ? `<div class="alith-bubble-sub bubble-action-sub">⚙️ ${escapeHtml(actionLabel)}</div>` : '<div class="alith-bubble-sub bubble-action-sub" style="display:none"></div>'}
          ${elapsed ? `<div class="alith-bubble-sub bubble-elapsed-sub">⏱ ${elapsed}</div>` : ''}
        </div>
        <button class="alith-bubble-open" title="在编辑器中打开会话文件" onclick="event.stopPropagation();openFile('dialogue/${escapeHtml(s.id)}')">📂</button>
        <button class="alith-bubble-close" title="关闭此气泡" onclick="event.stopPropagation();window.dismissSessionBubble('${sidEsc}')">✕</button>
      </div>`;
    }).join('');
  }

  window.dismissSessionBubble = async function(sid) {
    try {
      // Check if this is a PyAgent session (dialogue file has type='pyagent')
      const dialSess = (typeof dialogueSessions !== 'undefined' ? dialogueSessions : []).find(d => d.id === sid);
      if (dialSess && dialSess.type === 'pyagent') {
        // PyAgent: mark isRunning=false in dialogue file
        await fetch(`/api/dialogue/${encodeURIComponent(sid)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isRunning: false }),
        });
      } else {
        await fetch('/agent/set-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sid, status: 'idle', task: '' }),
        });
      }
      // 立即从 DOM 移除，不等下次 poll
      const el = document.querySelector(`#sessionBubbles [data-sid="${sid}"]`);
      if (el) el.remove();
      lastBubbleData = null; // 强制下次 poll 重新渲染
    } catch (_) {}
  };

  async function pollSessionBubbles() {
    try {
      // Get agent session statuses (with timeout to prevent hanging)
      const [sessRes, dialRes] = await Promise.all([
        fetch('/agent/sessions', { signal: AbortSignal.timeout(4000) }),
        fetch('/api/dialogue',   { signal: AbortSignal.timeout(4000) }),
      ]);
      const sessData = await sessRes.json();
      const dialData = await dialRes.json();

      const nameMap = {};
      const sessions = dialData.sessions || [];
      sessions.forEach(d => { nameMap[d.id] = d.name; });

      // Also get elapsed time for running sessions
      const agentSessions = sessData.sessions || [];
      const enriched = await Promise.all(agentSessions
        .filter(s => s.status !== 'idle')
        .map(async s => {
          try {
            const r = await fetch(`/agent/status?sessionId=${encodeURIComponent(s.id)}`, {
              signal: AbortSignal.timeout(3000),
            });
            const d = await r.json();
            return { ...s, name: nameMap[s.id] || s.id, elapsedSec: d.elapsedSec, currentAction: d.currentAction, contextProgress: d.contextProgress || 0 };
          } catch (_) {
            return { ...s, name: nameMap[s.id] || s.id };
          }
        })
      );

      // Also include running PyAgent sessions (type=pyagent, isRunning=true in dialogue file)
      // Status is read directly from dialogue file (written by agent via POST /agent/set-status)
      const pyagentRunning = sessions.filter(d => d.type === 'pyagent' && d.isRunning);
      const pyEnriched = pyagentRunning.map(d => {
        // agentStatus/agentTask are persisted to dialogue file by /agent/set-status handler
        const status = d.agentStatus || 'running';
        const task   = d.agentTask  || '执行中…';
        return {
          id: d.id,
          name: '🐍 ' + (d.name || d.id),
          status,
          task,
          contextProgress: d.contextProgress || 0,
          _isPyAgent: true,
        };
      });

      // Deduplicate: if a PyAgent session is already tracked in /agent/sessions (enriched),
      // don't add it again from pyEnriched to avoid duplicate bubbles
      const enrichedIds = new Set(enriched.map(s => s.id));
      const dedupedPy   = pyEnriched.filter(s => !enrichedIds.has(s.id));
      const allEnriched = [...enriched, ...dedupedPy];
      renderBubbles(allEnriched);
      syncStartBtnWithSessionStatus(allEnriched);
    } catch (_) {}
  }

  // Disable "启动 Agent" button while active session is in POLL waiting state
  function syncStartBtnWithSessionStatus(sessions) {
    const btn = document.getElementById('agentStartBtn');
    if (!btn) return;
    // If agent is actively running via SSE, don't interfere
    if (agentRunning) return;

    const activeSid = typeof getActiveSessionId === 'function' ? getActiveSessionId() : null;
    const activeSess = activeSid
      ? sessions.find(s => s.id === activeSid)
      : sessions.find(s => s.status === 'waiting' || s.status === 'running');

    if (activeSess && activeSess.status === 'waiting') {
      btn.disabled = true;
      btn.title = 'Agent 正在 POLL 等待中，请通过输入栏发送新任务';
      if (!btn.dataset.pollLabel) {
        btn.dataset.pollLabel = '1';
        btn.dataset.origText = btn.innerHTML;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:restart-spin 1.2s linear infinite"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> POLL 等待中`;
      }
    } else {
      // Restore button if it was put into poll-label mode
      if (btn.dataset.pollLabel) {
        btn.disabled = false;
        btn.title = '启动 Agent';
        btn.innerHTML = btn.dataset.origText || '启动 Agent';
        delete btn.dataset.pollLabel;
        delete btn.dataset.origText;
      }
    }
  }

  // Start polling every 3 seconds
  setInterval(pollSessionBubbles, 3000);
  pollSessionBubbles();

  // Also expose for external trigger
  window.refreshSessionBubbles = pollSessionBubbles;
})();

// ===== ZONE HIGHLIGHT MODE (Live Element Picker) =====
(function () {
  let active = false;
  let currentInfo = '';

  const PANEL_IDS = new Set(['zonePickResult','zonePickInfo','zonePickTitle','zonePickCopyBtn','zonePickClose','zoneOverlay','zoneLabel','zoneHighlightBtn']);

  function getOverlay() { return document.getElementById('zoneOverlay'); }
  function getLabel()   { return document.getElementById('zoneLabel'); }
  function getBtn()     { return document.getElementById('zoneHighlightBtn'); }
  function getPanel()   { return document.getElementById('zonePickResult'); }
  function getInfo()    { return document.getElementById('zonePickInfo'); }
  function getCopyBtn() { return document.getElementById('zonePickCopyBtn'); }

  function elInfo(el) {
    if (!el) return '';
    const tag = el.tagName.toLowerCase();
    const id  = el.id ? '#' + el.id : '';
    const cls = typeof el.className === 'string' && el.className.trim()
                ? '.' + el.className.trim().split(/\s+/).slice(0, 4).join('.') : '';
    const txt = (el.title || el.getAttribute('aria-label') || el.textContent || '')
                  .trim().replace(/\s+/g, ' ').slice(0, 50);
    return tag + id + cls + (txt ? ' "' + txt + '"' : '');
  }

  function isInPanel(el) {
    let node = el;
    while (node) {
      if (PANEL_IDS.has(node.id)) return true;
      node = node.parentElement;
    }
    return false;
  }

  function setActive(on) {
    active = on;
    document.body.classList.toggle('zone-highlight-mode', on);
    const btn = getBtn();
    if (btn) btn.classList.toggle('active', on);
    const ov  = getOverlay();
    const lbl = getLabel();
    // Always hide overlay & cursor label when exiting
    if (!on) {
      if (ov)  { ov.style.display = 'none'; }
      if (lbl) { lbl.style.display = 'none'; }
      // NOTE: panel stays open! User closes it manually with ✕
    } else {
      // Show panel when activating
      const panel = getPanel();
      if (panel) { panel.style.display = 'flex'; }
    }
  }

  window.toggleZoneHighlight = function () { setActive(!active); };

  // Copy button handler (real user gesture → clipboard works)
  document.addEventListener('click', function (e) {
    const cb = getCopyBtn();
    if (!cb) return;
    if (e.target === cb || cb.contains(e.target)) {
      e.stopPropagation();
      if (!currentInfo) return;
      const text = currentInfo;
      // Try modern API first (works on HTTPS/localhost)
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          flashCopied(cb);
        }).catch(function () { fallbackCopy(text, cb); });
      } else {
        fallbackCopy(text, cb);
      }
    }
  }, true);

  function fallbackCopy(text, btn) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { document.execCommand('copy'); flashCopied(btn); } catch(e) {}
    document.body.removeChild(ta);
  }

  function flashCopied(btn) {
    if (!btn) return;
    btn.classList.add('copied');
    btn.textContent = '✓ 已复制';
    setTimeout(function () {
      btn.classList.remove('copied');
      btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> 复制';
    }, 1500);
  }

  // Close button
  document.addEventListener('click', function (e) {
    const cl = document.getElementById('zonePickClose');
    if (cl && (e.target === cl || cl.contains(e.target))) {
      setActive(false);
    }
  }, true);

  // Mouse move: update overlay + bubble info
  window.addEventListener('mousemove', function (e) {
    if (!active) return;
    const ov  = getOverlay();
    const lbl = getLabel();
    const infoEl = getInfo();

    // Find element under cursor, skip our own UI
    let el = document.elementFromPoint(e.clientX, e.clientY);
    while (el && isInPanel(el)) el = el.parentElement;
    if (!el || el === document.documentElement || el === document.body) {
      if (ov)  ov.style.display = 'none';
      if (lbl) lbl.style.display = 'none';
      return;
    }

    const info = elInfo(el);
    currentInfo = info;

    // Update overlay box
    if (ov) {
      const r = el.getBoundingClientRect();
      ov.style.top    = r.top    + 'px';
      ov.style.left   = r.left   + 'px';
      ov.style.width  = r.width  + 'px';
      ov.style.height = r.height + 'px';
      ov.style.display = 'block';
    }

    // Update bubble info
    if (infoEl) infoEl.textContent = info;

    // Small cursor tooltip
    if (lbl) {
      const W = window.innerWidth, pad = 14;
      let left = e.clientX + pad;
      if (left + 200 > W) left = e.clientX - 200;
      lbl.style.left = left + 'px';
      lbl.style.top  = (e.clientY - 28) + 'px';
      lbl.textContent = el.tagName.toLowerCase() + (el.id ? '#'+el.id : '');
      lbl.style.display = 'block';
    }
  }, false);

  // ESC: exit
  window.addEventListener('keydown', function (e) {
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      setActive(false);
    }
  }, true);

  window.addEventListener('mouseleave', function () {
    if (!active) return;
    const ov = getOverlay(), lbl = getLabel();
    if (ov)  ov.style.display  = 'none';
    if (lbl) lbl.style.display = 'none';
  });
})();

// ===== POWER REPAIR =====
function powerRepair() {
  const fixes = [];

  // 1. 关闭 Agent 面板
  const agentPanel = document.getElementById('agentPanel');
  const sessionPanel = document.getElementById('sessionPanel');
  const agentBtn = document.getElementById('agentToggleBtn');
  if (agentPanel && agentPanel.classList.contains('open')) {
    agentPanel.classList.remove('open');
    if (sessionPanel) sessionPanel.classList.remove('open');
    if (agentBtn) agentBtn.classList.remove('active');
    document.body.classList.remove('agent-panel-open');
    fixes.push('关闭 Agent 面板');
  }

  // 2. 关闭 API 控制台
  const apiConsole = document.getElementById('apiConsole');
  const consoleBtn = document.getElementById('consoleToggleBtn');
  if (apiConsole && apiConsole.classList.contains('open')) {
    apiConsole.classList.remove('open');
    if (consoleBtn) consoleBtn.classList.remove('active');
    window.consoleOpen = false;
    fixes.push('关闭 API 控制台');
  }

  // 3. 退出 Zone Highlight 模式
  if (document.body.classList.contains('zone-highlight-mode')) {
    document.body.classList.remove('zone-highlight-mode');
    const zhBtn = document.getElementById('zoneHighlightBtn');
    if (zhBtn) zhBtn.classList.remove('active');
    const ov = document.getElementById('zoneOverlay');
    const lbl = document.getElementById('zoneLabel');
    if (ov) ov.style.display = 'none';
    if (lbl) lbl.style.display = 'none';
    fixes.push('退出 Zone 拾取模式');
  }

  // 4. 清除 body 上所有残留 class 异常（保留合法 class）
  const safeBodyClasses = new Set(['agent-panel-open', 'zone-highlight-mode', 'sidebar-collapsed']);
  const strayClasses = [...document.body.classList].filter(c => !safeBodyClasses.has(c) && c.startsWith('is-') || c.startsWith('modal-'));
  strayClasses.forEach(c => { document.body.classList.remove(c); });
  if (strayClasses.length) fixes.push('清除残留 body class');

  // 5. 重置 main-layout padding（强制刷新）
  const mainLayout = document.querySelector('.main-layout');
  if (mainLayout) {
    mainLayout.style.paddingRight = '';
    setTimeout(() => { mainLayout.style.paddingRight = ''; }, 50);
  }

  // 6. 关闭可能残留的 modal / overlay
  document.querySelectorAll('.modal-overlay.show').forEach(el => {
    el.classList.remove('show');
    fixes.push('关闭残留 modal');
  });

  // 7. 刷新 session 气泡
  if (typeof window.refreshSessionBubbles === 'function') {
    window.refreshSessionBubbles();
    fixes.push('刷新 Session 气泡');
  }

  // 8. 刷新文件树
  if (typeof refreshTree === 'function') {
    refreshTree();
    fixes.push('刷新文件树');
  }

  // 9. 重置保存状态栏
  const saveStatus = document.getElementById('saveStatus');
  if (saveStatus && saveStatus.textContent.includes('错误')) {
    saveStatus.textContent = '';
    fixes.push('清除错误状态');
  }

  // 10. 修复按钮动画反馈
  const repairBtn = document.getElementById('repairBtn');
  if (repairBtn) {
    repairBtn.classList.add('repair-done');
    setTimeout(() => repairBtn.classList.remove('repair-done'), 1200);
  }

  const summary = fixes.length ? fixes.join(' · ') : '界面状态正常，无需修复';
  showToast(`🔧 修复完成：${summary}`, 'success');
}

// ===== ERROR REPORT =====
function openErrorReportDialog() {
  const overlay = document.getElementById('errorReportOverlay');
  if (!overlay) return;
  // Reset fields
  document.getElementById('errorReportTitle').value = '';
  document.getElementById('errorReportDesc').value = '';
  document.getElementById('errorReportDevice').value = '';
  const status = document.getElementById('errorReportStatus');
  status.style.display = 'none';
  status.textContent = '';
  document.getElementById('errorReportSubmitBtn').disabled = false;
  overlay.classList.add('show');
  setTimeout(() => document.getElementById('errorReportDesc').focus(), 100);
}

function closeErrorReportDialog() {
  const overlay = document.getElementById('errorReportOverlay');
  if (overlay) overlay.classList.remove('show');
}

async function submitErrorReport() {
  const title = document.getElementById('errorReportTitle').value.trim();
  const description = document.getElementById('errorReportDesc').value.trim();
  const device = document.getElementById('errorReportDevice').value.trim();
  const statusEl = document.getElementById('errorReportStatus');
  const submitBtn = document.getElementById('errorReportSubmitBtn');

  if (!description) {
    statusEl.style.display = 'block';
    statusEl.style.background = 'rgba(239,68,68,0.12)';
    statusEl.style.color = '#f87171';
    statusEl.textContent = '❌ 错误描述不能为空，请填写后再提交';
    return;
  }

  submitBtn.disabled = true;
  statusEl.style.display = 'block';
  statusEl.style.background = 'rgba(99,102,241,0.1)';
  statusEl.style.color = 'var(--text-secondary)';
  statusEl.textContent = '⏳ 提交中…';

  try {
    const res = await fetch('/open/report-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, device: device || undefined }),
    });
    const data = await res.json();
    if (data.success) {
      statusEl.style.background = 'rgba(34,197,94,0.12)';
      statusEl.style.color = '#4ade80';
      statusEl.textContent = `✅ ${data.message} → ${data.path}`;
      showToast('🚨 错误报告已提交', 'success');
      setTimeout(closeErrorReportDialog, 1800);
    } else {
      throw new Error(data.error || '提交失败');
    }
  } catch (e) {
    statusEl.style.background = 'rgba(239,68,68,0.12)';
    statusEl.style.color = '#f87171';
    statusEl.textContent = `❌ 提交失败: ${e.message}`;
    submitBtn.disabled = false;
  }
}

// ===== PYAGENT SESSION PANEL =====
(function () {
  let activePyAgentSession  = null; // { id, name, ... }
  let pyagentEventSource    = null; // current SSE connection
  let pyagentRunning        = false;
  let pyagentElapsedTimer   = null;
  let pyagentStartTime      = null;
  let _pyOutputBuf          = '';   // partial-line buffer (kept for backward compat)
  let _pyLiveMdBuf          = '';   // accumulated live output text for markdown rendering
  let _pyMdRenderTimer      = null; // debounce timer for live markdown render
  let _statusFetchAbortCtrl = null; // AbortController for in-flight applyPyAgentDialogue status fetch
  let _currentPyRunId = null;       // runId of the currently expected run; ignore status events from other runs
  let _pyTickInterval = null;       // 500ms tick: keeps button state in sync with server
  let _pyStarting     = false;      // true during startup: tick won't un-gray button until server confirms running
  let _pyDisplayGen   = 0;          // incremented on startPyAgent; cancels stale async IIFE in applyPyAgentDialogue
  const _pySessionBanners = new Map(); // sessionId → { visible, html } per-session banner state

  // Strip ANSI escape codes
  function stripAnsi(s) {
    // eslint-disable-next-line no-control-regex
    return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
  }

  // 从 agent/chat 文件刷新显示（替换 history block，保留 live SSE 输出区）
  // 在 startPyAgent / continuePyAgentTask 成功后调用，显示已持久化的用户输入
  function refreshPyChatDisplay(sessionId) {
    const output = document.getElementById('pyagentOutput');
    if (!output) return;
    fetch(`/api/file?path=${encodeURIComponent('agent/chat/' + sessionId)}`)
      .then(r => r.json())
      .then(data => {
        if (!data.success || !data.content || !data.content.trim()) return;
        const out = document.getElementById('pyagentOutput');
        if (!out) return;
        // 重置 live buffer
        _pyLiveMdBuf = '';
        if (_pyMdRenderTimer) { clearTimeout(_pyMdRenderTimer); _pyMdRenderTimer = null; }
        // 清空并重建为一个 history block（包含最新的用户输入+已有记录）
        out.innerHTML = '';
        const block = document.createElement('div');
        block.className = 'agent-md-block agent-history-block';
        try { block.innerHTML = marked.parse(data.content); } catch (_e) { block.textContent = data.content; }
        block.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
        out.appendChild(block);
        requestAnimationFrame(() => {
          out.scrollTop = out.scrollHeight;
          requestAnimationFrame(() => { out.scrollTop = out.scrollHeight; });
        });
        setTimeout(() => { out.scrollTop = out.scrollHeight; }, 150);
      }).catch(() => {});
  }

  // Render accumulated live output as markdown into a dedicated block
  function renderPyLiveMd(output) {
    if (!_pyLiveMdBuf || !output) return;
    let live = output.querySelector('.py-live-md');
    if (!live) {
      live = document.createElement('div');
      live.className = 'py-live-md agent-md-block';
      output.appendChild(live);
    }
    try {
      live.innerHTML = marked.parse(_pyLiveMdBuf);
      live.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
    } catch (_) {
      live.textContent = _pyLiveMdBuf;
    }
    output.scrollTop = output.scrollHeight;
  }

  // Render pending buffer + new text into the output div (with markdown rendering)
  function appendPyOutput(rawText, output) {
    const text = stripAnsi(rawText).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    _pyLiveMdBuf += text;
    // Debounced markdown render every 300ms to avoid excessive DOM ops during streaming
    if (_pyMdRenderTimer) clearTimeout(_pyMdRenderTimer);
    _pyMdRenderTimer = setTimeout(() => {
      _pyMdRenderTimer = null;
      renderPyLiveMd(output);
    }, 300);
  }

  // Flush: final markdown render when stream ends
  function flushPyOutput(output) {
    if (_pyMdRenderTimer) { clearTimeout(_pyMdRenderTimer); _pyMdRenderTimer = null; }
    renderPyLiveMd(output);
    _pyOutputBuf = '';
  }

  function startPyElapsedTimer() {
    clearInterval(pyagentElapsedTimer);
    pyagentStartTime = Date.now();
    pyagentElapsedTimer = setInterval(() => {
      const s = Math.floor((Date.now() - pyagentStartTime) / 1000);
      const el = document.getElementById('pyagentElapsed');
      if (el) el.textContent = `已运行 ${s}s`;
    }, 1000);
  }

  function stopPyElapsedTimer() {
    clearInterval(pyagentElapsedTimer);
    pyagentElapsedTimer = null;
  }

  function updatePyActionBar(icon, label) {
    const bar = document.getElementById('pyagentActionBar');
    const iconEl = document.getElementById('pyagentActionIcon');
    const labelEl = document.getElementById('pyagentActionLabel');
    if (!bar) return;
    if (!label) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    if (iconEl) iconEl.textContent = icon || '⚙️';
    if (labelEl) labelEl.textContent = label;
  }

  function showPyConfirmBar() {
    const bar = document.getElementById('pyagentConfirmBar');
    const input = document.getElementById('pyagentConfirmInput');
    if (!bar) return;
    if (input) input.value = '';
    bar.style.display = 'flex';
  }

  function hidePyConfirmBar() {
    const bar = document.getElementById('pyagentConfirmBar');
    if (bar) bar.style.display = 'none';
  }

  window.confirmPyAgentDone = function () {
    hidePyConfirmBar();
  };

  window.continuePyAgentTask = async function () {
    const extra = (document.getElementById('pyagentConfirmInput').value || '').trim();
    hidePyConfirmBar();
    if (!activePyAgentSession) return;
    const task = (document.getElementById('pyagentTask').value || '').trim();
    const combined = extra || task;
    if (!combined) { showToast('请输入追加任务', 'error'); return; }

    // 立即在输出区显示用户追加的输入（不等 fetch 完成）
    const output = document.getElementById('pyagentOutput');
    if (output) {
      const userMsgDiv = document.createElement('div');
      userMsgDiv.className = 'agent-md-block user-msg-block';
      try {
        userMsgDiv.innerHTML = marked.parse(`> 💬 **[用户追加输入]**\n>\n> ${combined.replace(/\n/g, '\n> ')}\n`);
      } catch (_e) {
        userMsgDiv.textContent = `💬 ${combined}`;
      }
      output.appendChild(userMsgDiv);
      requestAnimationFrame(() => { output.scrollTop = output.scrollHeight; });
    }

    try {
      await fetch('/pyagent/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activePyAgentSession.id, input: combined }),
      });
      // 从已持久化的 agent/chat 文件刷新显示（包含用户追加输入）
      refreshPyChatDisplay(activePyAgentSession.id);
      setPyAgentRunning(true);
      startPyElapsedTimer();
      updatePyActionBar('🐍', '继续执行…');
      showToast('追加任务已发送', 'success');
    } catch (e) {
      showToast('发送失败: ' + e.message, 'error');
    }
  };

  // ── Toggle PyAgent panel open/close ──────────────────────────
  window.togglePyAgentPanel = function () {
    const panel      = document.getElementById('pyagentPanel');
    const sessPanel  = document.getElementById('sessionPanel');
    const agentPanel = document.getElementById('agentPanel');
    const isOpen = panel.classList.toggle('open');
    // mirror session panel open state so it slides out alongside
    if (sessPanel) sessPanel.classList.toggle('open', isOpen);
    // close CopilotCli panel when opening PyAgent panel
    if (isOpen && agentPanel && agentPanel.classList.contains('open')) {
      agentPanel.classList.remove('open');
      document.body.classList.remove('agent-panel-open');
      const btn = document.getElementById('agentToggleBtn');
      if (btn) btn.classList.remove('active');
    }
    if (isOpen) {
      loadDialogues().then(() => {
        if (activePyAgentSession) {
          const output = document.getElementById('pyagentOutput');
          const hasContent = output && output.children.length > 0;
          if (!hasContent) {
            // 输出为空时才做完整加载（避免清空正在显示的内容）
            applyPyAgentDialogue(activePyAgentSession);
          } else if (!pyagentEventSource || pyagentEventSource.readyState === EventSource.CLOSED) {
            // 有内容但 SSE 断开，仅重连 SSE
            connectPyAgentStream(activePyAgentSession.id);
          }
        }
      });
      loadAgentModels();
      loadHistoryDocs();
      loadTaskPrefixDocs();
      populateAgentDocSelector();
    }
  };

  // ── Create a new PyAgent session ─────────────────────────────
  window.createPyAgentDialogue = async function () {
    const name = prompt('新建 PyAgent 会话名称：');
    if (!name || !name.trim()) return;
    const trimName = name.trim();

    // Default system docs and task prefix
    const defaultSystemDocs   = ['agent/application.md', 'agent/工具文档.md'];
    const defaultTaskPrefix   = 'agent/setting/pyagent-thinking.md';
    const defaultHistoryDoc   = `${trimName}.md`;

    try {
      // Create a history document for this session
      await fetch('/open/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: `history/${trimName}`,
          content: `# 会话历史: ${trimName}\n\n> 创建于 ${new Date().toISOString()}\n\n---\n\n`,
          overwrite: false,
        }),
      });

      // POST creates the session file with defaults
      const res = await fetch('/api/dialogue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimName,
          type: 'pyagent',
          model: '',
          historyDoc: defaultHistoryDoc,
          taskPrefixDoc: defaultTaskPrefix,
          systemDocs: defaultSystemDocs,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '创建失败');

      // PUT adds type field (POST may not preserve all fields if server.js not hot-reloaded)
      await fetch(`/api/dialogue/${encodeURIComponent(data.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'pyagent', name: trimName }),
      });

      // ensure session panel & pyagent panel are open
      const panel = document.getElementById('pyagentPanel');
      if (!panel.classList.contains('open')) togglePyAgentPanel();
      await loadDialogues();
      const created = dialogueSessions.find(s => s.id === data.id);
      if (created) applyPyAgentDialogue(created);
      showToast(`已创建 PyAgent 会话: ${trimName}`, 'success');
    } catch (e) {
      showToast('创建失败: ' + e.message, 'error');
    }
  };

  // ── Apply (switch to) a PyAgent session ──────────────────────
  window.applyPyAgentDialogue = function (cfg) {
    activePyAgentSession = cfg;
    window.activePyAgentSession = cfg;   // expose for outer-scope access
    activeDialogueId     = cfg.id;
    renderSessionList();

    // 应用模型
    const modelSel = document.getElementById('pyagentModel');
    if (modelSel && cfg.model) {
      for (const opt of modelSel.options) {
        if (opt.value === cfg.model) { opt.selected = true; break; }
      }
    }

    // 应用 historyDoc
    const histSel = document.getElementById('pyagentHistoryDoc');
    if (histSel) {
      const histVal = cfg.historyDoc || '';
      let found = false;
      for (const opt of histSel.options) {
        if (opt.value === histVal) { opt.selected = true; found = true; break; }
      }
      if (!found && histVal) {
        const opt = document.createElement('option');
        opt.value = histVal; opt.textContent = histVal.replace(/\.md$/, '');
        histSel.appendChild(opt); histSel.value = histVal;
      }
    }

    // 应用 taskPrefixDoc
    const prefSel = document.getElementById('pyagentTaskPrefix');
    if (prefSel) {
      const prefVal = cfg.taskPrefixDoc || '';
      let found = false;
      for (const opt of prefSel.options) {
        if (opt.value === prefVal) { opt.selected = true; found = true; break; }
      }
      if (!found && prefVal) {
        const opt = document.createElement('option');
        opt.value = prefVal; opt.textContent = prefVal.replace(/\.md$/, '');
        prefSel.appendChild(opt); prefSel.value = prefVal;
      }
    }

    // 应用 systemDocs
    selectedPySystemDocs = Array.isArray(cfg.systemDocs) ? cfg.systemDocs.slice() : [];
    renderPySysdocTags();

    // Reset UI — 按钮默认启用，由即时状态查询和 tick 决定真实状态（避免 cfg.isRunning 残留导致闪烁）
    _pyOutputBuf = '';  // clear streaming line buffer
    _pyLiveMdBuf = '';  // clear live markdown buffer
    if (_pyMdRenderTimer) { clearTimeout(_pyMdRenderTimer); _pyMdRenderTimer = null; }
    document.getElementById('pyagentTask').value = '';
    document.getElementById('pyagentOutput').innerHTML = '';
    document.getElementById('pyagentStatusText').textContent = '空闲';
    document.getElementById('pyagentStatusDot').className = 'agent-status-dot';
    document.getElementById('pyagentStartBtn').disabled = false;
    document.getElementById('pyagentStopBtn').disabled  = true;
    closePyAgentInputBar();
    document.getElementById('pyagentStatusInfo').textContent = '';
    document.getElementById('pyagentElapsed').textContent = '';
    stopPyElapsedTimer();
    updatePyActionBar('', '');
    hidePyConfirmBar();
    pyagentRunning = false;

    // 恢复本会话的任务横幅状态（每个 PyAgent 会话独立维护横幅）
    const _switchBanner = document.getElementById('py-current-task-banner');
    if (_switchBanner) {
      const _savedBanner = _pySessionBanners.get(cfg.id);
      if (_savedBanner && _savedBanner.visible && _savedBanner.html) {
        _switchBanner.style.display = 'block';
        _switchBanner.innerHTML = _savedBanner.html;
      } else {
        _switchBanner.style.display = 'none';
      }
    }

    // 立即查 session 文件的 isRunning 设置初始按钮状态，同时查进程真实状态
    fetch(`/agent/status?sessionId=${encodeURIComponent(cfg.id)}`)
      .then(r => r.json())
      .then(d => {
        if (!activePyAgentSession || activePyAgentSession.id !== cfg.id) return;
        if (d.isRunning !== pyagentRunning) setPyAgentRunning(!!d.isRunning);
      }).catch(() => {});
    fetch(`/pyagent/status?sessionId=${encodeURIComponent(cfg.id)}`)
      .then(r => r.json())
      .then(pd => {
        const el = document.getElementById('pyagentProcStatus');
        if (!el) return;
        if (pd.status === 'running') { el.textContent = '进程: 运行中'; el.style.color = 'var(--success, #4caf50)'; }
        else { el.textContent = '进程: 空闲'; el.style.color = 'var(--text-muted)'; }
      }).catch(() => {
        const el = document.getElementById('pyagentProcStatus');
        if (el) { el.textContent = '进程: 服务离线'; el.style.color = 'var(--text-muted)'; }
      });

    // 500ms tick：读 session 文件 isRunning，保持按钮与 session 状态一致；同时查进程真实状态
    if (_pyTickInterval) clearInterval(_pyTickInterval);
    const _tickSessionId = cfg.id;
    _pyTickInterval = setInterval(async () => {
      if (!activePyAgentSession || activePyAgentSession.id !== _tickSessionId) {
        clearInterval(_pyTickInterval); _pyTickInterval = null; return;
      }
      try {
        // 1. 按钮状态：读 session 文件的 isRunning
        const r = await fetch(`/agent/status?sessionId=${encodeURIComponent(_tickSessionId)}`);
        const d = await r.json();
        const running = !!d.isRunning;
        if (running !== pyagentRunning) setPyAgentRunning(running);
      } catch (_) {}
      // 2. 进程真实状态：查 pyagent_server
      try {
        const pr = await fetch(`/pyagent/status?sessionId=${encodeURIComponent(_tickSessionId)}`);
        const pd = await pr.json();
        const el = document.getElementById('pyagentProcStatus');
        if (el) {
          if (pd.status === 'running') {
            el.textContent = '进程: 运行中';
            el.style.color = 'var(--success, #4caf50)';
          } else if (pd.type === 'error' || !pr.ok) {
            el.textContent = '进程: 服务离线';
            el.style.color = 'var(--text-muted)';
          } else {
            el.textContent = '进程: 空闲';
            el.style.color = 'var(--text-muted)';
          }
        }
      } catch (_) {
        const el = document.getElementById('pyagentProcStatus');
        if (el) { el.textContent = '进程: 服务离线'; el.style.color = 'var(--text-muted)'; }
      }
    }, 500);

    // Reconnect SSE stream for this session
    connectPyAgentStream(cfg.id);

    // 加载 agent/chat 聊天记录到 pyagentOutput（优先），回退到历史文档
    const _myGen = _pyDisplayGen; // 快照当前 generation；startPyAgent 会递增使此 IIFE 失效
    (async () => {
      const output = document.getElementById('pyagentOutput');
      if (!output) return;
      const sessionId = cfg.id || '';
      const historyDoc = cfg.historyDoc || '';

      // 尝试从 agent/chat/{sessionId} 加载聊天记录
      let chatLoaded = false;
      if (sessionId) {
        try {
          const chatPath = 'agent/chat/' + sessionId;
          const res = await fetch(`/api/file?path=${encodeURIComponent(chatPath)}`);
          const data = await res.json();
          // 检查 generation：若 startPyAgent 已运行则放弃（避免覆盖新内容）
          if (_myGen !== _pyDisplayGen) return;
          if (data.success && data.content && data.content.trim()) {
            const block = document.createElement('div');
            block.className = 'agent-md-block agent-history-block';
            block.innerHTML = marked.parse(data.content);
            block.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
            output.insertBefore(block, output.firstChild);
            output.scrollTop = output.scrollHeight;
            chatLoaded = true;
          }
        } catch (_) {}
      }

      // 若无聊天记录，回退到历史文档
      if (!chatLoaded) {
        if (historyDoc) {
          try {
            const res = await fetch(`/api/file?path=${encodeURIComponent('history/' + historyDoc)}`);
            const data = await res.json();
            if (data.success && data.content) {
              const block = document.createElement('div');
              block.className = 'agent-md-block agent-history-block';
              block.innerHTML = marked.parse(data.content);
              block.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
              const divider = document.createElement('div');
              divider.className = 'agent-history-divider';
              divider.textContent = '── 以上为历史记录 ──';
              output.insertBefore(divider, output.firstChild);
              output.insertBefore(block, divider);
              output.scrollTop = output.scrollHeight;
            } else {
              const p = document.createElement('div');
              p.className = 'agent-line system';
              p.textContent = '（暂无历史记录）';
              output.insertBefore(p, output.firstChild);
            }
          } catch (_) {}
        } else {
          const p = document.createElement('div');
          p.className = 'agent-line system';
          p.textContent = '（此会话暂无聊天记录）';
          output.insertBefore(p, output.firstChild);
        }
      }
    })();

    showToast(`已切换: ${cfg.name}`, 'success');
  };

  // ── Connect SSE stream from PyAgent ──────────────────────────
  function connectPyAgentStream(sessionId) {
    if (pyagentEventSource) {
      pyagentEventSource.close();
      pyagentEventSource = null;
    }
    const url = '/pyagent/stream?sessionId=' + encodeURIComponent(sessionId);
    const es = new EventSource(url);
    pyagentEventSource = es;

    es.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      // Filter by sessionId if present in message
      if (msg.sessionId && msg.sessionId !== sessionId) return;

      const output = document.getElementById('pyagentOutput');
      if (!output) return;

      if (msg.type === 'connected') return;

      if (msg.type === 'agent_output') {
        const text = msg.text || msg.content || msg.data || '';
        if (!text) return;
        if (msg.stream === 'done') {
          flushPyOutput(output);
        } else if (msg.stream === 'system-ack') {
          // 系统 ACK：直接渲染为独立块，不混入流式 Markdown buffer
          const ackDiv = document.createElement('div');
          ackDiv.className = 'agent-md-block system-ack-block';
          ackDiv.textContent = text;
          output.appendChild(ackDiv);
          output.scrollTop = output.scrollHeight;
        } else {
          appendPyOutput(text, output);
        }
      } else if (msg.type === 'status') {
        const statusText = document.getElementById('pyagentStatusText');
        const statusDot  = document.getElementById('pyagentStatusDot');
        const info       = document.getElementById('pyagentStatusInfo');
        const s = msg.status || msg.state || '';
        if (statusText) statusText.textContent = s === 'running' ? '运行中' : s === 'done' ? '已完成' : s === 'error' ? '出错' : '空闲';
        if (statusDot) {
          statusDot.className = 'agent-status-dot' +
            (s === 'running' ? ' running' : s === 'error' ? ' error' : s === 'done' ? ' done' : '');
        }
        if (info) info.textContent = msg.message || '';
        // 按钮状态由 500ms tick 负责，SSE 只更新 action bar + session 文件
        if (s === 'done' || s === 'idle' || s === 'error') {
          updatePyActionBar('', '');
          if (s === 'done') showPyConfirmBar();
          // 任务结束：隐藏当前任务横幅
          const _b = document.getElementById('py-current-task-banner');
          if (_b) _b.style.display = 'none';
          if (activePyAgentSession) _pySessionBanners.set(activePyAgentSession.id, { visible: false, html: '' });
          // idle/done：保持气泡可见，切换为"等待中"状态（pyagent 会自动重启等待下一任务）
          // error：真正出错，隐藏气泡并解锁按钮
          if (activePyAgentSession) {
            const _isError = s === 'error';
            const _updateFields = _isError
              ? { isRunning: false, isLaunched: false, agentStatus: 'idle', agentTask: '' }
              : { agentStatus: 'waiting', agentTask: '等待下一任务…' };
            fetch(`/api/dialogue/${encodeURIComponent(activePyAgentSession.id)}`, {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(_updateFields),
            }).then(() => {
              if (typeof window.refreshSessionBubbles === 'function') window.refreshSessionBubbles();
            }).catch(() => {});
          }
        } else if (s === 'running') {
          updatePyActionBar('🐍', msg.message || '执行中…');
        }
      } else if (msg.type === 'process_launched') {
        showToast('⚡ 进程已拉起，等待 CopilotCli 初始化…', 'info');
        updatePyActionBar('⚡', '进程已拉起…');
      } else if (msg.type === 'agent_launched') {
        showToast('✅ CopilotCli 启动成功', 'success');
        updatePyActionBar('🐍', '启动成功，执行中…');
      } else if (msg.type === 'action') {
        updatePyActionBar(msg.icon || '⚙️', msg.label || msg.message || '');
      }
    };

    es.onerror = () => {
      // SSE 断线后会自动重试；重连后从 agent/chat 文件补全遗漏的输出
      setTimeout(() => {
        if (!activePyAgentSession || activePyAgentSession.id !== sessionId) return;
        fetch(`/api/file?path=${encodeURIComponent('agent/chat/' + sessionId)}`)
          .then(r => r.json())
          .then(data => {
            if (!data.success || !data.content || !data.content.trim()) return;
            const output = document.getElementById('pyagentOutput');
            if (!output) return;
            let histBlock = output.querySelector('.agent-history-block');
            if (!histBlock) {
              histBlock = document.createElement('div');
              histBlock.className = 'agent-md-block agent-history-block';
              output.insertBefore(histBlock, output.firstChild);
            }
            histBlock.innerHTML = marked.parse(data.content);
            histBlock.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
            output.scrollTop = output.scrollHeight;
          }).catch(() => {});
      }, 3000);
    };
  }

  function setPyAgentRunning(running) {
    pyagentRunning = running;
    const startBtn  = document.getElementById('pyagentStartBtn');
    const stopBtn   = document.getElementById('pyagentStopBtn');
    const dot       = document.getElementById('pyagentStatusDot');
    const statusTxt = document.getElementById('pyagentStatusText');
    if (startBtn)  startBtn.disabled  = running;
    if (stopBtn)   stopBtn.disabled   = !running;
    // 运行时切换为输入模式，停止时恢复任务模式
    if (running) {
      openPyAgentInputBar();
      startPyElapsedTimer();
    } else {
      closePyAgentInputBar();
      stopPyElapsedTimer();
      if (dot && statusTxt && dot.classList.contains('running')) {
        dot.className = 'agent-status-dot done';
        statusTxt.textContent = '已完成';
      }
    }
  }

  // ── Start a PyAgent task ──────────────────────────────────────
  window.startPyAgent = async function () {
    const task = (document.getElementById('pyagentTask').value || '').trim();
    if (!task) { showToast('请输入任务描述', 'error'); return; }
    if (!activePyAgentSession) { showToast('请先选择一个 PyAgent 会话', 'error'); return; }

    hidePyConfirmBar();
    const output = document.getElementById('pyagentOutput');
    // 递增 display generation，使 applyPyAgentDialogue 的任何未完成 IIFE 失效
    _pyDisplayGen++;
    // 清空实时 md 缓冲区，准备接收新任务输出
    _pyLiveMdBuf = '';
    if (_pyMdRenderTimer) { clearTimeout(_pyMdRenderTimer); _pyMdRenderTimer = null; }
    const live = output.querySelector('.py-live-md');
    if (live) live.remove();
    // 分隔线
    const divider = document.createElement('div');
    divider.className = 'agent-output-line';
    divider.style.cssText = 'opacity:0.4;border-top:1px solid var(--border);margin:6px 0;font-size:11px;color:var(--text-muted)';
    divider.textContent = `▶ 启动 [${new Date().toLocaleTimeString('zh-CN')}]`;
    output.appendChild(divider);
    // 以 markdown 引用块实时展示用户任务输入
    const userMsgDiv = document.createElement('div');
    userMsgDiv.className = 'agent-md-block user-msg-block';
    try {
      userMsgDiv.innerHTML = marked.parse(`> 💬 **[用户输入]**\n>\n> ${task.replace(/\n/g, '\n> ')}\n`);
    } catch (_e) {
      userMsgDiv.textContent = `💬 ${task}`;
    }
    output.appendChild(userMsgDiv);
    // scrollIntoView is more reliable than scrollTop=scrollHeight for large DOM
    userMsgDiv.scrollIntoView({ block: 'end' });
    setTimeout(() => { userMsgDiv.scrollIntoView({ block: 'end' }); }, 150);
    // Also show in a sticky banner OUTSIDE pyagentOutput (survives innerHTML clears)
    const _banner = document.getElementById('py-current-task-banner');
    if (_banner) {
      _banner.style.display = 'block';
      _banner.innerHTML = `💬 <strong>当前任务：</strong>${task.replace(/&/g,'&amp;').replace(/</g,'&lt;')}`;
    }
    if (activePyAgentSession) _pySessionBanners.set(activePyAgentSession.id, { visible: true, html: _banner ? _banner.innerHTML : '' });
    // DEBUG: detect if userMsgDiv gets removed after 1s
    const _dbgDiv = userMsgDiv;
    const _dbgGen = _pyDisplayGen;
    setTimeout(() => {
      if (!document.body.contains(_dbgDiv)) {
        showToast('⚠️ 输入块被移除了（请截图反馈）', 'error');
        console.error('[startPyAgent] userMsgDiv was removed from DOM after 1s! gen=', _dbgGen);
      }
    }, 1000);

    const statusText = document.getElementById('pyagentStatusText');
    const statusDot  = document.getElementById('pyagentStatusDot');
    if (statusText) statusText.textContent = '启动中…';
    if (statusDot)  statusDot.className = 'agent-status-dot running';
    if (_statusFetchAbortCtrl) { _statusFetchAbortCtrl.abort(); _statusFetchAbortCtrl = null; }

    // 立即写 isRunning:true 到 session 文件，tick 读到后保持按钮禁用
    const _startSid = activePyAgentSession.id;
    setPyAgentRunning(true);
    fetch(`/api/dialogue/${encodeURIComponent(_startSid)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isRunning: true, isLaunched: true, agentStatus: 'running', agentTask: task.slice(0, 80) }),
    }).then(() => {
      // 立即刷新气泡，让 PyAgent 会话出现在状态气泡中
      if (typeof window.refreshSessionBubbles === 'function') window.refreshSessionBubbles();
    }).catch(() => {});
    updatePyActionBar('🐍', '启动中…');

    try {
      // 如果进程仍在跑（即使 isRunning=false），先杀掉再重启
      try {
        const statusResp = await fetch('/pyagent/status');
        const statusData = await statusResp.json();
        if (statusData && statusData.status === 'running') {
          if (statusText) statusText.textContent = '正在终止旧进程…';
          await fetch('/pyagent/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: activePyAgentSession.id }) });
          await new Promise(r => setTimeout(r, 800));
        }
      } catch (_) { /* pyagent 服务未运行，忽略 */ }

      if (statusText) statusText.textContent = '正在连接…';

      const remoteIp = activePyAgentSession.ip; // e.g. "localhost:9002"

    const startParams = JSON.stringify({
        task,
        sessionId: activePyAgentSession.id,
        model: (document.getElementById('pyagentModel') || {}).value || '',
        historyDoc: (document.getElementById('pyagentHistoryDoc') || {}).value || '',
        taskPrefixDoc: (document.getElementById('pyagentTaskPrefix') || {}).value || '',
        systemDocs: selectedPySystemDocs.slice(),
        ...(remoteIp ? { ip: remoteIp } : {}),
      });

      // 始终走本地服务端代理（服务端会根据 ip 字段决定是否转发到远程）
      let res = await fetch('/pyagent/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: startParams,
      });
      let data = await res.json();

      // 若 PyAgent 服务未运行（ECONNREFUSED），自动拉起后重试（仅限本地）
      if (!remoteIp && !res.ok && data.error && (data.error.includes('ECONNREFUSED') || data.error.includes('无法连接') || data.error.includes('启动失败'))) {
        if (statusText) statusText.textContent = '正在拉起 PyAgent 服务…';
        const launchRes = await fetch('/agent/launch-pyagent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const launchData = await launchRes.json();
        if (!launchData.success) throw new Error('PyAgent 服务启动失败: ' + (launchData.message || launchData.error || '未知错误'));
        if (statusText) statusText.textContent = '服务已就绪，正在启动任务…';
        // 重试启动
        res  = await fetch('/pyagent/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: startParams });
        data = await res.json();
      }

      if (!res.ok || data.error) {
        throw new Error(data.error || '启动失败');
      }
      const idx = dialogueSessions.findIndex(s => s.id === _startSid);
      if (idx >= 0) { dialogueSessions[idx].isRunning = true; dialogueSessions[idx].isLaunched = true; }
      // 确保 SSE 已连接，实时接收新任务输出
      connectPyAgentStream(_startSid);
      showToast('🚀 任务已发送，进程启动中…', 'info');
    } catch (e) {
      // 启动失败：回写 isRunning:false 到 session 文件
      fetch(`/api/dialogue/${encodeURIComponent(_startSid)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRunning: false, isLaunched: false }),
      }).catch(() => {});
      const errLine = document.createElement('div');
      errLine.className = 'agent-output-line';
      errLine.style.color = 'var(--danger)';
      errLine.textContent = '❌ ' + e.message;
      output.appendChild(errLine);
      setPyAgentRunning(false);
      updatePyActionBar('', '');
      if (statusText) statusText.textContent = '出错';
      if (statusDot)  statusDot.className = 'agent-status-dot error';
      showToast('启动失败: ' + e.message, 'error');
    }
  };

  // ── Stop PyAgent ──────────────────────────────────────────────
  window.stopPyAgent = async function () {
    if (!activePyAgentSession) return;
    const sid = activePyAgentSession.id;
    const remoteIp = activePyAgentSession.ip; // e.g. "localhost:9002"
    // 向本地服务端发停止请求（body 携带 ip，服务端负责转发到远程）
    // 进程不存在时服务端也返回 success，无需担心 failed to fetch
    try {
      await fetch('/pyagent/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sid, ...(remoteIp ? { ip: remoteIp } : {}) }),
      });
    } catch (_) { /* 忽略网络错误 */ }
    // 无论停止请求是否成功，都写 isRunning: false（唯一状态源）
    try {
      await fetch(`/api/dialogue/${encodeURIComponent(sid)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRunning: false, isLaunched: false }),
      });
    } catch (_) { /* 忽略 */ }
    const idx = dialogueSessions.findIndex(s => s.id === sid);
    if (idx >= 0) { dialogueSessions[idx].isRunning = false; dialogueSessions[idx].isLaunched = false; }
    setPyAgentRunning(false);
    updatePyActionBar('', '');
    hidePyConfirmBar();
    showToast('PyAgent 已停止', 'success');
  };

  // ── Send input to waiting PyAgent ────────────────────────────
  window.sendPyAgentInput = async function () {
    const textarea = document.getElementById('pyagentTask');
    const text = (textarea?.value || '').trim();
    if (!text) { showToast('请输入内容', 'error'); return; }
    if (!activePyAgentSession) { showToast('请先选择会话', 'error'); return; }

    // 立即在输出区显示用户输入（不等 fetch 完成）
    const output = document.getElementById('pyagentOutput');
    if (output) {
      const userMsgDiv = document.createElement('div');
      userMsgDiv.className = 'agent-md-block user-msg-block';
      try {
        userMsgDiv.innerHTML = marked.parse(`> 💬 **[用户输入]**\n>\n> ${text.replace(/\n/g, '\n> ')}\n`);
      } catch (_e) {
        userMsgDiv.textContent = `💬 ${text}`;
      }
      output.appendChild(userMsgDiv);
      userMsgDiv.scrollIntoView({ block: 'end' });
    }
    // 横幅也更新
    const _banner = document.getElementById('py-current-task-banner');
    if (_banner) {
      _banner.style.display = 'block';
      _banner.innerHTML = `💬 <strong>输入已发送：</strong>${text.replace(/&/g,'&amp;').replace(/</g,'&lt;')}`;
    }
    if (activePyAgentSession) _pySessionBanners.set(activePyAgentSession.id, { visible: true, html: _banner ? _banner.innerHTML : '' });

    try {
      const res = await fetch('/pyagent/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activePyAgentSession.id, input: text }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '发送失败');
      textarea.value = '';
      closePyAgentInputBar();
      updatePyActionBar('🐍', '等待响应…');
      showToast('输入已发送', 'success');
    } catch (e) {
      showToast('发送失败: ' + e.message, 'error');
    }
  };

  // Ctrl+Enter 统一处理：运行中发送输入，否则启动
  window.pyagentUnifiedSend = function () {
    if (_pyagentInputMode === 'input') {
      sendPyAgentInput();
    } else {
      startPyAgent();
    }
  };

  // ── Input bar helpers ─────────────────────────────────────────
  let _pyagentInputMode = 'task'; // 'task' | 'input'

  window.openPyAgentInputBar = function (prompt = '') {
    const textarea = document.getElementById('pyagentTask');
    const promptBar = document.getElementById('pyagentUnifiedPrompt');
    const promptText = document.getElementById('pyagentUnifiedPromptText');
    const sendBtn = document.getElementById('pyagentSendInputBtn');
    const startBtn = document.getElementById('pyagentStartBtn');
    _pyagentInputMode = 'input';
    if (promptBar) {
      promptText.textContent = prompt || '向 PyAgent 发送输入：';
      promptBar.style.display = 'flex';
    }
    if (textarea) textarea.placeholder = '向 PyAgent 发送输入（多行，Ctrl+Enter 发送）…';
    if (sendBtn) sendBtn.style.display = '';
    if (startBtn) startBtn.style.display = 'none';
    if (textarea) textarea.focus();
  };
  window.closePyAgentInputBar = function () {
    const textarea = document.getElementById('pyagentTask');
    const promptBar = document.getElementById('pyagentUnifiedPrompt');
    const sendBtn = document.getElementById('pyagentSendInputBtn');
    const startBtn = document.getElementById('pyagentStartBtn');
    _pyagentInputMode = 'task';
    if (promptBar) promptBar.style.display = 'none';
    if (textarea) textarea.placeholder = '输入任务描述...\n（Ctrl+Enter 启动）';
    if (sendBtn) sendBtn.style.display = 'none';
    if (startBtn) startBtn.style.display = '';
  };

  // ── Clear output ──────────────────────────────────────────────
  window.clearPyAgentOutput = function () {
    _pyOutputBuf = '';
    _pyLiveMdBuf = '';
    if (_pyMdRenderTimer) { clearTimeout(_pyMdRenderTimer); _pyMdRenderTimer = null; }
    const el = document.getElementById('pyagentOutput');
    if (el) el.innerHTML = '';
    const elapsed = document.getElementById('pyagentElapsed');
    if (elapsed) elapsed.textContent = '';
    hidePyConfirmBar();
    updatePyActionBar('', '');
  };
})();