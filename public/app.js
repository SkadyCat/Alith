/* ============================================
   DocSpace - Application Logic
   ============================================ */

// ===== STATE =====
const state = {
  currentFile: null,
  isDirty: false,
  sidebarCollapsed: false,
  allFiles: [],           // for search
};

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  loadFileTree();
  initDragDrop();
  initDocDragTargets();
  setupKeyboardShortcuts();
  setupResizeHandle();
  setupContextMenu();

  // Auto-save dialogue when historyDoc changes
  document.getElementById('agentHistoryDoc').addEventListener('change', () => {
    if (activeDialogueId) saveCurrentDialogue(activeDialogueId);
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
});

// ===== FILE TREE =====
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
      el.className = 'tree-file';
      el.style.animationDelay = `${idx * 0.03}s`;
      el.dataset.path = item.path;
      el.draggable = true;
      
      const nameWithoutExt = item.name.replace(/\.md$/, '');
      state.allFiles.push({ name: item.name, path: item.path, el });
      
      el.innerHTML = `
        <span class="tree-file-icon">📄</span>
        <span class="tree-name">${nameWithoutExt}</span>
        <span class="tree-file-ext">.md</span>`;
      
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
  const q = query.toLowerCase().trim();
  if (!q) {
    loadFileTree();
    return;
  }
  
  const container = document.getElementById('fileTree');
  const matched = state.allFiles.filter(f => 
    f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
  );
  
  container.innerHTML = '';
  if (matched.length === 0) {
    container.innerHTML = `<div class="empty-tree">未找到匹配的文档</div>`;
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
}

// ===== OPEN FILE =====
async function openFile(filePath) {
  try {
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
}

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
    if (e.key === 'Escape') {
      closeModal();
      hideContextMenu();
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

// 加载模型列表
async function loadHistoryDocs() {
  try {
    const res = await fetch('/agent/history-docs');
    const data = await res.json();
    const sel = document.getElementById('agentHistoryDoc');
    // Prefer the active session's historyDoc, then whatever was selected
    const activeSession = activeDialogueId ? dialogueSessions.find(s => s.id === activeDialogueId) : null;
    const current = (activeSession && activeSession.historyDoc) || sel.value;
    sel.innerHTML = '<option value="">— 不记录历史 —</option>';
    (data.docs || []).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p.replace(/\.md$/, '');
      if (p === current) opt.selected = true;
      sel.appendChild(opt);
    });
    // If current value not in list, add it dynamically
    if (current && !sel.querySelector(`option[value="${current}"]`)) {
      const opt = document.createElement('option');
      opt.value = current;
      opt.textContent = current.replace(/\.md$/, '');
      opt.selected = true;
      sel.appendChild(opt);
    }
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

async function loadAgentModels() {
  try {
    const res = await fetch('/agent/models');
    const data = await res.json();
    const sel = document.getElementById('agentModel');
    sel.innerHTML = '';
    (data.models || []).forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label + (m.maxTokens >= 1000000 ? ' ★' : '');
      opt.dataset.maxTokens = m.maxTokens;
      sel.appendChild(opt);
    });
    // 默认选 claude-sonnet-4.6（直接更新 maxTokens，不触发自动保存）
    const current = sel.value;
    const restored = current && sel.querySelector(`[value="${CSS.escape(current)}"]`);
    const pref = restored || sel.querySelector('[value="claude-sonnet-4.6"]');
    if (pref) {
      pref.selected = true;
      agentMaxTokens = parseInt(pref.dataset.maxTokens) || 64000;
      updateTokenCounter(0);
    }
  } catch (e) {}
}

function onModelChange() {
  const sel = document.getElementById('agentModel');
  const opt = sel.options[sel.selectedIndex];
  agentMaxTokens = parseInt(opt.dataset.maxTokens) || 64000;
  updateTokenCounter(0);
  if (activeDialogueId) saveCurrentDialogue(activeDialogueId);
}

function toggleAgentPanel() {
  const panel = document.getElementById('agentPanel');
  const sessionPanel = document.getElementById('sessionPanel');
  const btn = document.getElementById('agentToggleBtn');
  const isOpen = panel.classList.toggle('open');
  btn.classList.toggle('active', isOpen);
  sessionPanel.classList.toggle('open', isOpen);
  if (isOpen) {
    populateAgentDocSelector();
    loadAgentModels();
    loadHistoryDocs();
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
  // 关闭所有现有连接（切换会话时只保留当前会话的流）
  sessionSources.forEach(es => es.close());
  sessionSources.clear();
  agentEventSource = null;

  const url = '/agent/stream?sessionId=' + encodeURIComponent(sid) + (noReplay ? '&noReplay=1' : '');
  const es = new EventSource(url);
  sessionSources.set(sid, es);
  agentEventSource = es; // 居用全局引用，供其它需要的地方

  agentEventSource.addEventListener('start', (e) => {
    const { task, tokenEst, maxTokens } = JSON.parse(e.data);
    agentRunning = true;
    agentStartTime = Date.now();
    agentMdBuffer = '';
    agentMdBlock = null;
    _contextPressure = false;   // 每次任务重置压力标志（压缩任务期间保持 _contextCompressing）
    setAgentStatus('running', `运行中`);
    updateAgentActionBar('idle', '');  // 清空上次状态
    appendAgentLine(`▶ 任务已启动: ${task}`, 'system');
    startElapsedTimer();
    document.getElementById('agentStartBtn').disabled = true;
    document.getElementById('agentStopBtn').disabled = false;
    if (maxTokens) agentMaxTokens = maxTokens;
    updateTokenCounter(tokenEst || 0);
  });

  agentEventSource.addEventListener('output', (e) => {
    const { text, stream, tokenEst, maxTokens } = JSON.parse(e.data);
    if (maxTokens) agentMaxTokens = maxTokens;
    if (tokenEst !== undefined) updateTokenCounter(tokenEst);
    if (stream === 'stderr') {
      if (text) appendAgentLine(text, 'stderr');
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

  agentEventSource.addEventListener('heartbeat', (e) => {
    const { elapsedSec, tokenEst, maxTokens } = JSON.parse(e.data);
    document.getElementById('agentElapsed').textContent = `已运行 ${elapsedSec}s`;
    if (maxTokens) agentMaxTokens = maxTokens;
    if (tokenEst !== undefined) updateTokenCounter(tokenEst);
  });

  agentEventSource.addEventListener('token-update', (e) => {
    const { tokenEst, maxTokens } = JSON.parse(e.data);
    if (maxTokens) agentMaxTokens = maxTokens;
    if (tokenEst !== undefined) updateTokenCounter(tokenEst);
  });

  agentEventSource.addEventListener('waiting-confirm', (e) => {
    const { code, elapsed } = JSON.parse(e.data);
    const ok = code === 0;
    setAgentStatus(ok ? 'done' : 'error', ok ? `完成 (${elapsed}s)，等待确认` : `错误 (code ${code})`);
    updateAgentActionBar('idle', '');
    if (ok && _contextPressure && !_contextCompressing) {
      triggerContextCompression();
    } else {
      showAgentConfirmBar();
    }
  });

  agentEventSource.addEventListener('continue-queued', (e) => {
    const { task } = JSON.parse(e.data);
    document.getElementById('agentTask').value = task;
    startAgent();
  });

  agentEventSource.addEventListener('done', (e) => {
    const { code, elapsed, task } = JSON.parse(e.data);
    agentRunning = false;
    _permLocked = false;   // ensure perm bar is not stuck after task ends
    clearInterval(agentElapsedTimer);
    const ok = code === 0;
    setAgentStatus(ok ? 'done' : 'error', ok ? `完成 (${elapsed}s)` : `错误 (code ${code})`);
    updateAgentActionBar('idle', '');  // 清空状态栏
    appendAgentLine(`${ok ? '✓' : '✗'} 任务结束，耗时 ${elapsed}s，退出码 ${code}`, ok ? 'success' : 'error');
    hideAgentConfirmBar();
    document.getElementById('agentStartBtn').disabled = false;
    document.getElementById('agentStopBtn').disabled = true;
    if (pendingContinueTask) {
      const followUp = pendingContinueTask;
      pendingContinueTask = null;
      document.getElementById('agentTask').value = followUp;
      setTimeout(() => startAgent(), 200);
    } else if (_contextCompressing) {
      // 压缩任务已结束 → 重置上下文并载入新记忆
      finishContextCompression();
    }
  });

  agentEventSource.addEventListener('stopped', () => {
    agentRunning = false;
    _permLocked = false;   // ensure perm bar is not stuck
    _contextPressure = false;
    _contextCompressing = false;
    clearInterval(agentElapsedTimer);
    setAgentStatus('idle', '已停止');
    updateAgentActionBar('idle', '');  // 清空状态栏
    hideAgentConfirmBar();
    appendAgentLine('■ Agent 已手动停止', 'system');
    document.getElementById('agentStartBtn').disabled = false;
    document.getElementById('agentStopBtn').disabled = true;
  });

  agentEventSource.addEventListener('agent-action', (e) => {
    const { type, label } = JSON.parse(e.data);
    updateAgentActionBar(type, label);
  });

  agentEventSource.addEventListener('history-saved', (e) => {
    const { path: p } = JSON.parse(e.data);
    appendAgentLine(`📜 已记录到历史文档: ${p}`, 'system');
    loadFileTree();
  });

  agentEventSource.addEventListener('saved', (e) => {
    const { path } = JSON.parse(e.data);
    appendAgentLine(`💾 已保存为文档: ${path}`, 'system');
    loadFileTree(); // 刷新文件树
  });

  agentEventSource.addEventListener('error', (e) => {
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

  // ── GitHub 认证事件 ────────────────────────────────────
  agentEventSource.addEventListener('auth-start', () => {
    document.getElementById('agentOutput').innerHTML = '';
    agentMdBuffer = ''; agentMdBlock = null;
    appendAgentLine('🔐 GitHub 认证流程已启动...', 'system');
    appendAgentLine('请点击下方链接，在浏览器中完成 GitHub 授权', 'system');
    document.getElementById('agentAuthBtn').disabled = true;
    document.getElementById('agentAuthCancelBtn').disabled = false;
  });

  agentEventSource.addEventListener('auth-output', (e) => {
    const { text, stream } = JSON.parse(e.data);
    appendAgentLineHTML(text, stream === 'stderr' ? 'stderr' : '');
  });

  agentEventSource.addEventListener('auth-done', (e) => {
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

  agentEventSource.addEventListener('auth-error', (e) => {
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
    const del = document.createElement('button');
    del.className = 'sysdoc-tag-del';
    del.textContent = '×';
    del.title = '移除';
    del.onclick = () => removeSysdocTag(p);
    tag.appendChild(label);
    tag.appendChild(del);
    wrap.appendChild(tag);
  });
}

function removeSysdocTag(p) {
  selectedSystemDocs = selectedSystemDocs.filter(x => x !== p);
  renderSysdocTags();
  if (activeDialogueId) saveCurrentDialogue(activeDialogueId);
}

async function openSystemDocModal() {
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
  // 首次渲染用 selectedSystemDocs，后续保留弹窗内勾选状态
  const checked = pending.size ? pending : new Set(selectedSystemDocs);
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
  selectedSystemDocs = checked;
  renderSysdocTags();
  closeSystemDocModal();
  if (activeDialogueId) saveCurrentDialogue(activeDialogueId);
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
  const systemDocs = selectedSystemDocs.slice();
  const model = document.getElementById('agentModel').value || undefined;
  const historyDoc = document.getElementById('agentHistoryDoc').value || undefined;

  document.getElementById('agentOutput').innerHTML = '';
  document.getElementById('agentElapsed').textContent = '';
  agentMdBuffer = ''; agentMdBlock = null;
  updateTokenCounter(0);

  if (systemDocs.length) appendAgentLine(`📄 系统设定: ${systemDocs.join(', ')}`, 'system');
  if (historyDoc) appendAgentLine(`📜 历史文档: history/${historyDoc}（读取上下文，会话结束后追加）`, 'system');

  try {
    const res = await fetch('/agent/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, maxContinues, saveAs: saveAs || undefined, useHistory, systemDocs: systemDocs.length ? systemDocs : undefined, model, historyDoc, sessionId: getActiveSessionId() }),
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

async function loadDialogues() {
  try {
    // Try dedicated API first (available after server restart)
    const res = await fetch('/api/dialogue');
    if (res.ok) {
      const data = await res.json();
      dialogueSessions = data.sessions || [];
      renderSessionList();
      return;
    }
  } catch (e) {}
  // Fallback: use file tree API
  try {
    const treeRes = await fetch('/api/tree');
    const treeData = await treeRes.json();
    const dialogueFolder = (treeData.tree || []).find(item => item.type === 'folder' && item.name === 'dialogue');
    const files = dialogueFolder ? (dialogueFolder.children || []).filter(f => f.type === 'file') : [];
    dialogueSessions = await Promise.all(files.map(async f => {
      try {
        const fr = await fetch(`/api/file?path=${encodeURIComponent(f.path)}`);
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
    const item = document.createElement('div');
    item.className = 'session-item' + (s.id === activeDialogueId ? ' active' : '');
    item.dataset.id = s.id;

    const btn = document.createElement('button');
    btn.className = 'session-item-btn';
    btn.title = s.name;
    btn.innerHTML = `<span class="session-item-name">${escHtml(s.name)}</span>
      <span class="session-item-meta">${escHtml(s.historyDoc ? s.historyDoc.replace(/^history\//, '') : (s.model || ''))}</span>`;
    btn.onclick = () => applyDialogue(s);

    const del = document.createElement('button');
    del.className = 'session-del-btn';
    del.title = '删除会话';
    del.textContent = '×';
    del.onclick = (e) => { e.stopPropagation(); deleteDialogue(s.id); };

    item.appendChild(btn);
    item.appendChild(del);
    list.appendChild(item);
  });
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function applyDialogue(cfg) {
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

  // 重置 UI
  agentMdBuffer = ''; agentMdBlock = null;
  agentRunning = false; _permLocked = false;
  pendingContinueTask = null;
  clearInterval(agentElapsedTimer);
  document.getElementById('agentElapsed').textContent = '';
  updateTokenCounter(0);
  updateAgentActionBar('idle', '');
  hideAgentConfirmBar();
  document.getElementById('agentStartBtn').disabled = false;
  document.getElementById('agentStopBtn').disabled = true;

  // 从 historyDoc 文件载入历史，然后接上 SSE 实时流
  loadSessionHistoryDoc(cfg.historyDoc, cfg.id);

  showToast(`已切换: ${cfg.name}`, 'success');
}

// 从 historyDoc 文件读取历史内容渲染到输出区，然后连接 SSE
async function loadSessionHistoryDoc(historyDoc, sessionId) {
  const output = document.getElementById('agentOutput');
  output.innerHTML = '';

  if (historyDoc) {
    try {
      const filePath = 'history/' + historyDoc;
      const res = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
      const data = await res.json();
      if (data.success && data.content) {
        // 渲染 markdown 历史内容
        const block = document.createElement('div');
        block.className = 'agent-md-block agent-history-block';
        block.innerHTML = marked.parse(data.content);
        block.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
        output.appendChild(block);
        // 添加分隔线，表示以下是新实时内容
        const divider = document.createElement('div');
        divider.className = 'agent-history-divider';
        divider.textContent = '── 以上为历史记录 ──';
        output.appendChild(divider);
        output.scrollTop = output.scrollHeight;
        setAgentStatus('idle', '空闲');
      } else {
        appendAgentLine('（暂无历史记录）', 'system');
      }
    } catch (e) {
      appendAgentLine('（历史记录加载失败）', 'system');
    }
  } else {
    appendAgentLine('（此会话未配置历史文档）', 'system');
  }

  // 连接该会话的 SSE 流（只监听实时新事件，不 replay）
  connectAgentStream(sessionId, /* noReplay= */ true);
}

async function saveCurrentDialogue(id) {
  if (!id) return;
  const model = document.getElementById('agentModel').value || '';
  const historyDoc = document.getElementById('agentHistoryDoc').value || '';
  const systemDocs = selectedSystemDocs.slice();
  const existing = dialogueSessions.find(s => s.id === id) || {};
  await fetch(`/api/dialogue/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...existing, model, historyDoc, systemDocs }),
  });
  await loadDialogues();
}

async function createDialogue() {
  const name = prompt('新建会话名称：');
  if (!name || !name.trim()) return;
  const model = document.getElementById('agentModel').value || 'claude-sonnet-4.6';
  const historyDoc = document.getElementById('agentHistoryDoc').value || '';
  const systemDocs = selectedSystemDocs.slice();
  const res = await fetch('/api/dialogue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim(), model, historyDoc, systemDocs }),
  });
  const data = await res.json();
  if (data.success) {
    activeDialogueId = data.id;
    await loadDialogues();
    showToast(`已创建: ${name.trim()}`, 'success');
  }
}

async function deleteDialogue(id) {
  const s = dialogueSessions.find(x => x.id === id);
  if (!confirm(`删除会话「${s ? s.name : id}」？`)) return;
  try {
    await fetch(`/api/dialogue/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (activeDialogueId === id) activeDialogueId = null;
    await loadDialogues();
  } catch (e) {
    showToast('删除失败', 'error');
  }
}
