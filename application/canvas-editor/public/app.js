/* ===================== Canvas Editor App ===================== */

const GRID_SIZE = 20;
const SNAP_SIZE = 10;

// Dynamic canvas size — read from actual DOM dimensions
function canvasW() { return canvasRoot.offsetWidth  || 1200; }
function canvasH() { return canvasRoot.offsetHeight || 800; }

let boxes        = [];
let selectedId   = null;
let nextId       = 1;
let mode         = 'select';   // 'select' | 'draw'
let zoom         = 1.0;
let gridVisible  = true;
let snapEnabled  = true;

let undoStack    = [];
let redoStack    = [];

/* ───── DOM Refs ───── */
const canvasRoot       = document.getElementById('canvas-root');
const canvasViewport   = document.getElementById('canvas-viewport');
const boxLayer         = document.getElementById('box-layer');
const selOverlay       = document.getElementById('selection-overlay');
const gridCanvas       = document.getElementById('grid-canvas');
const propPanel        = document.getElementById('prop-panel');
const layerList        = document.getElementById('layer-list');
const consoleOutput    = document.getElementById('console-output');

const btnSelect  = document.getElementById('btn-select');
const btnDraw    = document.getElementById('btn-draw');
const btnDelete  = document.getElementById('btn-delete');
const btnClear   = document.getElementById('btn-clear');
const btnUndo    = document.getElementById('btn-undo');
const btnRedo    = document.getElementById('btn-redo');
const btnZoomIn  = document.getElementById('btn-zoom-in');
const btnZoomOut = document.getElementById('btn-zoom-out');
const btnZoomReset = document.getElementById('btn-zoom-reset');
const zoomLabel  = document.getElementById('zoom-label');
const toggleGrid = document.getElementById('toggle-grid');
const toggleSnap = document.getElementById('toggle-snap');

/* ───── Logging ───── */
function log(msg, type = 'info') {
  const div = document.createElement('div');
  div.className = `log-${type}`;
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  div.textContent = `[${ts}] ${msg}`;
  consoleOutput.appendChild(div);
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}
document.getElementById('btn-clear-console').onclick = () => consoleOutput.innerHTML = '';

/* ───── Grid ───── */
function drawGrid() {
  // Read from viewport (the true container), not from grid-canvas itself
  const w = canvasViewport.offsetWidth  || canvasW();
  const h = canvasViewport.offsetHeight || canvasH();
  gridCanvas.width  = w;
  gridCanvas.height = h;
  const ctx = gridCanvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  if (!gridVisible) return;

  // Minor grid lines (every 20px)
  ctx.beginPath();
  ctx.strokeStyle = '#2a2a40';
  ctx.lineWidth = 1;
  for (let x = 0.5; x < w; x += GRID_SIZE) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = 0.5; y < h; y += GRID_SIZE) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();

  // Major grid lines (every 100px)
  ctx.beginPath();
  ctx.strokeStyle = '#303050';
  ctx.lineWidth = 1;
  for (let x = 0.5; x < w; x += 100) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = 0.5; y < h; y += 100) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
}

/* ───── Snap ───── */
function snap(v) {
  if (!snapEnabled) return v;
  return Math.round(v / SNAP_SIZE) * SNAP_SIZE;
}

/* ───── Undo / Redo ───── */
function saveState() {
  undoStack.push(JSON.stringify(boxes));
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(boxes));
  boxes = JSON.parse(undoStack.pop());
  selectedId = null;
  renderAll();
  log('撤销', 'dim');
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(boxes));
  boxes = JSON.parse(redoStack.pop());
  selectedId = null;
  renderAll();
  log('重做', 'dim');
}

/* ───── Box Model ───── */
function createBox(x, y, w, h, label) {
  return {
    id: nextId++,
    x: snap(x), y: snap(y),
    w: Math.max(snap(w), 20),
    h: Math.max(snap(h), 20),
    label: label || `Box${nextId - 1}`,
    borderColor: '#7c6af7',
    bgColor: 'rgba(124,106,247,0.06)',
    borderWidth: 2,
    opacity: 1.0
  };
}

/* ───── Render ───── */
function renderBox(box) {
  let el = document.getElementById(`box-${box.id}`);
  if (!el) {
    el = document.createElement('div');
    el.className = 'box-item';
    el.id = `box-${box.id}`;

    // Label
    const lbl = document.createElement('div');
    lbl.className = 'box-label';
    lbl.textContent = box.label;
    el.appendChild(lbl);

    // Resize handles (shown when selected)
    ['nw','n','ne','e','se','s','sw','w'].forEach(dir => {
      const h = document.createElement('div');
      h.className = `resize-handle ${dir}`;
      h.dataset.dir = dir;
      h.style.display = 'none';
      el.appendChild(h);
      h.addEventListener('mousedown', onResizeStart);
    });

    boxLayer.appendChild(el);
    el.addEventListener('mousedown', onBoxMouseDown);
  }

  el.style.left    = box.x + 'px';
  el.style.top     = box.y + 'px';
  el.style.width   = box.w + 'px';
  el.style.height  = box.h + 'px';
  el.style.border  = `${box.borderWidth}px solid ${box.borderColor}`;
  el.style.background = box.bgColor;
  el.style.opacity = box.opacity;
  el.querySelector('.box-label').textContent = box.label;

  const isSelected = box.id === selectedId;
  el.classList.toggle('selected', isSelected);
  el.querySelectorAll('.resize-handle').forEach(h => {
    h.style.display = isSelected ? 'block' : 'none';
  });
}

function renderAll() {
  // Remove deleted boxes from DOM
  const ids = new Set(boxes.map(b => b.id));
  boxLayer.querySelectorAll('.box-item').forEach(el => {
    if (!ids.has(+el.id.replace('box-', ''))) el.remove();
  });

  boxes.forEach(b => renderBox(b));
  renderLayers();
  renderProps();
}

function renderLayers() {
  layerList.innerHTML = '';
  [...boxes].reverse().forEach(box => {
    const li = document.createElement('li');
    li.textContent = `⬜ ${box.label}`;
    li.dataset.id = box.id;
    if (box.id === selectedId) li.classList.add('selected');
    li.addEventListener('click', () => { selectBox(box.id); renderAll(); });
    layerList.appendChild(li);
  });
}

function renderProps() {
  if (!selectedId) {
    propPanel.innerHTML = '<div class="empty-hint">未选中任何元素</div>';
    return;
  }
  const box = boxes.find(b => b.id === selectedId);
  if (!box) { propPanel.innerHTML = '<div class="empty-hint">未选中任何元素</div>'; return; }

  propPanel.innerHTML = `
    <div class="prop-section-title">位置 & 尺寸</div>
    <div class="prop-row"><label>X</label><input type="number" id="p-x" value="${box.x}" /></div>
    <div class="prop-row"><label>Y</label><input type="number" id="p-y" value="${box.y}" /></div>
    <div class="prop-row"><label>W</label><input type="number" id="p-w" value="${box.w}" /></div>
    <div class="prop-row"><label>H</label><input type="number" id="p-h" value="${box.h}" /></div>
    <div class="prop-section-title">样式</div>
    <div class="prop-row"><label>名称</label><input type="text" id="p-label" value="${box.label}" /></div>
    <div class="prop-row"><label>边框</label><input type="number" id="p-bw" value="${box.borderWidth}" min="1" max="10" /></div>
    <div class="color-row"><label>边框色</label><input type="color" id="p-bc" value="${box.borderColor}" /></div>
    <div class="color-row">
      <label>透明度</label>
      <input type="range" id="p-op" min="0.1" max="1" step="0.05" value="${box.opacity}" />
      <span id="p-op-val">${Math.round(box.opacity * 100)}%</span>
    </div>
  `;

  const bind = (id, prop, parse) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      saveState();
      box[prop] = parse ? parse(el.value) : el.value;
      if (id === 'p-op') document.getElementById('p-op-val').textContent = Math.round(box.opacity * 100) + '%';
      renderAll();
    });
  };
  bind('p-x', 'x', v => snap(+v));
  bind('p-y', 'y', v => snap(+v));
  bind('p-w', 'w', v => Math.max(snap(+v), 20));
  bind('p-h', 'h', v => Math.max(snap(+v), 20));
  bind('p-label', 'label');
  bind('p-bw', 'borderWidth', v => Math.max(+v, 1));
  bind('p-bc', 'borderColor');
  bind('p-op', 'opacity', parseFloat);
}

/* ───── Selection ───── */
function selectBox(id) {
  selectedId = id;
}

function deselectAll() {
  selectedId = null;
}

/* ───── Box: Move ───── */
let dragState = null;

function onBoxMouseDown(e) {
  if (mode !== 'select') return;
  if (e.target.classList.contains('resize-handle')) return;
  e.stopPropagation();
  e.preventDefault();

  const el = e.currentTarget;
  const id = +el.id.replace('box-', '');
  selectBox(id);
  renderAll();

  const box = boxes.find(b => b.id === id);
  const rect = canvasRoot.getBoundingClientRect();
  dragState = {
    type: 'move',
    id,
    startX: e.clientX,
    startY: e.clientY,
    origX: box.x,
    origY: box.y
  };
  saveState();
}

/* ───── Box: Resize ───── */
function onResizeStart(e) {
  if (mode !== 'select') return;
  e.stopPropagation();
  e.preventDefault();

  const dir = e.currentTarget.dataset.dir;
  const el  = e.currentTarget.closest('.box-item');
  const id  = +el.id.replace('box-', '');
  const box = boxes.find(b => b.id === id);
  saveState();

  dragState = {
    type: 'resize',
    id, dir,
    startX: e.clientX,
    startY: e.clientY,
    origX: box.x, origY: box.y,
    origW: box.w, origH: box.h
  };
}

/* ───── Draw Mode ───── */
let drawStart = null;
let drawPreview = null;

function getCanvasPos(e) {
  const rect = canvasRoot.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / zoom,
    y: (e.clientY - rect.top)  / zoom
  };
}

selOverlay.addEventListener('mousedown', (e) => {
  if (mode !== 'draw') {
    // In select mode, clicking empty canvas deselects
    if (e.target === selOverlay) { deselectAll(); renderAll(); }
    return;
  }
  e.preventDefault();
  const pos = getCanvasPos(e);
  drawStart = pos;
  drawPreview = document.createElement('div');
  drawPreview.id = 'draw-preview';
  drawPreview.style.left   = pos.x + 'px';
  drawPreview.style.top    = pos.y + 'px';
  drawPreview.style.width  = '0px';
  drawPreview.style.height = '0px';
  canvasRoot.appendChild(drawPreview);
});

/* ───── Global Mouse Handlers ───── */
document.addEventListener('mousemove', (e) => {
  if (drawStart && drawPreview) {
    const pos = getCanvasPos(e);
    const x = Math.min(pos.x, drawStart.x);
    const y = Math.min(pos.y, drawStart.y);
    const w = Math.abs(pos.x - drawStart.x);
    const h = Math.abs(pos.y - drawStart.y);
    drawPreview.style.left   = x + 'px';
    drawPreview.style.top    = y + 'px';
    drawPreview.style.width  = w + 'px';
    drawPreview.style.height = h + 'px';
  }

  if (dragState) {
    const dx = (e.clientX - dragState.startX) / zoom;
    const dy = (e.clientY - dragState.startY) / zoom;
    const box = boxes.find(b => b.id === dragState.id);
    if (!box) return;

    if (dragState.type === 'move') {
      box.x = snap(dragState.origX + dx);
      box.y = snap(dragState.origY + dy);
      box.x = Math.max(0, Math.min(box.x, canvasW() - box.w));
      box.y = Math.max(0, Math.min(box.y, canvasH() - box.h));
    } else if (dragState.type === 'resize') {
      const d = dragState.dir;
      let { origX, origY, origW, origH } = dragState;
      if (d.includes('e')) box.w = Math.max(snap(origW + dx), 20);
      if (d.includes('s')) box.h = Math.max(snap(origH + dy), 20);
      if (d.includes('w')) {
        const nw = Math.max(snap(origW - dx), 20);
        box.x = snap(origX + (origW - nw));
        box.w = nw;
      }
      if (d.includes('n')) {
        const nh = Math.max(snap(origH - dy), 20);
        box.y = snap(origY + (origH - nh));
        box.h = nh;
      }
    }
    renderAll();
  }
});

document.addEventListener('mouseup', (e) => {
  // Finish draw
  if (drawStart && drawPreview) {
    const pos = getCanvasPos(e);
    const x = Math.min(pos.x, drawStart.x);
    const y = Math.min(pos.y, drawStart.y);
    const w = Math.abs(pos.x - drawStart.x);
    const h = Math.abs(pos.y - drawStart.y);
    drawPreview.remove();
    drawPreview = null;
    drawStart = null;

    if (w > 10 && h > 10) {
      saveState();
      const box = createBox(x, y, w, h);
      boxes.push(box);
      selectBox(box.id);
      renderAll();
      log(`绘制 ${box.label}  (${Math.round(x)}, ${Math.round(y)})  ${Math.round(box.w)}×${Math.round(box.h)}`, 'ok');
      // Auto-switch to select mode so the new box can be dragged immediately
      setMode('select');
    }
  }

  if (dragState) {
    const box = boxes.find(b => b.id === dragState.id);
    if (box) {
      if (dragState.type === 'move')
        log(`移动 ${box.label} → (${box.x}, ${box.y})`, 'dim');
      else
        log(`调整 ${box.label} → ${box.w}×${box.h}`, 'dim');
    }
    dragState = null;
  }
});

/* ───── Keyboard ───── */
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;

  if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
  if (e.key === 'Escape') { deselectAll(); renderAll(); }
  if (e.key === 'v' || e.key === 'V') setMode('select');
  if (e.key === 'b' || e.key === 'B') setMode('draw');
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Z')) { e.preventDefault(); redo(); }

  // Arrow keys to nudge
  if (selectedId && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1;
    const box = boxes.find(b => b.id === selectedId);
    if (!box) return;
    saveState();
    if (e.key === 'ArrowLeft')  box.x = Math.max(0, box.x - d);
    if (e.key === 'ArrowRight') box.x = Math.min(canvasW() - box.w, box.x + d);
    if (e.key === 'ArrowUp')    box.y = Math.max(0, box.y - d);
    if (e.key === 'ArrowDown')  box.y = Math.min(canvasH() - box.h, box.y + d);
    renderAll();
  }
});

/* ───── Mode Switch ───── */
function setMode(m) {
  mode = m;
  btnSelect.classList.toggle('active', m === 'select');
  btnDraw.classList.toggle('active', m === 'draw');
  selOverlay.style.cursor = m === 'draw' ? 'crosshair' : 'default';
  selOverlay.style.pointerEvents = m === 'draw' ? 'auto' : 'none';
  log(`切换模式: ${m === 'select' ? '选择' : '绘制'}`, 'info');
}

btnSelect.addEventListener('click', () => setMode('select'));
btnDraw.addEventListener('click',   () => setMode('draw'));

/* ───── Delete / Clear ───── */
function deleteSelected() {
  if (!selectedId) return;
  const box = boxes.find(b => b.id === selectedId);
  saveState();
  boxes = boxes.filter(b => b.id !== selectedId);
  document.getElementById(`box-${selectedId}`)?.remove();
  deselectAll();
  renderAll();
  if (box) log(`删除 ${box.label}`, 'warn');
}

btnDelete.addEventListener('click', deleteSelected);
btnClear.addEventListener('click', () => {
  if (!boxes.length) return;
  saveState();
  boxes = [];
  boxLayer.innerHTML = '';
  deselectAll();
  renderAll();
  log('画布已清空', 'warn');
});

/* ───── Undo / Redo buttons ───── */
btnUndo.addEventListener('click', undo);
btnRedo.addEventListener('click', redo);

/* ───── Zoom ───── */
function setZoom(z) {
  zoom = Math.max(0.25, Math.min(3, z));
  canvasRoot.style.transform = `scale(${zoom})`;
  zoomLabel.textContent = Math.round(zoom * 100) + '%';
  // Redraw grid at viewport size so it always fills center-area regardless of zoom
  drawGrid();
}
btnZoomIn.addEventListener('click',    () => setZoom(zoom + 0.1));
btnZoomOut.addEventListener('click',   () => setZoom(zoom - 0.1));
btnZoomReset.addEventListener('click', () => setZoom(1));

// Ctrl+Wheel zoom
document.getElementById('canvas-viewport').addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  setZoom(zoom + (e.deltaY < 0 ? 0.1 : -0.1));
}, { passive: false });

/* ───── Grid & Snap ───── */
toggleGrid.addEventListener('change', () => {
  gridVisible = toggleGrid.checked;
  drawGrid();
});
toggleSnap.addEventListener('change', () => { snapEnabled = toggleSnap.checked; });

/* ───── Preset shapes ───── */
document.querySelectorAll('.preset-item').forEach(item => {
  item.addEventListener('click', () => {
    const w = +item.dataset.w;
    const h = +item.dataset.h;
    const label = item.dataset.label;
    saveState();
    const box = createBox(
      Math.round(canvasW() / 2 - w / 2),
      Math.round(canvasH() / 2 - h / 2),
      w, h, label
    );
    boxes.push(box);
    selectBox(box.id);
    renderAll();
    log(`添加预设: ${label} (${w}×${h})`, 'ok');
  });
});

/* ───── Init ───── */
// Double-RAF ensures flexbox layout has settled before reading dimensions
requestAnimationFrame(() => requestAnimationFrame(() => drawGrid()));
setMode('draw');   // Start in draw mode
log('Canvas Editor 已启动  —  拖拽画布可绘制边框，V=选择，B=绘制，Del=删除', 'ok');

// Redraw grid when canvas-viewport size changes (window resize)
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => requestAnimationFrame(() => drawGrid()))
    .observe(canvasViewport);
}

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
    if (!on) {
      if (ov)  ov.style.display  = 'none';
      if (lbl) lbl.style.display = 'none';
    } else {
      const panel = getPanel();
      if (panel) panel.style.display = 'flex';
    }
  }

  window.toggleZoneHighlight = function () { setActive(!active); };

  // Copy button
  document.addEventListener('click', function (e) {
    const cb = getCopyBtn();
    if (!cb) return;
    if (e.target === cb || cb.contains(e.target)) {
      e.stopPropagation();
      if (!currentInfo) return;
      const text = currentInfo;
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
      const panel = getPanel();
      if (panel) panel.style.display = 'none';
    }
  }, true);

  // Mouse move: update overlay + bubble
  window.addEventListener('mousemove', function (e) {
    if (!active) return;
    const ov  = getOverlay();
    const lbl = getLabel();
    const infoEl = getInfo();

    let el = document.elementFromPoint(e.clientX, e.clientY);
    while (el && isInPanel(el)) el = el.parentElement;
    if (!el || el === document.documentElement || el === document.body) {
      if (ov)  ov.style.display  = 'none';
      if (lbl) lbl.style.display = 'none';
      return;
    }

    const info = elInfo(el);
    currentInfo = info;

    if (ov) {
      const r = el.getBoundingClientRect();
      ov.style.top    = r.top    + 'px';
      ov.style.left   = r.left   + 'px';
      ov.style.width  = r.width  + 'px';
      ov.style.height = r.height + 'px';
      ov.style.display = 'block';
    }

    if (infoEl) infoEl.textContent = info;

    if (lbl) {
      const W = window.innerWidth, pad = 14;
      let left = e.clientX + pad;
      if (left + 200 > W) left = e.clientX - 200;
      lbl.style.left = left + 'px';
      lbl.style.top  = (e.clientY - 28) + 'px';
      lbl.textContent = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '');
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
      const panel = getPanel();
      if (panel) panel.style.display = 'none';
    }
  }, true);

  window.addEventListener('mouseleave', function () {
    if (!active) return;
    const ov = getOverlay(), lbl = getLabel();
    if (ov)  ov.style.display  = 'none';
    if (lbl) lbl.style.display = 'none';
  });
})();
