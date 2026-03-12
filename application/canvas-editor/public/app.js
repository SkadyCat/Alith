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
let currentWidgetType = 'CanvasPanel'; // default: CanvasPanel

let undoStack    = [];
let redoStack    = [];

let _globalLoadTree = null; // set by sidebar init, used by context menu

/* ───── Widget Type Definitions (loaded from /api/elements) ───── */
let WIDGET_CONTROLS = [];
let WIDGET_CONTAINERS = [];
let ALL_WIDGET_TYPES = [];

/* Group mapping: type → category name */
const WIDGET_GROUPS = {
  TextBlock: '文本', RichTextBlock: '文本',
  EditableText: '文本', MultiLineEditableText: '文本',
  EditableTextBox: '文本', MultiLineEditableTextBox: '文本',
  Button: '输入', CheckBox: '输入', Slider: '输入',
  SpinBox: '输入', ComboBoxString: '输入', InputKeySelector: '输入',
  Image: '图像', ProgressBar: '图像', Throbber: '图像', CircularThrobber: '图像',
  ListView: '列表', TileView: '列表', TreeView: '列表',
  CanvasPanel: '容器', HorizontalBox: '容器', VerticalBox: '容器',
  GridPanel: '容器', UniformGridPanel: '容器', WrapBox: '容器',
  Overlay: '容器', Border: '容器', SizeBox: '容器', ScaleBox: '容器',
  ScrollBox: '容器', WidgetSwitcher: '容器', SafeZone: '容器',
  InvalidationBox: '容器', RetainerBox: '容器', NamedSlot: '容器',
  BackgroundBlur: '特殊', NativeWidgetHost: '特殊', MenuAnchor: '特殊',
  ExpandableArea: '特殊', WebBrowser: '特殊', Spacer: '特殊',
};
function getWidgetDef(type) { return ALL_WIDGET_TYPES.find(w => w.type === type) || null; }

async function loadElements() {
  try {
    const res = await fetch('/api/elements');
    const data = await res.json();
    if (data.success) {
      WIDGET_CONTROLS   = data.controls   || [];
      WIDGET_CONTAINERS = data.containers || [];
      ALL_WIDGET_TYPES  = [...WIDGET_CONTROLS, ...WIDGET_CONTAINERS];
    }
  } catch (_) {}
  // Rebuild palette after load
  buildPalette('palette-items',      WIDGET_CONTROLS);
  buildPalette('palette-containers', WIDGET_CONTAINERS);
}

/* ───── DOM Refs ───── */
const canvasRoot       = document.getElementById('canvas-root');
const canvasViewport   = document.getElementById('canvas-viewport');
const boxLayer         = document.getElementById('box-layer');
const selOverlay       = document.getElementById('selection-overlay');
const gridCanvas       = document.getElementById('grid-canvas');
const propPanel        = document.getElementById('prop-panel');
const layerList        = document.getElementById('layer-list');
const hierarchyList    = document.getElementById('hierarchy-list');
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

/* ───── Right Panel Tabs ───── */
(function () {
  const tabs = document.querySelectorAll('.right-tab');
  const panels = { props: document.getElementById('right-panel-props'), hierarchy: document.getElementById('right-panel-hierarchy') };
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      Object.entries(panels).forEach(([key, el]) => { if (el) el.style.display = key === tab.dataset.tab ? 'flex' : 'none'; });
    });
  });
})();
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

/* ───── Panel Layout Resizers ───── */
(function initLayoutResizers() {
  const root = document.documentElement;

  // Load saved layout from localStorage
  try {
    const saved = JSON.parse(localStorage.getItem('canvas-layout') || '{}');
    if (saved.leftW)    root.style.setProperty('--left-w',    saved.leftW    + 'px');
    if (saved.rightW)   root.style.setProperty('--right-w',   saved.rightW   + 'px');
    if (saved.consoleH) root.style.setProperty('--console-h', saved.consoleH + 'px');
  } catch (_) {}

  function saveLayout() {
    try {
      const cs = getComputedStyle(root);
      localStorage.setItem('canvas-layout', JSON.stringify({
        leftW:    parseInt(cs.getPropertyValue('--left-w')),
        rightW:   parseInt(cs.getPropertyValue('--right-w')),
        consoleH: parseInt(cs.getPropertyValue('--console-h')),
      }));
    } catch (_) {}
  }

  // Vertical resizer (left/right panels)
  function makeVResizer(id, cssVar, direction, min, max) {
    const el = document.getElementById(id);
    if (!el) return;
    let active = false, startX = 0, startVal = 0;
    el.addEventListener('mousedown', e => {
      active = true;
      startX = e.clientX;
      startVal = parseInt(getComputedStyle(root).getPropertyValue(cssVar)) || 0;
      el.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!active) return;
      const delta = (e.clientX - startX) * direction;
      root.style.setProperty(cssVar, Math.max(min, Math.min(max, startVal + delta)) + 'px');
    });
    document.addEventListener('mouseup', () => {
      if (!active) return;
      active = false;
      el.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      saveLayout();
    });
  }

  // Horizontal resizer (console panel — drag upward to enlarge)
  function makeHResizer(id, cssVar, min, max) {
    const el = document.getElementById(id);
    if (!el) return;
    let active = false, startY = 0, startVal = 0;
    el.addEventListener('mousedown', e => {
      active = true;
      startY = e.clientY;
      startVal = parseInt(getComputedStyle(root).getPropertyValue(cssVar)) || 0;
      el.classList.add('dragging');
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!active) return;
      const delta = startY - e.clientY; // drag up = increase height
      root.style.setProperty(cssVar, Math.max(min, Math.min(max, startVal + delta)) + 'px');
    });
    document.addEventListener('mouseup', () => {
      if (!active) return;
      active = false;
      el.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      saveLayout();
    });
  }

  makeVResizer('resizer-left',    '--left-w',    1, 120, 480);
  makeVResizer('resizer-right',   '--right-w',  -1, 160, 520);
  makeHResizer('resizer-console', '--console-h',    60, 500);
})();

/* ───── Console / Chat Tabs ───── */
function switchConsoleTab(tab) {
  const isChat = tab === 'chat';
  document.getElementById('console-pane').style.display = isChat ? 'none' : 'flex';
  document.getElementById('chat-pane').style.display    = isChat ? 'flex' : 'none';
  document.getElementById('tab-console').classList.toggle('active', !isChat);
  document.getElementById('tab-chat').classList.toggle('active',  isChat);
  if (isChat) {
    // Load sessions first, then history
    if (typeof window._chatSessionsLoaded === 'undefined') {
      window._chatSessionsLoaded = false;
    }
    if (!window._chatSessionsLoaded) {
      window.loadSessionsList && window.loadSessionsList();
    } else {
      window.loadChatHistory && window.loadChatHistory();
    }
  }
}

/* ───── Chat with Alice ───── */
(function initChat() {
  const sessionSelect = document.getElementById('chat-session-id');
  const refreshBtn    = document.getElementById('chat-session-refresh');
  const messagesEl    = document.getElementById('chat-messages');
  const inputEl       = document.getElementById('chat-input');
  const sendBtn       = document.getElementById('chat-send-btn');

  // Load and populate sessions list
  window.loadSessionsList = async function() {
    try {
      const res  = await fetch('/proxy/agent/sessions-list');
      const data = await res.json();
      if (!data.success) return;
      const saved = localStorage.getItem('chat-session-id') || '';
      sessionSelect.innerHTML = '';
      data.sessions.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.sessionId;
        opt.textContent = s.label || s.sessionId.replace(/\.md$/, '');
        if (s.sessionId === saved) opt.selected = true;
        sessionSelect.appendChild(opt);
      });
      // Fall back to first if saved not found
      if (!sessionSelect.value && data.sessions.length) {
        sessionSelect.value = data.sessions[0].sessionId;
      }
      if (sessionSelect.value) {
        localStorage.setItem('chat-session-id', sessionSelect.value);
      }
      window._chatSessionsLoaded = true;
      loadChatHistory();
    } catch (_) {}
  };

  sessionSelect.addEventListener('change', () => {
    localStorage.setItem('chat-session-id', sessionSelect.value);
    loadChatHistory();
  });
  if (refreshBtn) refreshBtn.addEventListener('click', () => {
    window._chatSessionsLoaded = false;
    window.loadSessionsList();
  });

  window.loadChatHistory = async function() {
    const sessionId = sessionSelect.value;
    if (!sessionId) return;
    try {
      const res = await fetch('/proxy/agent/chat-history?sessionId=' + encodeURIComponent(sessionId));
      const data = await res.json();
      // Clear and rebuild
      messagesEl.innerHTML = '';
      if (!data.success || !data.messages || !data.messages.length) {
        appendMsg('（暂无历史对话）', 'system');
      } else {
        appendMsg('── 历史对话 ──', 'system');
        data.messages.forEach(msg => {
          const div = document.createElement('div');
          div.className = 'chat-msg chat-msg-user';
          const ts = msg.time || '';
          div.innerHTML = `<span class="chat-ts">${ts}</span><span class="chat-text">${
            (msg.content || '').replace(/</g, '&lt;').replace(/\n/g, '<br>')
          }</span>`;
          messagesEl.appendChild(div);
          messagesEl.scrollTop = messagesEl.scrollHeight;
        });
        appendMsg('── 以上为历史记录 ──', 'system');
      }
    } catch (err) {
      appendMsg('⚠ 加载历史失败：' + err.message, 'system');
    }
  };

  function appendMsg(text, type) {
    const div = document.createElement('div');
    div.className = 'chat-msg chat-msg-' + type;
    div.innerHTML = `<span class="chat-text">${text.replace(/</g, '&lt;')}</span>`;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  let pollTimer = null;
  function pollStatus(sessionId, resolve) {
    fetch('/proxy/agent/task-status?sessionId=' + encodeURIComponent(sessionId))
      .then(r => r.json())
      .then(d => {
        if (d.isDone || d.agentStatus === 'waiting') {
          sendBtn.disabled = false;
          appendMsg('✅ 任务已送达，爱丽丝处理完毕', 'system');
          resolve && resolve();
        } else {
          pollTimer = setTimeout(() => pollStatus(sessionId, resolve), 3000);
        }
      })
      .catch(() => { sendBtn.disabled = false; });
  }

  window.chatSend = async function() {
    const sessionId = sessionSelect.value;
    const task = inputEl.value.trim();
    if (!sessionId) { appendMsg('⚠ 请先选择 Session', 'system'); return; }
    if (!task) return;

    localStorage.setItem('chat-session-id', sessionId);
    appendMsg(task, 'user');
    inputEl.value = '';
    sendBtn.disabled = true;
    appendMsg('⏳ 发送中…', 'system');

    try {
      const res = await fetch('/proxy/agent/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, task }),
      });
      const data = await res.json();
      if (data.success) {
        appendMsg('📨 已加入队列，等待爱丽丝处理…', 'system');
        pollStatus(sessionId, () => loadChatHistory());
      } else {
        appendMsg('❌ 发送失败: ' + (data.error || ''), 'system');
        sendBtn.disabled = false;
      }
    } catch (e) {
      appendMsg('❌ 网络错误: ' + e.message, 'system');
      sendBtn.disabled = false;
    }
  };

  // Ctrl+Enter to send
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); chatSend(); }
  });
})();

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
  autoSave();
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(boxes));
  boxes = JSON.parse(undoStack.pop());
  selectedId = null;
  renderAll();
  autoSave();
  log('撤销', 'dim');
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(boxes));
  boxes = JSON.parse(redoStack.pop());
  selectedId = null;
  renderAll();
  autoSave();
  log('重做', 'dim');
}

/* ───── Anchor System ───── */
// 4×4 preset grid: cols=H position (Left/Center/Right/H-Stretch), rows=V position (Top/Mid/Bot/V-Stretch)
const ANCHOR_PRESETS = [
  // row 0: Top
  {minX:0,   minY:0,   maxX:0,   maxY:0  }, {minX:0.5, minY:0,   maxX:0.5, maxY:0  }, {minX:1,   minY:0,   maxX:1,   maxY:0  }, {minX:0, minY:0, maxX:1, maxY:0  },
  // row 1: Middle
  {minX:0,   minY:0.5, maxX:0,   maxY:0.5}, {minX:0.5, minY:0.5, maxX:0.5, maxY:0.5}, {minX:1,   minY:0.5, maxX:1,   maxY:0.5}, {minX:0, minY:0.5, maxX:1, maxY:0.5},
  // row 2: Bottom
  {minX:0,   minY:1,   maxX:0,   maxY:1  }, {minX:0.5, minY:1,   maxX:0.5, maxY:1  }, {minX:1,   minY:1,   maxX:1,   maxY:1  }, {minX:0, minY:1, maxX:1, maxY:1  },
  // row 3: V-Stretch
  {minX:0,   minY:0,   maxX:0,   maxY:1  }, {minX:0.5, minY:0,   maxX:0.5, maxY:1  }, {minX:1,   minY:0,   maxX:1,   maxY:1  }, {minX:0, minY:0, maxX:1, maxY:1  },
];

const ANCHOR_LABELS = [
  '左上','上中','右上','水平拉伸-上',
  '左中','居中','右中','水平拉伸-中',
  '左下','下中','右下','水平拉伸-下',
  '竖直拉伸-左','竖直拉伸-中','竖直拉伸-右','全拉伸',
];

function anchorMatch(a, b) {
  return a.minX === b.minX && a.minY === b.minY && a.maxX === b.maxX && a.maxY === b.maxY;
}

function buildAnchorPickerHTML(current) {
  // Draw a 4x4 grid; each cell is a mini preview showing anchor position
  const cells = ANCHOR_PRESETS.map((p, i) => {
    const active = anchorMatch(p, current) ? ' anc-active' : '';
    const hStretch = p.minX !== p.maxX;
    const vStretch = p.minY !== p.maxY;
    // Dot position in mini preview
    const dotX = hStretch ? 50 : p.minX * 100;
    const dotY = vStretch ? 50 : p.minY * 100;
    const dotW = hStretch ? 100 : 4;
    const dotH = vStretch ? 100 : 4;
    const dot = hStretch || vStretch
      ? `<div style="position:absolute;left:${Math.min(p.minX,p.maxX)*100}%;top:${Math.min(p.minY,p.maxY)*100}%;width:${dotW}%;height:${dotH}%;background:currentColor;opacity:0.7"></div>`
      : `<div style="position:absolute;left:calc(${dotX}% - 2px);top:calc(${dotY}% - 2px);width:4px;height:4px;border-radius:50%;background:currentColor"></div>`;
    return `<div class="anc-cell${active}" title="${ANCHOR_LABELS[i]}" data-anchor='${JSON.stringify(p)}'>
      <div style="position:relative;width:100%;height:100%">${dot}</div>
    </div>`;
  });
  return `<div class="anchor-picker">${cells.join('')}</div>`;
}

function refreshAnchorPicker(current) {
  document.querySelectorAll('.anc-cell').forEach((cell, i) => {
    cell.classList.toggle('anc-active', anchorMatch(ANCHOR_PRESETS[i], current));
  });
}

/* ───── Box Model ───── */
function initWidgetProps(def) {
  if (!def || !def.props) return {};
  const wp = {};
  def.props.forEach(p => { wp[p.key] = p.default !== undefined ? p.default : ''; });
  return wp;
}

function createBox(x, y, w, h, label, widgetType) {
  const def = widgetType ? getWidgetDef(widgetType) : null;
  return {
    id: nextId++,
    x: snap(x), y: snap(y),
    w: Math.max(snap(w), 20),
    h: Math.max(snap(h), 20),
    label: label || `${def ? def.label : 'Box'}${nextId - 1}`,
    borderColor: def ? def.color : '#7c6af7',
    bgColor: def ? def.bg : 'rgba(124,106,247,0.06)',
    borderWidth: 2,
    opacity: 1.0,
    widgetType: widgetType || null,
    anchor: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    widgetProps: initWidgetProps(def),
    parentId: null
  };
}

/* TileView EntryClass: 当框类型设为 TileView/ListView/TreeView 时，自动在内部创建 EntryClass 子框 */
const ENTRY_CLASS_TYPES = ['TileView', 'ListView', 'TreeView'];

// Returns true if this box is an auto-created EntryClass child inside a container type
function isLockedEntryClass(box) {
  if (box.label !== 'EntryClass') return false;
  const parent = boxes.find(b => b.id === box.parentId);
  return parent && ENTRY_CLASS_TYPES.includes(parent.widgetType);
}

// Returns the locked EntryClass ancestor of this box (if it's inside one), or null
function getLockedEntryClassAncestor(box) {
  let current = box;
  while (current && current.parentId != null) {
    const parent = boxes.find(b => b.id === current.parentId);
    if (!parent) break;
    if (isLockedEntryClass(parent)) return parent;
    current = parent;
  }
  return null;
}

// Returns the isEntryClass-marked ancestor of this box (if it's inside one), or null
// Used to prevent dragging controls inside an entryclass box on the main canvas
function getIsEntryClassAncestor(box) {
  let current = box;
  while (current && current.parentId != null) {
    const parent = boxes.find(b => b.id === current.parentId);
    if (!parent) break;
    if (parent.isEntryClass) return parent;
    current = parent;
  }
  return null;
}

function ensureTileViewEntry(box) {
  if (!box || !ENTRY_CLASS_TYPES.includes(box.widgetType)) return;
  // 已存在 EntryClass 子框则跳过
  const hasEntry = boxes.some(b => b.parentId === box.id && b.label === 'EntryClass');
  if (hasEntry) return;
  const pad = 12;
  const ew = Math.max(Math.round(box.w * 0.6), 80);
  const eh = Math.max(Math.round(box.h * 0.4), 40);
  const ex = box.x + pad;
  const ey = box.y + pad;
  const entry = createBox(ex, ey, ew, eh, 'EntryClass', null);
  entry.borderColor = '#e8a020';
  entry.bgColor = 'rgba(232,160,32,0.08)';
  entry.parentId = box.id;
  // Sync entry dimensions to TileView widgetProps
  if (!box.widgetProps) box.widgetProps = {};
  if (!box.widgetProps.entryWidth)  box.widgetProps.entryWidth  = ew;
  if (!box.widgetProps.entryHeight) box.widgetProps.entryHeight = eh;
  boxes.push(entry);
}

/* Find the smallest existing box that fully contains the given rect, excluding excludeId.
   "Fully contains" means the candidate box's bounds completely wrap the child rect.
   This prevents a large parent from becoming a child of a smaller inner box. */
function findParentFor(x, y, w, h, excludeId) {
  let best = null, bestArea = Infinity;
  boxes.forEach(b => {
    if (b.id === excludeId) return;
    // Candidate must fully contain the child rect
    if (x >= b.x && (x + w) <= (b.x + b.w) && y >= b.y && (y + h) <= (b.y + b.h)) {
      const area = b.w * b.h;
      if (area < bestArea) { bestArea = area; best = b; }
    }
  });
  return best ? best.id : null;
}

// Recompute parentId for every box based on current positions.
// Call after draw or drag-end so hierarchy is always up-to-date.
function recomputeAllParents() {
  boxes.forEach(b => {
    b.parentId = findParentFor(b.x, b.y, b.w, b.h, b.id);
  });
}

/* ───── Widget Content Renderer (data-driven) ───── */
function renderWidgetContent(box, el, def) {
  // Remove old widget-render element
  const old = el.querySelector('.widget-render');
  if (old) old.remove();
  if (!def || !def.render) return;

  const r = def.render;
  const wp = box.widgetProps || {};
  const wr = document.createElement('div');
  wr.className = 'widget-render';
  wr.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;display:flex;align-items:center;justify-content:center;box-sizing:border-box;';

  if (r.type === 'text' || r.type === 'richtext') {
    const txt = wp[r.src] ?? (def.props?.find(p=>p.key===r.src)?.default ?? '');
    const size = +wp[r.size] || 14;
    const color = wp[r.color] || '#fff';
    const align = (wp[r.align] || (r.align || 'center')).toLowerCase();
    const bold = wp[r.bold];
    const italic = wp[r.italic];
    const wrap = wp[r.wrap] !== false;
    wr.style.justifyContent = align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start';
    wr.style.alignItems = 'center';
    wr.style.padding = '4px 6px';
    const span = document.createElement('span');
    span.style.cssText = `font-size:${Math.min(size, box.h * 0.8)}px;color:${color};font-weight:${bold?'bold':'normal'};font-style:${italic?'italic':'normal'};white-space:${wrap?'pre-wrap':'nowrap'};text-align:${align};word-break:break-word;max-width:100%;`;
    span.textContent = txt || '';
    wr.appendChild(span);

  } else if (r.type === 'progress') {
    const pct = Math.min(1, Math.max(0, +wp[r.src] || 0));
    const fillColor = wp[r.fill] || '#56cfba';
    const barColor = wp[r.bar] || 'rgba(255,255,255,0.1)';
    wr.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    wr.style.background = barColor;
    const fill = document.createElement('div');
    fill.style.cssText = `position:absolute;left:0;top:0;height:100%;width:${pct*100}%;background:${fillColor};transition:width 0.2s;`;
    wr.appendChild(fill);

  } else if (r.type === 'slider') {
    const val = +wp[r.src] || 0;
    const mn = +wp[r.min] || 0;
    const mx = +wp[r.max] || 1;
    const pct = mx !== mn ? (val - mn) / (mx - mn) : 0;
    wr.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:flex;align-items:center;padding:0 8px;box-sizing:border-box;';
    const track = document.createElement('div');
    track.style.cssText = 'width:100%;height:4px;background:rgba(255,255,255,0.15);border-radius:2px;position:relative;';
    const thumb = document.createElement('div');
    thumb.style.cssText = `position:absolute;top:50%;transform:translate(-50%,-50%);left:${pct*100}%;width:12px;height:12px;background:#fff;border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,0.5);`;
    const filled = document.createElement('div');
    filled.style.cssText = `position:absolute;left:0;top:0;height:100%;width:${pct*100}%;background:#7c6af7;border-radius:2px;`;
    track.appendChild(filled);
    track.appendChild(thumb);
    wr.appendChild(track);

  } else if (r.type === 'input') {
    const hint = wp[r.src] || '';
    const size = +wp[r.size] || 12;
    const color = wp[r.color] || '#aaa';
    wr.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:flex;align-items:center;padding:0 8px;box-sizing:border-box;';
    const span = document.createElement('span');
    span.style.cssText = `font-size:${size}px;color:${color};opacity:0.7;font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
    span.textContent = hint;
    wr.appendChild(span);

  } else if (r.type === 'image') {
    const src = wp[r.src] || '';
    const tint = wp[r.tint] || '#ffffff';
    if (src) {
      const img = document.createElement('img');
      img.src = src;
      img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;pointer-events:none;';
      if (tint !== '#ffffff') img.style.filter = `sepia(1) saturate(2) hue-rotate(0deg) opacity(0.9)`;
      wr.appendChild(img);
    } else {
      wr.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:flex;align-items:center;justify-content:center;background:repeating-linear-gradient(45deg,rgba(255,255,255,0.04) 0,rgba(255,255,255,0.04) 4px,transparent 4px,transparent 8px);';
      const label = document.createElement('span');
      label.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.3);';
      label.textContent = 'Image';
      wr.appendChild(label);
    }

  } else if (r.type === 'checkbox') {
    const checked = wp[r.src] === true || wp[r.src] === 'true';
    const labelText = wp[r.label] || '';
    wr.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:flex;align-items:center;padding:0 6px;gap:6px;box-sizing:border-box;';
    const box2 = document.createElement('div');
    box2.style.cssText = `width:14px;height:14px;flex-shrink:0;border:2px solid rgba(255,255,255,0.6);border-radius:2px;background:${checked?'rgba(106,247,167,0.5)':'transparent'};display:flex;align-items:center;justify-content:center;`;
    if (checked) { box2.innerHTML = '<span style="color:#fff;font-size:10px;line-height:1;">✓</span>'; }
    const lbl = document.createElement('span');
    lbl.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    lbl.textContent = labelText;
    wr.appendChild(box2);
    wr.appendChild(lbl);

  } else if (r.type === 'spinbox') {
    const val = wp[r.src] !== undefined ? wp[r.src] : 0;
    wr.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:flex;align-items:center;padding:0 4px;box-sizing:border-box;gap:2px;';
    const inner = document.createElement('div');
    inner.style.cssText = 'flex:1;border:1px solid rgba(255,255,255,0.2);border-radius:3px;height:calc(100% - 6px);display:flex;align-items:center;padding:0 6px;';
    inner.innerHTML = `<span style="font-size:12px;color:#fff;">${val}</span>`;
    const arrows = document.createElement('div');
    arrows.style.cssText = 'display:flex;flex-direction:column;gap:1px;';
    arrows.innerHTML = '<div style="font-size:8px;color:rgba(255,255,255,0.5);line-height:1;">▲</div><div style="font-size:8px;color:rgba(255,255,255,0.5);line-height:1;">▼</div>';
    wr.appendChild(inner);
    wr.appendChild(arrows);

  } else if (r.type === 'combo') {
    const selected = wp[r.src] || '';
    wr.style.cssText = 'position:absolute;inset:0;pointer-events:none;display:flex;align-items:center;padding:0 6px;justify-content:space-between;box-sizing:border-box;';
    const text = document.createElement('span');
    text.style.cssText = 'font-size:12px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;';
    text.textContent = selected;
    const arrow = document.createElement('span');
    arrow.style.cssText = 'font-size:10px;color:rgba(255,255,255,0.5);flex-shrink:0;margin-left:4px;';
    arrow.textContent = '▾';
    wr.appendChild(text);
    wr.appendChild(arrow);
  }

  el.appendChild(wr);
}

/* ───── Render ───── */
function renderBox(box) {
  let el = document.getElementById(`box-${box.id}`);
  const def = box.widgetType ? getWidgetDef(box.widgetType) : null;
  if (!el) {
    el = document.createElement('div');
    el.className = 'box-item';
    el.id = `box-${box.id}`;

    // Widget type badge
    const badge = document.createElement('div');
    badge.className = 'box-type-badge';
    el.appendChild(badge);

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
    el.addEventListener('contextmenu', e => {
      if (mode !== 'select') return;
      e.preventDefault();
      e.stopPropagation();
      // Locked EntryClass: show its own context menu (with 编辑EntryClass option)
      if (isLockedEntryClass(box)) {
        selectBox(box.id);
        renderAll();
        showBoxCtxMenu(e.clientX, e.clientY, box);
        return;
      }
      // Child of locked EntryClass: redirect to the EntryClass context menu
      const lockedEc = getLockedEntryClassAncestor(box);
      if (lockedEc) {
        selectBox(lockedEc.id);
        renderAll();
        showBoxCtxMenu(e.clientX, e.clientY, lockedEc);
        return;
      }
      // Child of an isEntryClass box: redirect to the isEntryClass box context menu
      const ecAncestor = getIsEntryClassAncestor(box);
      if (ecAncestor) {
        selectBox(ecAncestor.id);
        renderAll();
        showBoxCtxMenu(e.clientX, e.clientY, ecAncestor);
        return;
      }
      selectBox(box.id);
      renderAll();
      showBoxCtxMenu(e.clientX, e.clientY, box);
    });
  }

  el.style.left    = box.x + 'px';
  el.style.top     = box.y + 'px';
  el.style.width   = box.w + 'px';
  el.style.height  = box.h + 'px';
  el.style.border  = `${box.borderWidth}px solid ${box.borderColor}`;
  el.style.background = box.bgColor;
  el.style.opacity = box.opacity;

  // Locked EntryClass (inside TileView/ListView/TreeView): gold dashed outline, selectable for scale editing
  const locked = isLockedEntryClass(box);
  const lockedByAncestor = !locked && !!getLockedEntryClassAncestor(box);
  const isEcAncestor = !locked && !lockedByAncestor && !!getIsEntryClassAncestor(box);
  if (locked) {
    el.style.outline = '2px dashed #f5c542';
    el.style.outlineOffset = '2px';
    el.style.cursor = '';  // allow normal interaction (select/drag for scale editing)
    el.style.pointerEvents = 'auto';
    el.title = 'EntryClass — 点击选中，拖拽边框调整尺寸，右键可编辑';
  } else if (lockedByAncestor) {
    el.style.outline = '1px dashed rgba(245,197,66,0.4)';
    el.style.outlineOffset = '1px';
    el.style.cursor = 'not-allowed';
    el.style.pointerEvents = 'none'; // clicks fall through to the EntryClass parent
    el.title = '此控件在 EntryClass 内部，不可单独操作';
  } else if (isEcAncestor) {
    el.style.outline = '1px dashed rgba(245,197,66,0.35)';
    el.style.outlineOffset = '1px';
    el.style.cursor = 'not-allowed';
    el.style.pointerEvents = 'none'; // clicks fall through to the isEntryClass parent
    el.title = '此控件在 EntryClass 内部 — 右键 EntryClass 可单独打开编辑';
  } else {
    el.style.outline = box.isEntryClass ? '2px solid #f5c542' : '';
    el.style.outlineOffset = box.isEntryClass ? '2px' : '';
    el.style.cursor = box.isEntryClass ? 'default' : '';
    el.style.pointerEvents = '';
    el.title = box.isEntryClass ? 'EntryClass — 右键可编辑' : (box.description || '');
  }
  // If description exists and title hasn't been set by the lock block, append it
  if (!locked && !lockedByAncestor && !isEcAncestor && !box.isEntryClass && box.description) {
    el.title = box.description;
  }
  // Children of locked EntryClass or isEntryClass boxes are truly locked (not the EntryClass itself)
  const isEffectivelyLocked = lockedByAncestor || isEcAncestor;
  // Show "Name (Type)" when a widget type is set, otherwise just the name
  const labelText = def ? `${box.label} (${def.label})` : box.label;
  el.querySelector('.box-label').textContent = box.description ? `${labelText} 💬` : labelText;
  if (box.description) {
    el.querySelector('.box-label').title = `📝 ${box.description}`;
  } else {
    el.querySelector('.box-label').removeAttribute('title');
  }

  const badge = el.querySelector('.box-type-badge');
  badge.style.display = 'none'; // type is now shown inline in the label

  // Widget-specific content rendering (data-driven from elements.json)
  renderWidgetContent(box, el, def);

  const isSelected = box.id === selectedId;
  el.classList.toggle('selected', isSelected);
  // Show resize handles for selected boxes; locked EntryClass itself CAN be resized (it controls entry size),
  // but its children/descendants cannot.
  el.querySelectorAll('.resize-handle').forEach(h => {
    h.style.display = (isSelected && !lockedByAncestor) ? 'block' : 'none';
  });

  // Anchor indicator (shows on canvas when selected)
  let ancEl = el.querySelector('.anchor-indicator');
  if (isSelected) {
    if (!ancEl) {
      ancEl = document.createElement('div');
      ancEl.className = 'anchor-indicator';
      ancEl.style.cssText = 'position:absolute;pointer-events:none;z-index:10';
      el.appendChild(ancEl);
    }
    const a = box.anchor || { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    const hStretch = a.minX !== a.maxX;
    const vStretch = a.minY !== a.maxY;
    // Position the indicator relative to the box
    const ix = a.minX * box.w;
    const iy = a.minY * box.h;
    const iw = hStretch ? (a.maxX - a.minX) * box.w : 0;
    const ih = vStretch ? (a.maxY - a.minY) * box.h : 0;
    if (hStretch || vStretch) {
      ancEl.style.left   = ix + 'px';
      ancEl.style.top    = iy + 'px';
      ancEl.style.width  = (hStretch ? iw : 0) + 'px';
      ancEl.style.height = (vStretch ? ih : 0) + 'px';
      ancEl.style.border = '1.5px dashed rgba(255,220,60,0.75)';
      ancEl.style.borderRadius = '0';
      ancEl.innerHTML = '';
    } else {
      const S = 12;
      ancEl.style.left   = (ix - S / 2) + 'px';
      ancEl.style.top    = (iy - S / 2) + 'px';
      ancEl.style.width  = S + 'px';
      ancEl.style.height = S + 'px';
      ancEl.style.border = 'none';
      ancEl.innerHTML = `<svg width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" xmlns="http://www.w3.org/2000/svg">
        <polygon points="${S/2},1 ${S-1},${S/2} ${S/2},${S-1} 1,${S/2}" fill="rgba(255,220,60,0.9)" stroke="rgba(0,0,0,0.5)" stroke-width="0.8"/>
      </svg>`;
    }
    ancEl.style.display = '';
  } else if (ancEl) {
    ancEl.style.display = 'none';
  }

  // EntryClass preview
  if (box.entryClassRef) {
    renderEntryClassPreview(box, el);
  } else {
    el.querySelectorAll('.ec-preview-box').forEach(x => x.remove());
  }

  // TileView grid preview
  if (box.widgetType === 'TileView') {
    renderTileViewGrid(box, el);
  } else {
    el.querySelectorAll('.tile-grid-item').forEach(x => x.remove());
  }
}

/* ───── EntryClass Editor Modal ───── */
function showEntryClassEditor(tileBox) {
  const entryBox = boxes.find(b => b.parentId === tileBox.id && b.label === 'EntryClass');
  if (!entryBox) { log('未找到 EntryClass', 'warn'); return; }

  function getSubtree(pid) {
    const ch = boxes.filter(b => b.parentId === pid);
    return ch.reduce((acc, c) => acc.concat(c, getSubtree(c.id)), []);
  }

  const ox = entryBox.x, oy = entryBox.y;
  const entryChildren = getSubtree(entryBox.id);
  // Deep copies: EntryClass at (8,8), children normalized relative to it
  const entryId0 = entryBox.id;
  let _ecBoxes = [
    { ...JSON.parse(JSON.stringify(entryBox)), x: 8, y: 8, parentId: null },
    ...entryChildren.map(c => ({ ...JSON.parse(JSON.stringify(c)), x: c.x - ox + 8, y: c.y - oy + 8, parentId: c.parentId === entryBox.id ? entryId0 : c.parentId }))
  ];

  let _ecSelId = null;
  let _ecNextId = Math.max(..._ecBoxes.map(b => b.id), 1000) + 1;

  // ── Overlay ──
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:9900;display:flex;flex-direction:column;';

  // Header
  const hdr = document.createElement('div');
  hdr.style.cssText = 'height:44px;background:#1a1a2e;border-bottom:1px solid #3a3a5c;display:flex;align-items:center;padding:0 14px;gap:10px;flex-shrink:0;';
  hdr.innerHTML = `<span style="color:#f5c542;font-weight:bold;font-size:14px;">✏ 编辑 EntryClass</span><span style="color:#666;font-size:11px;margin-right:8px;">${tileBox.label}</span><span style="color:#555;font-size:11px;">拖拽画布绘制 · 点击选择 · 右键设类型 · Del删除 · 金框=EntryClass可调整大小</span>`;
  const saveBtn = document.createElement('button');
  saveBtn.textContent = '💾 保存';
  saveBtn.style.cssText = 'margin-left:auto;padding:5px 16px;background:#4a7c59;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:bold;';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '✕ 取消';
  cancelBtn.style.cssText = 'padding:5px 12px;background:#333350;color:#ccc;border:none;border-radius:4px;cursor:pointer;font-size:13px;';
  hdr.appendChild(saveBtn); hdr.appendChild(cancelBtn);
  overlay.appendChild(hdr);

  // Canvas
  const cvArea = document.createElement('div');
  cvArea.style.cssText = 'flex:1;overflow:auto;position:relative;background:#0d0d1e;';
  overlay.appendChild(cvArea);
  document.body.appendChild(overlay);

  // ── Render ──
  function _ecRender() {
    cvArea.innerHTML = '';
    _ecBoxes.forEach(b => {
      const isEntry = b.id === entryId0;
      const el = document.createElement('div');
      const def = getWidgetDef(b.widgetType);
      el.style.cssText = `position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;border:${b.borderWidth||2}px solid ${b.borderColor||'#7c6af7'};background:${b.bgColor||'rgba(124,106,247,0.06)'};box-sizing:border-box;overflow:hidden;user-select:none;cursor:${isEntry?'se-resize':'move'};`;
      if (isEntry) {
        el.style.outline = '2px dashed #f5c542'; el.style.outlineOffset = '2px';
        el.title = 'EntryClass — 拖拽调整大小';
      } else if (b.id === _ecSelId) {
        el.style.outline = '2px solid #7c6af7';
      }
      const lbl = document.createElement('div');
      lbl.style.cssText = 'position:absolute;top:2px;left:4px;right:4px;font-size:10px;color:rgba(255,255,255,0.55);pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      lbl.textContent = def ? `${b.label} (${def.label})` : b.label;
      el.appendChild(lbl);

      // SE resize handle for selected non-entry boxes
      if (!isEntry && b.id === _ecSelId) {
        const rh = document.createElement('div');
        rh.style.cssText = 'position:absolute;right:0;bottom:0;width:10px;height:10px;background:#7c6af7;cursor:se-resize;z-index:1;';
        rh.addEventListener('mousedown', e => {
          e.stopPropagation();
          const sx = e.clientX, sy = e.clientY, ow = b.w, oh = b.h;
          const mv = e2 => { b.w = Math.max(20, ow + e2.clientX - sx); b.h = Math.max(20, oh + e2.clientY - sy); _ecRender(); };
          const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
          document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
        });
        el.appendChild(rh);
      }

      el.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        e.stopPropagation();
        if (isEntry) {
          const sx = e.clientX, sy = e.clientY, ow = b.w, oh = b.h;
          // Snapshot children's original positions/sizes for proportional scaling
          const origSnap = _ecBoxes.slice(1).map(c => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h }));
          const mv = e2 => {
            const newW = Math.max(20, ow + e2.clientX - sx);
            const newH = Math.max(20, oh + e2.clientY - sy);
            const scX = newW / ow, scY = newH / oh;
            b.w = newW; b.h = newH;
            _ecBoxes.slice(1).forEach(c => {
              const o = origSnap.find(s => s.id === c.id); if (!o) return;
              c.x = 8 + (o.x - 8) * scX; c.y = 8 + (o.y - 8) * scY;
              c.w = Math.max(4, o.w * scX); c.h = Math.max(4, o.h * scY);
            });
            _ecRender();
          };
          const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
          document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
        } else {
          _ecSelId = b.id; _ecRender();
          const sx = e.clientX - b.x, sy = e.clientY - b.y;
          const mv = e2 => { b.x = e2.clientX - sx; b.y = e2.clientY - sy; _ecRender(); };
          const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
          document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
        }
      });

      el.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        if (isEntry) return;
        _ecSelId = b.id; _ecRender();
        const cm = document.createElement('div');
        cm.style.cssText = `position:fixed;left:${Math.min(e.clientX, window.innerWidth-180)}px;top:${Math.min(e.clientY, window.innerHeight-320)}px;background:#1a1a2e;border:1px solid #3a3a5c;border-radius:6px;padding:4px 0;z-index:10001;min-width:170px;max-height:340px;overflow-y:auto;box-shadow:0 4px 16px rgba(0,0,0,0.6);`;
        const delItem = document.createElement('div');
        delItem.style.cssText = 'padding:7px 14px;cursor:pointer;color:#ff6b6b;font-size:12px;';
        delItem.textContent = '🗑 删除此框';
        delItem.addEventListener('click', () => { _ecBoxes = _ecBoxes.filter(x => x.id !== b.id); _ecSelId = null; _ecRender(); cm.remove(); });
        cm.appendChild(delItem);
        const sep = document.createElement('div'); sep.style.cssText = 'margin:3px 0;border-top:1px solid #3a3a5c;'; cm.appendChild(sep);
        ALL_WIDGET_TYPES.forEach(w => {
          const wi = document.createElement('div');
          wi.style.cssText = `padding:5px 14px;cursor:pointer;font-size:12px;color:${w.color};`;
          wi.textContent = `${w.icon} ${w.label_zh || w.label}`;
          wi.addEventListener('click', () => { b.widgetType = w.type; b.borderColor = w.color; b.bgColor = w.bg; b.widgetProps = initWidgetProps(w); _ecRender(); cm.remove(); });
          cm.appendChild(wi);
        });
        document.body.appendChild(cm);
        const dismiss = e2 => { if (!cm.contains(e2.target)) { cm.remove(); document.removeEventListener('mousedown', dismiss); } };
        setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
      });

      cvArea.appendChild(el);
    });
  }

  _ecRender();

  // Draw on canvas background
  cvArea.addEventListener('mousedown', e => {
    if (e.target !== cvArea) return;
    _ecSelId = null;
    const rect = cvArea.getBoundingClientRect();
    const sx = e.clientX - rect.left + cvArea.scrollLeft;
    const sy = e.clientY - rect.top + cvArea.scrollTop;
    const prev = document.createElement('div');
    prev.style.cssText = `position:absolute;left:${sx}px;top:${sy}px;width:0;height:0;border:2px dashed #7c6af7;box-sizing:border-box;pointer-events:none;`;
    cvArea.appendChild(prev);
    const mv = e2 => {
      const cx = e2.clientX - rect.left + cvArea.scrollLeft, cy = e2.clientY - rect.top + cvArea.scrollTop;
      const l = Math.min(sx, cx), t = Math.min(sy, cy);
      prev.style.left = l + 'px'; prev.style.top = t + 'px';
      prev.style.width = Math.abs(cx - sx) + 'px'; prev.style.height = Math.abs(cy - sy) + 'px';
    };
    const up = e2 => {
      prev.remove();
      document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
      const cx = e2.clientX - rect.left + cvArea.scrollLeft, cy = e2.clientY - rect.top + cvArea.scrollTop;
      const l = Math.round(Math.min(sx, cx)), t = Math.round(Math.min(sy, cy));
      const w = Math.round(Math.abs(cx - sx)), h = Math.round(Math.abs(cy - sy));
      if (w < 8 || h < 8) return;
      const nb = { id: _ecNextId++, x: l, y: t, w, h, label: `Box${_ecNextId-1}`, borderColor: '#7c6af7', bgColor: 'rgba(124,106,247,0.06)', borderWidth: 2, opacity: 1, widgetType: null, parentId: entryId0, anchor: {minX:0,minY:0,maxX:0,maxY:0}, widgetProps: {} };
      _ecBoxes.push(nb); _ecSelId = nb.id; _ecRender();
    };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  });

  // Keyboard
  const onKey = e => {
    if (!overlay.isConnected) { document.removeEventListener('keydown', onKey); return; }
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && _ecSelId && _ecSelId !== entryId0) {
      _ecBoxes = _ecBoxes.filter(b => b.id !== _ecSelId); _ecSelId = null; _ecRender();
    }
  };
  document.addEventListener('keydown', onKey);

  // Save
  saveBtn.addEventListener('click', () => {
    saveState();
    function allDesc(pid) {
      const ch = boxes.filter(b => b.parentId === pid);
      return ch.reduce((a, c) => a.concat(c, allDesc(c.id)), []);
    }
    const toRemove = new Set(allDesc(entryBox.id).map(b => b.id));
    const kept = boxes.filter(b => !toRemove.has(b.id));
    // Update entryBox size
    entryBox.w = _ecBoxes[0].w; entryBox.h = _ecBoxes[0].h;
    // Restore children with offset
    const newChildren = _ecBoxes.slice(1).map(b => ({
      ...JSON.parse(JSON.stringify(b)),
      x: b.x - 8 + ox, y: b.y - 8 + oy,
      parentId: b.parentId === entryId0 ? entryBox.id : b.parentId
    }));
    boxes.length = 0;
    kept.forEach(b => boxes.push(b));
    newChildren.forEach(b => boxes.push(b));
    recomputeAllParents();
    renderAll(); autoSave();
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    log('EntryClass 已保存', 'ok');
  });

  cancelBtn.addEventListener('click', () => { overlay.remove(); document.removeEventListener('keydown', onKey); });
}

/* ── Open EntryClass in a new browser tab as its own canvas session ── */
/* ── Open EntryClass in main canvas by directly switching canvas context (in-memory) ── */
// Stack to support returning to parent canvas after editing an EntryClass
const _canvasStack = [];

function _showReturnBar(label) {
  let bar = document.getElementById('ec-return-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'ec-return-bar';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99990;background:#1a2a1a;border-bottom:2px solid #4a7c59;display:flex;align-items:center;padding:0 14px;height:36px;gap:10px;font-size:13px;color:#cfe8cf;';
    bar.innerHTML = `<span style="color:#7fcc7f">✏ 正在编辑 EntryClass</span><span id="ec-return-label" style="color:#aaa;font-size:11px;"></span><button id="ec-return-btn" style="margin-left:auto;padding:4px 14px;background:#2d5e3a;color:#7fcc7f;border:1px solid #4a7c59;border-radius:4px;cursor:pointer;font-size:12px;">← 返回主画布</button>`;
    document.body.appendChild(bar);
    document.getElementById('ec-return-btn').addEventListener('click', _returnToParentCanvas);
  }
  const lbl = document.getElementById('ec-return-label');
  if (lbl) lbl.textContent = label ? `(${label})` : '';
  bar.style.display = 'flex';
}

function _hideReturnBar() {
  const bar = document.getElementById('ec-return-bar');
  if (bar) bar.style.display = 'none';
}

function _returnToParentCanvas() {
  if (!_canvasStack.length) { _hideReturnBar(); return; }
  const prev = _canvasStack.pop();

  // Sync EC edits back into prev.boxes:
  // current boxes[0] = the EntryClass (normalized to x:8, y:8)
  // remaining boxes = its descendants (also normalized)
  const editedEcBox = boxes[0]; // the EntryClass itself (parentId===null in EC edit mode)
  if (editedEcBox) {
    // Find original EC box in prev.boxes by ID
    const origEc = prev.boxes.find(b => b.id === editedEcBox.id);
    if (origEc) {
      const ox = origEc.x, oy = origEc.y;
      // Sync size changes
      origEc.w = editedEcBox.w; origEc.h = editedEcBox.h;
      // Remove all old descendants of EC from prev.boxes
      function allDescIds(pid, arr) {
        const ch = arr.filter(b => b.parentId === pid);
        return ch.reduce((acc, c) => acc.concat(c.id, allDescIds(c.id, arr)), []);
      }
      const oldChildIds = new Set(allDescIds(origEc.id, prev.boxes));
      prev.boxes = prev.boxes.filter(b => !oldChildIds.has(b.id));
      // Re-add descendants with original coordinate offset restored
      const newChildren = boxes.slice(1).map(c => ({
        ...JSON.parse(JSON.stringify(c)),
        x: c.x - 8 + ox,
        y: c.y - 8 + oy
      }));
      newChildren.forEach(c => prev.boxes.push(c));
    }
  }

  // Restore parent canvas
  boxes.length = 0;
  prev.boxes.forEach(b => boxes.push(b));
  nextId = prev.nextId;
  selectedId = null;

  // Update session path BEFORE clearing ecEditMode so saveState→autoSave uses correct path
  setActiveSession(prev.sessionName, prev.sessionPath);
  _ecEditMode = false;

  saveState(); // saves to undo stack; autoSave() fires with correct _sessionPath
  renderAll();
  if (_canvasStack.length === 0) _hideReturnBar();
  else _showReturnBar(_canvasStack[_canvasStack.length - 1].ecLabel);
  log('已返回主画布（EC 修改已同步）', 'ok');
}

async function openEntryClassInCanvas(tileBox, entryBox) {
  const eb = entryBox || boxes.find(b => b.parentId === tileBox.id && b.label === 'EntryClass');
  if (!eb) { log('未找到 EntryClass', 'warn'); return; }

  function getSubtree(pid) {
    const ch = boxes.filter(b => b.parentId === pid);
    return ch.reduce((acc, c) => acc.concat(c, getSubtree(c.id)), []);
  }
  const ecChildren = getSubtree(eb.id);
  const ox = eb.x, oy = eb.y;

  // Push current canvas to stack before switching
  _canvasStack.push({
    boxes: JSON.parse(JSON.stringify(boxes)),
    nextId,
    sessionName: _sessionName,
    sessionPath: _sessionPath,
    ecLabel: tileBox.label || 'EntryClass'
  });

  // Build the EC canvas: EntryClass at (8,8), children normalized
  const newBoxes = [
    { ...JSON.parse(JSON.stringify(eb)), x: 8, y: 8, parentId: null },
    ...ecChildren.map(c => ({
      ...JSON.parse(JSON.stringify(c)),
      x: c.x - ox + 8, y: c.y - oy + 8,
      parentId: c.parentId
    }))
  ];

  boxes.length = 0;
  newBoxes.forEach(b => boxes.push(b));
  selectedId = null;
  _ecEditMode = true;
  saveState();
  renderAll();
  requestAnimationFrame(() => zoomToFit());

  _showReturnBar(tileBox.label || 'EntryClass');
  log(`🎨 正在编辑 EntryClass「${tileBox.label}」— 点击"← 返回主画布"完成`, 'ok');
}

async function openEntryClassInNewTab(tileBox, entryBox) {
  const eb = entryBox || boxes.find(b => b.parentId === tileBox.id && b.label === 'EntryClass');
  if (!eb) { log('未找到 EntryClass', 'warn'); return; }

  function getSubtree(pid) {
    const ch = boxes.filter(b => b.parentId === pid);
    return ch.reduce((acc, c) => acc.concat(c, getSubtree(c.id)), []);
  }
  const ecChildren = getSubtree(eb.id);
  const ox = eb.x, oy = eb.y;
  const ecBoxes = [
    { ...JSON.parse(JSON.stringify(eb)), x: 8, y: 8, parentId: null },
    ...ecChildren.map(c => ({
      ...JSON.parse(JSON.stringify(c)),
      x: c.x - ox + 8, y: c.y - oy + 8,
      parentId: c.parentId === eb.id ? eb.id : c.parentId
    }))
  ];
  const filePath = `sessions/entryclass/tmp_ec_${eb.id}.session`;
  const content = JSON.stringify({
    version: '1.1',
    boxes: serializeBoxes(ecBoxes),
    nextId: Math.max(...ecBoxes.map(b => b.id)) + 1,
    isEntryClass: true,
    entryClassLabel: tileBox.label,
    savedAt: new Date().toISOString()
  }, null, 2);
  try {
    const res = await fetch('/docs/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: filePath, content })
    });
    const data = await res.json();
    if (data.success) {
      const url = location.pathname + '?ecload=' + encodeURIComponent(filePath);
      window.open(url, '_blank');
      log(`🔗 EntryClass 已在新标签页打开`, 'ok');
    } else {
      log('⚠ 无法保存临时 Session：' + (data.error || ''), 'err');
    }
  } catch (e) {
    log('⚠ 网络错误：' + e.message, 'err');
  }
}


const _ecCache = {};// path → {boxes, ts}
async function renderEntryClassPreview(box, el) {
  const path = box.entryClassRef;
  if (!path) return;
  try {
    if (!_ecCache[path] || Date.now() - _ecCache[path].ts > 5000) {
      const res = await fetch(`/docs/api/get?name=${encodeURIComponent(path)}`);
      const data = await res.json();
      if (!data.success) return;
      const session = JSON.parse(data.content);
      _ecCache[path] = { boxes: session.boxes || [], ts: Date.now() };
    }
    const ecBoxes = _ecCache[path].boxes;
    el.querySelectorAll('.ec-preview-box').forEach(x => x.remove());
    if (!ecBoxes.length) return;

    const minX = Math.min(...ecBoxes.map(b => b.x));
    const minY = Math.min(...ecBoxes.map(b => b.y));
    const maxX = Math.max(...ecBoxes.map(b => b.x + b.w));
    const maxY = Math.max(...ecBoxes.map(b => b.y + b.h));
    const srcW = maxX - minX || 1;
    const srcH = maxY - minY || 1;
    const pad = 4;
    const scale = Math.min((box.w - pad * 2) / srcW, (box.h - pad * 2) / srcH);

    ecBoxes.forEach(b => {
      const mini = document.createElement('div');
      mini.className = 'ec-preview-box';
      mini.style.cssText = `position:absolute;left:${(b.x-minX)*scale+pad}px;top:${(b.y-minY)*scale+pad}px;width:${b.w*scale}px;height:${b.h*scale}px;border:${Math.max(1,b.borderWidth*scale)}px solid ${b.borderColor};background:${b.bgColor};opacity:${b.opacity};pointer-events:none;box-sizing:border-box;font-size:${Math.max(6,10*scale)}px;color:rgba(255,255,255,0.7);overflow:hidden;`;
      el.appendChild(mini);
    });
  } catch(e) { console.warn('[EC preview]', e); }
}

/* ───── TileView Grid Preview ───── */
function renderTileViewGrid(box, el) {
  el.querySelectorAll('.tile-grid-item').forEach(x => x.remove());
  const wp = box.widgetProps || {};
  const count = Math.max(0, Math.floor(wp.gridPreviewNum || 0));
  if (!count) return;

  const entry = boxes.find(b => b.parentId === box.id && b.label === 'EntryClass');
  if (!entry || entry.w <= 0 || entry.h <= 0) return;

  const ph = wp.placeHolder || {};
  const gapX = Math.max(0, ph.x || 0);
  const gapY = Math.max(0, ph.y || 0);
  const itemW = entry.w;
  const itemH = entry.h;

  // Start position relative to TileView top-left
  const startX = entry.x - box.x;
  const startY = entry.y - box.y;

  const cellW = itemW + gapX;
  const cellH = itemH + gapY;
  const cols = Math.max(1, Math.floor((box.w - startX + gapX) / cellW));

  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const tx = startX + col * cellW;
    const ty = startY + row * cellH;
    if (ty + itemH > box.h + 2) break;

    const tile = document.createElement('div');
    tile.className = 'tile-grid-item';
    tile.style.cssText = `position:absolute;left:${tx}px;top:${ty}px;width:${itemW}px;height:${itemH}px;border:1px dashed ${entry.borderColor || box.borderColor || '#888'};background:${entry.bgColor || 'rgba(255,255,255,0.04)'};opacity:0.45;pointer-events:none;box-sizing:border-box;border-radius:2px;`;
    el.appendChild(tile);
  }
}

/* ───── Dynamic Widget Props (config-driven) ───── */
function renderWidgetProps(box) {
  const def = box.widgetType ? getWidgetDef(box.widgetType) : null;
  if (!def || !def.props || !def.props.length) return;

  if (!box.widgetProps) box.widgetProps = {};
  // Initialize defaults for any missing keys
  def.props.forEach(p => {
    if (box.widgetProps[p.key] === undefined) {
      box.widgetProps[p.key] = p.default !== undefined ? p.default : (p.type === 'checkbox' ? false : p.type === 'number' ? 0 : '');
    }
  });

  const section = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'prop-section-title';
  title.textContent = `${def.label_zh || def.label} 属性`;
  section.appendChild(title);

  def.props.forEach(prop => {
    const uid = `wp-${box.id}-${prop.key}`;
    const row = document.createElement('div');
    const val = box.widgetProps[prop.key];

    if (prop.type === 'vector2d') {
      row.className = 'prop-row';
      row.style.gap = '4px';
      const v = val || {x:0, y:0};
      row.innerHTML = `<label style="width:64px;flex-shrink:0">${prop.label}</label><span style="font-size:11px;color:#888">X</span><input type="number" id="${uid}-x" value="${v.x||0}" step="${prop.step||1}" min="${prop.min||0}" style="width:52px"/><span style="font-size:11px;color:#888">Y</span><input type="number" id="${uid}-y" value="${v.y||0}" step="${prop.step||1}" min="${prop.min||0}" style="width:52px"/>`;
    } else if (prop.type === 'textarea') {
      row.className = 'prop-row';
      row.style.alignItems = 'flex-start';
      row.innerHTML = `<label style="padding-top:3px">${prop.label}</label><textarea id="${uid}" rows="3" style="flex:1;background:var(--bg-dark);color:var(--text);border:1px solid var(--border);border-radius:4px;font-size:12px;padding:3px 5px;resize:vertical">${val||''}</textarea>`;
    } else if (prop.type === 'checkbox' || prop.type === 'boolean') {
      row.className = 'prop-row';
      row.innerHTML = `<label>${prop.label}</label><input type="checkbox" id="${uid}" ${val?'checked':''} style="width:16px;height:16px;cursor:pointer"/>`;
    } else if (prop.type === 'range') {
      row.className = 'prop-row';
      row.style.flexWrap = 'wrap';
      const mn = prop.min !== undefined ? prop.min : 0;
      const mx = prop.max !== undefined ? prop.max : 1;
      const st = prop.step !== undefined ? prop.step : 0.01;
      row.innerHTML = `<label>${prop.label}</label><input type="range" id="${uid}" value="${val!==undefined?val:mn}" min="${mn}" max="${mx}" step="${st}" style="flex:1"/><span id="${uid}-disp" style="font-size:11px;color:#aaa;min-width:36px;text-align:right;">${val!==undefined?+val.toFixed(3):mn}</span>`;
    } else if (prop.type === 'select') {
      row.className = 'prop-row';
      const opts = (prop.options||[]).map(o=>`<option value="${o}" ${val===o?'selected':''}>${o}</option>`).join('');
      row.innerHTML = `<label>${prop.label}</label><select id="${uid}" style="flex:1;background:var(--bg-dark);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:2px 4px;font-size:12px">${opts}</select>`;
    } else if (prop.type === 'color') {
      row.className = 'color-row';
      row.innerHTML = `<label>${prop.label}</label><input type="color" id="${uid}" value="${val||prop.default||'#ffffff'}"/>`;
    } else {
      row.className = 'prop-row';
      const isNum = prop.type === 'number';
      const extra = isNum ? `min="${prop.min!==undefined?prop.min:''}" max="${prop.max!==undefined?prop.max:''}" step="${prop.step||1}"` : '';
      row.innerHTML = `<label>${prop.label}</label><input type="${isNum?'number':'text'}" id="${uid}" value="${val!==undefined?val:''}" ${extra} style="flex:1"/>`;
    }
    section.appendChild(row);
  });

  propPanel.appendChild(section);

  // Bind events
  def.props.forEach(prop => {
    const uid = `wp-${box.id}-${prop.key}`;
    if (prop.type === 'vector2d') {
      const ex = document.getElementById(`${uid}-x`);
      const ey = document.getElementById(`${uid}-y`);
      if (!box.widgetProps[prop.key]) box.widgetProps[prop.key] = {x:0,y:0};
      const update = () => {
        box.widgetProps[prop.key].x = +ex.value||0;
        box.widgetProps[prop.key].y = +ey.value||0;
        renderAll(); autoSave();
      };
      if (ex) ex.addEventListener('input', update);
      if (ey) ey.addEventListener('input', update);
    } else {
      const el = document.getElementById(uid);
      if (!el) return;
      const evType = (prop.type === 'checkbox' || prop.type === 'boolean') ? 'change' : 'input';
      el.addEventListener(evType, () => {
        let v;
        if (prop.type === 'checkbox' || prop.type === 'boolean') v = el.checked;
        else if (prop.type === 'number' || prop.type === 'range') {
          v = parseFloat(el.value);
          if (prop.min !== undefined) v = Math.max(prop.min, v);
          if (prop.max !== undefined) v = Math.min(prop.max, v);
          // Update range display
          const disp = document.getElementById(`${uid}-disp`);
          if (disp) disp.textContent = +v.toFixed(3);
        } else {
          v = el.value;
        }
        if (!box.widgetProps) box.widgetProps = {};
        box.widgetProps[prop.key] = v;
        renderAll();
        autoSave();
      });
    }
  });

  // Special: TileView/ListView/TreeView — EntryClass size controls
  if (ENTRY_CLASS_TYPES.includes(def.type)) {
    const entry = boxes.find(b => b.parentId === box.id && b.label === 'EntryClass');
    if (entry) {
      const sec2 = document.createElement('div');
      const t2 = document.createElement('div');
      t2.className = 'prop-section-title';
      t2.textContent = 'EntryClass 尺寸';
      sec2.appendChild(t2);
      const wRow = document.createElement('div');
      wRow.className = 'prop-row';
      wRow.innerHTML = `<label>宽度</label><input type="number" id="ec-sz-w" value="${entry.w}" min="10" step="1" style="flex:1"/>`;
      const hRow = document.createElement('div');
      hRow.className = 'prop-row';
      hRow.innerHTML = `<label>高度</label><input type="number" id="ec-sz-h" value="${entry.h}" min="10" step="1" style="flex:1"/>`;
      sec2.appendChild(wRow);
      sec2.appendChild(hRow);
      propPanel.appendChild(sec2);
      const ecw = document.getElementById('ec-sz-w');
      const ech = document.getElementById('ec-sz-h');
      // Helper: get all descendants of a box
      function _ecAllDesc(pid) {
        const ch = boxes.filter(b => b.parentId === pid);
        return ch.reduce((a, c) => a.concat(c, _ecAllDesc(c.id)), []);
      }
      if (ecw) ecw.addEventListener('input', () => {
        const newW = Math.max(10, +ecw.value || 10);
        const scX = newW / entry.w;
        _ecAllDesc(entry.id).forEach(c => {
          c.x = entry.x + (c.x - entry.x) * scX;
          c.w = Math.max(4, c.w * scX);
        });
        entry.w = newW;
        renderAll(); autoSave();
      });
      if (ech) ech.addEventListener('input', () => {
        const newH = Math.max(10, +ech.value || 10);
        const scY = newH / entry.h;
        _ecAllDesc(entry.id).forEach(c => {
          c.y = entry.y + (c.y - entry.y) * scY;
          c.h = Math.max(4, c.h * scY);
        });
        entry.h = newH;
        renderAll(); autoSave();
      });
    }
  }
}

/* ───── Box Context Menu ───── */
let _boxCtxMenu = null;
const GROUP_ORDER = ['文本', '按钮', '输入', '图像', '列表', '反馈', '工具', '容器', '特殊'];
const GROUP_ICONS = { '文本':'🔤','按钮':'🔘','输入':'⌨','图像':'🖼','列表':'📋','反馈':'📊','工具':'🔧','容器':'📦','特殊':'🔩' };

function showBoxCtxMenu(x, y, box) {
  if (_boxCtxMenu) { _boxCtxMenu.remove(); _boxCtxMenu = null; }

  // Group widgets by category
  const groups = {};
  ALL_WIDGET_TYPES.forEach(w => {
    const g = WIDGET_GROUPS[w.type] || '特殊';
    if (!groups[g]) groups[g] = [];
    groups[g].push(w);
  });

  const menu = document.createElement('div');
  menu.className = 'bctx-menu';
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:99999`;

  GROUP_ORDER.forEach(cat => {
    const items = groups[cat];
    if (!items || !items.length) return;

    const row = document.createElement('div');
    row.className = 'bctx-item has-sub';
    const icon = GROUP_ICONS[cat] || '◆';
    row.innerHTML = `<span class="bctx-cat-icon">${icon}</span><span class="bctx-cat-name">${cat}</span><span class="bctx-arrow">▶</span>`;

    const sub = document.createElement('div');
    sub.className = 'bctx-submenu';

    items.forEach(w => {
      const si = document.createElement('div');
      si.className = 'bctx-sub-item' + (box.widgetType === w.type ? ' active' : '');
      si.innerHTML = `<span class="bctx-dot" style="background:${w.color}"></span><span class="bctx-sub-label">${w.icon} ${w.label}</span><small class="bctx-sub-zh">${w.label_zh}</small>`;
      si.title = w.desc || w.label_zh;
      si.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
      });
      si.addEventListener('click', e => {
        e.stopPropagation();
        saveState();
        box.widgetType = w.type;
        box.borderColor = w.color;
        box.bgColor = w.bg;
        box.widgetProps = initWidgetProps(w);
        ensureTileViewEntry(box);
        renderAll();
        menu.remove(); _boxCtxMenu = null;
        log(`设为 <${w.label}>: ${box.label}`, 'ok');
      });
      sub.appendChild(si);
    });

    row.appendChild(sub);
    menu.appendChild(row);
  });

  // Divider
  const div1 = document.createElement('div');
  div1.className = 'bctx-divider';
  menu.appendChild(div1);

  // Bring to front (among siblings)
  const bringFront = document.createElement('div');
  bringFront.className = 'bctx-item';
  bringFront.innerHTML = '<span class="bctx-cat-icon">⬆</span><span>设为最表层</span>';
  bringFront.addEventListener('click', () => {
    saveState();
    const parentId = box.parentId;
    boxes = boxes.filter(b => b.id !== box.id);
    // Insert after the last sibling
    let insertIdx = boxes.length;
    for (let i = boxes.length - 1; i >= 0; i--) {
      if (boxes[i].parentId === parentId) { insertIdx = i + 1; break; }
    }
    boxes.splice(insertIdx, 0, box);
    renderAll(); autoSave();
    menu.remove(); _boxCtxMenu = null;
    log(`${box.label} 已置为最表层`, 'ok');
  });
  menu.appendChild(bringFront);

  // Reset sibling order (sort by creation id)
  const resetOrder = document.createElement('div');
  resetOrder.className = 'bctx-item';
  resetOrder.innerHTML = '<span class="bctx-cat-icon">↕</span><span>重置同层顺序</span>';
  resetOrder.addEventListener('click', () => {
    saveState();
    const parentId = box.parentId;
    const siblings = boxes.filter(b => b.parentId === parentId).sort((a, b) => a.id - b.id);
    const sibSet = new Set(siblings.map(b => b.id));
    const positions = [];
    boxes.forEach((b, i) => { if (sibSet.has(b.id)) positions.push(i); });
    positions.forEach((pos, i) => { boxes[pos] = siblings[i]; });
    renderAll(); autoSave();
    menu.remove(); _boxCtxMenu = null;
    log('同层节点顺序已重置', 'dim');
  });
  menu.appendChild(resetOrder);

  // Divider2
  const div2 = document.createElement('div');
  div2.className = 'bctx-divider';
  menu.appendChild(div2);

  // isEntryClass box(root entryclass in canvas): show "编辑 EntryClass" to open its session
  if (box.isEntryClass) {
    const div3 = document.createElement('div');
    div3.className = 'bctx-divider';
    menu.appendChild(div3);

    const ecOpenEdit = document.createElement('div');
    ecOpenEdit.className = 'bctx-item';
    ecOpenEdit.innerHTML = '<span class="bctx-cat-icon">✏️</span><span>编辑 EntryClass（打开 Session）</span>';
    ecOpenEdit.addEventListener('click', async () => {
      menu.remove(); _boxCtxMenu = null;
      // 1. 优先用已记录的 session 路径
      let sessionPath = box.entryClassSessionPath || box.entryClassRef || null;
      // 2. Fallback：用 label 构造标准路径
      if (!sessionPath && box.label) {
        const safeName = box.label.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
        sessionPath = `sessions/entryclass/${safeName}.session`;
      }
      if (sessionPath && window.loadSessionFile) {
        await window.loadSessionFile(sessionPath);
      } else {
        showToast('⚠ 未找到关联 Session，请重新保存为 EntryClass');
        log('entryclass session 路径未记录，请重新保存', 'err');
      }
    });
    menu.appendChild(ecOpenEdit);
  }

  // EntryClass binding (for EntryClass boxes)
  if (box.label === 'EntryClass') {
    // 编辑EntryClass: 打开独立模态编辑器 (仅针对 TileView 内的锁定 EntryClass)
    if (isLockedEntryClass(box)) {
      const ecEdit = document.createElement('div');
      ecEdit.className = 'bctx-item';
      ecEdit.innerHTML = `<span class="bctx-cat-icon">✏️</span><span>编辑 EntryClass（加载到画布）</span>`;
      ecEdit.addEventListener('click', async () => {
        menu.remove(); _boxCtxMenu = null;
        const container = boxes.find(b => b.id === box.parentId);
        if (!container) return;
        // Extract EntryClass subtree and load into main canvas
        await openEntryClassInCanvas(container, box);
      });
      menu.appendChild(ecEdit);

      // Open EntryClass in new tab
      const ecTabEdit = document.createElement('div');
      ecTabEdit.className = 'bctx-item';
      ecTabEdit.innerHTML = '<span class="bctx-cat-icon">🔗</span><span>在新标签页编辑 EntryClass</span>';
      ecTabEdit.addEventListener('click', async () => {
        menu.remove(); _boxCtxMenu = null;
        const container = boxes.find(b => b.id === box.parentId);
        if (container) await openEntryClassInNewTab(container, box);
      });
      menu.appendChild(ecTabEdit);

      const ecDiv = document.createElement('div');
      ecDiv.className = 'bctx-divider';
      menu.appendChild(ecDiv);
    }

    const ecItem = document.createElement('div');
    ecItem.className = 'bctx-item';
    ecItem.innerHTML = `<span class="bctx-cat-icon">🔗</span><span>选择EntryClass模板${box.entryClassRef ? ' ✓' : ''}</span>`;
    ecItem.addEventListener('click', async () => {
      menu.remove(); _boxCtxMenu = null;
      await showEntryClassPicker(box, x, y);
    });
    menu.appendChild(ecItem);

    if (box.entryClassRef) {
      const ecClear = document.createElement('div');
      ecClear.className = 'bctx-item';
      ecClear.innerHTML = '<span class="bctx-cat-icon">⊗</span><span>清除EntryClass</span>';
      ecClear.addEventListener('click', () => {
        saveState();
        delete box.entryClassRef;
        renderAll(); autoSave();
        menu.remove(); _boxCtxMenu = null;
        log('EntryClass 已清除', 'dim');
      });
      menu.appendChild(ecClear);
    }
  }

  // Clear type
  const clr = document.createElement('div');
  clr.className = 'bctx-item';
  clr.innerHTML = '<span class="bctx-cat-icon">⊘</span><span>清除类型</span>';
  clr.addEventListener('click', () => {
    saveState();
    box.widgetType = null;
    box.borderColor = '#7c6af7';
    box.bgColor = 'rgba(124,106,247,0.06)';
    renderAll();
    menu.remove(); _boxCtxMenu = null;
    log('已清除控件类型', 'dim');
  });
  menu.appendChild(clr);

  // TileView/ListView/TreeView: "编辑 EntryClass" shortcut
  if (ENTRY_CLASS_TYPES.includes(box.widgetType)) {
    const ecEditDiv = document.createElement('div');
    ecEditDiv.className = 'bctx-divider';
    menu.appendChild(ecEditDiv);
    const ecEditBtn = document.createElement('div');
    ecEditBtn.className = 'bctx-item';
    ecEditBtn.innerHTML = '<span class="bctx-cat-icon">✏️</span><span>编辑 EntryClass</span>';
    ecEditBtn.addEventListener('click', () => {
      menu.remove(); _boxCtxMenu = null;
      showEntryClassEditor(box);
    });
    menu.appendChild(ecEditBtn);
  }

  // Rename
  const ren = document.createElement('div');
  ren.className = 'bctx-item';
  ren.innerHTML = '<span class="bctx-cat-icon">✏</span><span>重命名</span>';
  ren.addEventListener('click', () => {
    menu.remove(); _boxCtxMenu = null;
    // Inline rename on the label element
    const el = document.getElementById(`box-${box.id}`);
    const lbl = el ? el.querySelector('.box-label') : null;
    if (!lbl) return;
    const inp = document.createElement('input');
    inp.value = box.label;
    inp.style.cssText = 'width:100%;background:rgba(0,0,0,0.75);color:#fff;border:1px solid var(--accent);border-radius:3px;font-size:inherit;padding:1px 4px;outline:none;box-sizing:border-box;';
    lbl.textContent = '';
    lbl.appendChild(inp);
    inp.focus();
    inp.select();
    const commit = () => {
      const v = inp.value.trim();
      if (v && v !== box.label) { saveState(); box.label = v; log(`重命名 → ${v}`, 'ok'); }
      renderAll(); // always re-render to restore "name (type)" display
    };
    inp.addEventListener('keydown', e2 => {
      if (e2.key === 'Enter')  { e2.preventDefault(); inp.blur(); }
      if (e2.key === 'Escape') { inp.value = box.label; inp.blur(); }
      e2.stopPropagation();
    });
    inp.addEventListener('blur', commit, { once: true });
  });
  menu.appendChild(ren);

  // Description
  const descItem = document.createElement('div');
  descItem.className = 'bctx-item';
  const descHasIcon = box.description ? '💬' : '📝';
  descItem.innerHTML = `<span class="bctx-cat-icon">${descHasIcon}</span><span>${box.description ? '编辑描述' : '添加描述'}</span>`;
  descItem.addEventListener('click', () => {
    menu.remove(); _boxCtxMenu = null;
    showDescriptionModal(box);
  });
  menu.appendChild(descItem);

  // Save as EntryClass
  const ecDiv = document.createElement('div');
  ecDiv.className = 'bctx-divider';
  menu.appendChild(ecDiv);

  const ecItem = document.createElement('div');
  ecItem.className = 'bctx-item';
  ecItem.innerHTML = '<span class="bctx-cat-icon">📐</span><span>设置为 EntryClass</span>';
  ecItem.addEventListener('click', () => {
    menu.remove(); _boxCtxMenu = null;
    showSaveEntryClassModal(box);
  });
  menu.appendChild(ecItem);

  // Load EntryClass template (apply to this box)
  const ecLoadItem = document.createElement('div');
  ecLoadItem.className = 'bctx-item';
  ecLoadItem.innerHTML = '<span class="bctx-cat-icon">🗂</span><span>加载 EntryClass 模板</span>';
  ecLoadItem.addEventListener('click', async () => {
    menu.remove(); _boxCtxMenu = null;
    await showEntryClassPicker(box, x, y);
  });
  menu.appendChild(ecLoadItem);

  // ── Layer order divider ──
  const divOrder = document.createElement('div');
  divOrder.className = 'bctx-divider';
  menu.appendChild(divOrder);

  // Bring to absolute front (last in boxes array → renders on top)
  const mkOrderItem = (icon, label, handler) => {
    const it = document.createElement('div');
    it.className = 'bctx-item';
    it.innerHTML = `<span class="bctx-cat-icon">${icon}</span><span>${label}</span>`;
    it.addEventListener('click', () => { saveState(); menu.remove(); _boxCtxMenu = null; handler(); syncZOrder(); renderAll(); autoSave(); });
    return it;
  };

  menu.appendChild(mkOrderItem('⬆⬆', '设置为最表层', () => {
    // Move box to very end of boxes array (renders on top of all)
    const idx = boxes.findIndex(b => b.id === box.id);
    if (idx !== -1 && idx !== boxes.length - 1) {
      boxes.splice(idx, 1);
      boxes.push(box);
      log(`${box.label} → 最表层`, 'ok');
    }
  }));

  menu.appendChild(mkOrderItem('⬆', '同层置顶', () => {
    // Move box to be last among its siblings in the boxes array (renders on top of siblings)
    const pid = box.parentId;
    // Find the last index occupied by a sibling
    let lastSibIdx = -1;
    for (let i = boxes.length - 1; i >= 0; i--) {
      if (boxes[i].parentId === pid && boxes[i].id !== box.id) { lastSibIdx = i; break; }
    }
    const curIdx = boxes.findIndex(b => b.id === box.id);
    if (curIdx !== -1 && lastSibIdx > curIdx) {
      boxes.splice(curIdx, 1);
      // After removal, lastSibIdx shifts by -1
      boxes.splice(lastSibIdx, 0, box);
    } else if (curIdx !== -1 && lastSibIdx === -1) {
      // No other siblings, bring to absolute front
      boxes.splice(curIdx, 1);
      boxes.push(box);
    }
    log(`${box.label} → 同层置顶`, 'ok');
  }));

  menu.appendChild(mkOrderItem('↺', '重置同层节点顺序', () => {
    // Sort siblings in-place by creation id, keeping their slots in the global array
    const pid = box.parentId;
    const siblingIndices = [];
    const sortedSiblings = [];
    boxes.forEach((b, i) => { if (b.parentId === pid) { siblingIndices.push(i); sortedSiblings.push(b); } });
    sortedSiblings.sort((a, b) => a.id - b.id);
    siblingIndices.forEach((pos, i) => { boxes[pos] = sortedSiblings[i]; });
    log('已重置同层节点顺序', 'ok');
  }));

  // Delete
  const del = document.createElement('div');
  del.className = 'bctx-item danger';
  del.innerHTML = '<span class="bctx-cat-icon">🗑</span><span>删除</span>';
  del.addEventListener('click', () => {
    try {
      saveState();
      const toDelete = new Set(collectDescendants(box.id));
      toDelete.forEach(id => document.getElementById(`box-${id}`)?.remove());
      boxes = boxes.filter(b => !toDelete.has(b.id));
      if (toDelete.has(selectedId)) selectedId = null;
      renderAll();
      menu.remove(); _boxCtxMenu = null;
      log('删除 ' + box.label + (toDelete.size > 1 ? ' 及 ' + (toDelete.size - 1) + ' 个子节点' : ''), 'warn');
    } catch(err) {
      log('删除失败: ' + err.message, 'error');
      console.error('[删除]', err);
    }
  });
  menu.appendChild(del);

  document.body.appendChild(menu);
  _boxCtxMenu = menu;

  // Flip if off-screen
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth)  menu.style.left = (x - r.width) + 'px';
    if (r.bottom > window.innerHeight) menu.style.top = (y - r.height) + 'px';
    // Mark submenus that need to open left
    menu.querySelectorAll('.bctx-item.has-sub').forEach(row => {
      row.addEventListener('mouseenter', () => {
        const sub = row.querySelector('.bctx-submenu');
        if (!sub) return;
        const sr = sub.getBoundingClientRect();
        if (sr.right > window.innerWidth) sub.classList.add('flip-left');
        else sub.classList.remove('flip-left');
      });
    });
  });

  const dismiss = e => {
    if (_boxCtxMenu && !_boxCtxMenu.contains(e.target)) {
      _boxCtxMenu.remove(); _boxCtxMenu = null;
      document.removeEventListener('mousedown', dismiss);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}


// Reorder DOM elements inside boxLayer to match boxes array (last = highest z-order)
function syncZOrder() {
  boxes.forEach(b => {
    const el = document.getElementById(`box-${b.id}`);
    if (el) boxLayer.appendChild(el); // appendChild moves existing node to end
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
  // Left sidebar layer list
  if (layerList) {
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

  // Right panel hierarchy list — tree view
  if (hierarchyList) {
    hierarchyList.innerHTML = '';
    if (!boxes.length) {
      const li = document.createElement('li');
      li.style.color = 'var(--text-dim)';
      li.style.cursor = 'default';
      li.textContent = '暂无节点';
      hierarchyList.appendChild(li);
      return;
    }

    // Build parent→children map
    const childrenOf = {};
    boxes.forEach(b => {
      const pid = b.parentId || '__root__';
      if (!childrenOf[pid]) childrenOf[pid] = [];
      childrenOf[pid].push(b);
    });

    function appendNodes(parentKey, depth) {
      const children = childrenOf[parentKey] || [];
      // Render in reverse order (top of stack first)
      [...children].reverse().forEach(box => {
        const def = getWidgetDef(box.widgetType);
        const icon = def ? def.icon : '⬜';
        const typeLabel = def ? `<${def.label}>` : '';
        const hasChildren = !!(childrenOf[box.id] && childrenOf[box.id].length);
        const li = document.createElement('li');
        li.dataset.id = box.id;
        li.style.paddingLeft = `${12 + depth * 14}px`;
        if (box.id === selectedId) li.classList.add('selected');
        li.innerHTML = `<span style="color:var(--text-dim);margin-right:2px;font-size:10px">${hasChildren ? '▾' : '·'}</span><span style="color:${def ? def.color : 'var(--text-dim)'}">${icon}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:4px">${box.label}</span>${typeLabel ? `<span style="font-size:10px;opacity:0.4">${typeLabel}</span>` : ''}`;
        li.addEventListener('click', () => {
          // EntryClass selects itself; children of EntryClass redirect to EntryClass
          const lockedEc = getLockedEntryClassAncestor(box);
          const target = lockedEc ? lockedEc : box;
          selectBox(target.id);
          renderAll();
          const propsTab = document.querySelector('.right-tab[data-tab="props"]');
          if (propsTab) propsTab.click();
        });
        hierarchyList.appendChild(li);
        appendNodes(box.id, depth + 1);
      });
    }
    appendNodes('__root__', 0);
  }
}

function renderProps() {
  if (!selectedId) {
    propPanel.innerHTML = '<div class="empty-hint">未选中任何元素</div>';
    return;
  }
  const box = boxes.find(b => b.id === selectedId);
  if (!box) { propPanel.innerHTML = '<div class="empty-hint">未选中任何元素</div>'; return; }

  // Locked EntryClass: show only position/size (scale editing only)
  if (isLockedEntryClass(box)) {
    propPanel.innerHTML = `
      <div class="prop-section-title">EntryClass — 整体尺寸</div>
      <div style="font-size:11px;color:var(--text-dim);padding:4px 10px 6px">仅允许调整位置与尺寸，内部控件不可单独编辑</div>
      <div class="prop-row"><label>X</label><input type="number" id="p-x" value="${box.x}" /></div>
      <div class="prop-row"><label>Y</label><input type="number" id="p-y" value="${box.y}" /></div>
      <div class="prop-row"><label>W</label><input type="number" id="p-w" value="${box.w}" /></div>
      <div class="prop-row"><label>H</label><input type="number" id="p-h" value="${box.h}" /></div>
    `;
    // Helper to collect all descendants of a box
    function collectAllDesc(parentId) {
      return boxes.filter(b => b.parentId === parentId).reduce((acc, c) => {
        return acc.concat({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h }, collectAllDesc(c.id));
      }, []);
    }

    // Snapshot for proportional scaling via props inputs
    let ecSnap = null;
    function captureEcSnap() {
      ecSnap = { x: box.x, y: box.y, w: box.w, h: box.h, children: collectAllDesc(box.id) };
    }
    function applyEcScale() {
      if (!ecSnap || ecSnap.w === 0 || ecSnap.h === 0) return;
      const scaleX = box.w / ecSnap.w;
      const scaleY = box.h / ecSnap.h;
      ecSnap.children.forEach(orig => {
        const child = boxes.find(b => b.id === orig.id);
        if (!child) return;
        child.x = box.x + Math.round((orig.x - ecSnap.x) * scaleX);
        child.y = box.y + Math.round((orig.y - ecSnap.y) * scaleY);
        child.w = Math.max(Math.round(orig.w * scaleX), 10);
        child.h = Math.max(Math.round(orig.h * scaleY), 10);
      });
      // Sync parent widgetProps
      const parent = boxes.find(b => b.id === box.parentId);
      if (parent) {
        if (!parent.widgetProps) parent.widgetProps = {};
        parent.widgetProps.entryWidth  = box.w;
        parent.widgetProps.entryHeight = box.h;
      }
    }

    const bindEc = (id, prop, parse) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('focus', captureEcSnap);
      el.addEventListener('blur', () => { ecSnap = null; });
      el.addEventListener('input', () => {
        saveState();
        box[prop] = parse ? parse(el.value) : el.value;
        if (prop === 'w' || prop === 'h') applyEcScale();
        renderAll();
        autoSave();
      });
    };
    bindEc('p-x', 'x', v => snap(+v));
    bindEc('p-y', 'y', v => snap(+v));
    bindEc('p-w', 'w', v => Math.max(snap(+v), 20));
    bindEc('p-h', 'h', v => Math.max(snap(+v), 20));
    return;
  }

  propPanel.innerHTML = `
    <div class="prop-section-title">控件类型</div>
    <div class="prop-row">
      <label>类型</label>
      <select id="p-widget" style="flex:1;background:var(--bg-dark);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:2px 4px;font-size:12px">
        <option value="">— 无 —</option>
        ${ALL_WIDGET_TYPES.map(w => `<option value="${w.type}" ${box.widgetType === w.type ? 'selected' : ''}>${w.icon} &lt;${w.label}&gt;</option>`).join('')}
      </select>
    </div>
    <div class="prop-section-title">描述</div>
    <div class="prop-row">
      <textarea id="p-desc" rows="2" placeholder="描述这个控件的用途..." style="flex:1;resize:vertical;background:var(--bg-dark);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:4px 6px;font-size:12px;font-family:inherit;min-height:36px"></textarea>
    </div>
    <div class="prop-section-title">位置 & 尺寸</div>
    <div class="prop-row"><label>X</label><input type="number" id="p-x" value="${box.x}" /></div>
    <div class="prop-row"><label>Y</label><input type="number" id="p-y" value="${box.y}" /></div>
    <div class="prop-row"><label>W</label><input type="number" id="p-w" value="${box.w}" /></div>
    <div class="prop-row"><label>H</label><input type="number" id="p-h" value="${box.h}" /></div>
    <div class="prop-section-title">锚点 (Anchor)</div>
    <div id="anchor-picker-wrap">${buildAnchorPickerHTML(box.anchor || {minX:0,minY:0,maxX:0,maxY:0})}</div>
    <div class="prop-row" style="gap:4px">
      <label style="width:60px;flex-shrink:0">最小</label>
      <span style="font-size:11px;color:#888">X</span>
      <input type="number" id="p-anc-minx" step="0.01" min="0" max="1" value="${(box.anchor||{}).minX||0}" style="width:52px"/>
      <span style="font-size:11px;color:#888">Y</span>
      <input type="number" id="p-anc-miny" step="0.01" min="0" max="1" value="${(box.anchor||{}).minY||0}" style="width:52px"/>
    </div>
    <div class="prop-row" style="gap:4px">
      <label style="width:60px;flex-shrink:0">最大</label>
      <span style="font-size:11px;color:#888">X</span>
      <input type="number" id="p-anc-maxx" step="0.01" min="0" max="1" value="${(box.anchor||{}).maxX||0}" style="width:52px"/>
      <span style="font-size:11px;color:#888">Y</span>
      <input type="number" id="p-anc-maxy" step="0.01" min="0" max="1" value="${(box.anchor||{}).maxY||0}" style="width:52px"/>
    </div>
    <div class="prop-section-title">样式</div>
    <div class="prop-row"><label>名称</label><span style="flex:1;color:var(--text);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:0.8" title="${box.label}">${box.label}</span><span style="font-size:10px;color:var(--text-dim);flex-shrink:0;cursor:pointer" onclick="(()=>{const b=boxes.find(x=>x.id===selectedId);if(b){const el=document.getElementById('box-'+b.id);const lbl=el&&el.querySelector('.box-label');if(!lbl)return;const inp=document.createElement('input');inp.value=b.label;inp.style.cssText='width:100%;background:rgba(0,0,0,0.75);color:#fff;border:1px solid var(--accent);border-radius:3px;font-size:inherit;padding:1px 4px;outline:none;box-sizing:border-box;';lbl.textContent='';lbl.appendChild(inp);inp.focus();inp.select();const commit=()=>{const v=inp.value.trim();if(v&&v!==b.label){saveState();b.label=v;log('重命名 → '+v,'ok');}renderAll();};inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();inp.blur();}if(e.key==='Escape'){inp.value=b.label;inp.blur();}e.stopPropagation();});inp.addEventListener('blur',commit,{once:true});}})()">✏</span></div>
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
  bind('p-bw', 'borderWidth', v => Math.max(+v, 1));
  bind('p-bc', 'borderColor');
  bind('p-op', 'opacity', parseFloat);

  // Description textarea — set value safely via JS (avoids HTML injection issues)
  const descEl = document.getElementById('p-desc');
  if (descEl) {
    descEl.value = box.description || '';
    descEl.addEventListener('input', () => {
      box.description = descEl.value || undefined;
      if (!box.description) delete box.description;
      // Update label tooltip on canvas
      const boxEl = document.getElementById('box-' + box.id);
      const lbl = boxEl && boxEl.querySelector('.box-label');
      if (lbl) {
        if (box.description) lbl.title = '📝 ' + box.description;
        else lbl.removeAttribute('title');
      }
    });
    descEl.addEventListener('change', () => { saveState(); renderAll(); });
  }

  // Widget type change
  const widgetSel = document.getElementById('p-widget');
  if (widgetSel) {
    widgetSel.addEventListener('change', () => {
      saveState();
      const t = widgetSel.value || null;
      const def = t ? getWidgetDef(t) : null;
      box.widgetType = t;
      if (def) { box.borderColor = def.color; box.bgColor = def.bg; }
      else { box.borderColor = '#7c6af7'; box.bgColor = 'rgba(124,106,247,0.06)'; }
      // Reinitialize widgetProps for new type
      box.widgetProps = initWidgetProps(def);
      ensureTileViewEntry(box);
      renderAll();
    });
  }

  // Anchor binding
  if (!box.anchor) box.anchor = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const bindAnc = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      box.anchor[key] = Math.min(1, Math.max(0, parseFloat(el.value) || 0));
      refreshAnchorPicker(box.anchor);
      renderAll();
    });
  };
  bindAnc('p-anc-minx', 'minX'); bindAnc('p-anc-miny', 'minY');
  bindAnc('p-anc-maxx', 'maxX'); bindAnc('p-anc-maxy', 'maxY');

  // Anchor picker click
  document.querySelectorAll('.anc-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const a = JSON.parse(cell.dataset.anchor);
      box.anchor = a;
      document.getElementById('p-anc-minx').value = a.minX;
      document.getElementById('p-anc-miny').value = a.minY;
      document.getElementById('p-anc-maxx').value = a.maxX;
      document.getElementById('p-anc-maxy').value = a.maxY;
      refreshAnchorPicker(a);
      renderAll();
    });
  });

  // Dynamic widget-specific properties from elements.json
  renderWidgetProps(box);
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
  const box = boxes.find(b => b.id === id);

  // Locked EntryClass (inside TileView etc.): allow selection only, no independent drag
  if (box && isLockedEntryClass(box)) {
    selectBox(id);
    renderAll();
    return; // no drag — resize handles are the only way to adjust size
  }

  // Child boxes inside a locked EntryClass: redirect click to the EntryClass
  if (box) {
    const lockedEc = getLockedEntryClassAncestor(box);
    if (lockedEc) {
      selectBox(lockedEc.id); renderAll();
      return;
    }
  }

  // Child boxes inside an isEntryClass box: redirect click to the isEntryClass box
  if (box) {
    const ecAncestor = getIsEntryClassAncestor(box);
    if (ecAncestor) {
      selectBox(ecAncestor.id); renderAll();
      return;
    }
  }

  selectBox(id);
  renderAll();

  // Locked EntryClass: allow selection but prevent dragging
  if (isLockedEntryClass(box)) return;

  const rect = canvasRoot.getBoundingClientRect();

  // Collect all recursive descendants so they move with the parent
  function getDescendants(parentId) {
    const children = boxes.filter(b => b.parentId === parentId);
    return children.reduce((acc, c) => acc.concat(c, getDescendants(c.id)), []);
  }
  const descendants = getDescendants(id);

  dragState = {
    type: 'move',
    id,
    startX: e.clientX,
    startY: e.clientY,
    origX: box.x,
    origY: box.y,
    origChildren: descendants.map(c => ({ id: c.id, x: c.x, y: c.y }))
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

  // Descendants of a locked EntryClass are locked (but the EntryClass itself can be resized)
  if (getLockedEntryClassAncestor(box)) return;
  // Descendants of an isEntryClass box are locked too
  if (getIsEntryClassAncestor(box)) return;

  saveState();

  // Capture initial EntryClass state (and its children) for proportional scaling
  let origEntry = null;
  if (ENTRY_CLASS_TYPES.includes(box.widgetType)) {
    const entry = boxes.find(b => b.parentId === box.id && b.label === 'EntryClass');
    if (entry) {
      // Recursively collect all descendants of the EntryClass
      function collectDesc(parentId) {
        return boxes.filter(b => b.parentId === parentId).reduce((acc, c) => {
          return acc.concat({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h }, collectDesc(c.id));
        }, []);
      }
      origEntry = {
        x: entry.x, y: entry.y, w: entry.w, h: entry.h,
        children: collectDesc(entry.id)
      };
    }
  }

  // If box IS an EntryClass, capture its children for proportional scaling
  let origEcChildren = null;
  if (isLockedEntryClass(box)) {
    function collectEcDesc(parentId) {
      return boxes.filter(b => b.parentId === parentId).reduce((acc, c) => {
        return acc.concat({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h }, collectEcDesc(c.id));
      }, []);
    }
    origEcChildren = collectEcDesc(box.id);
  }

  dragState = {
    type: 'resize',
    id, dir,
    startX: e.clientX,
    startY: e.clientY,
    origX: box.x, origY: box.y,
    origW: box.w, origH: box.h,
    origEntry,
    origEcChildren, origEcX: box.x, origEcY: box.y, origEcW: box.w, origEcH: box.h
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

  // In draw mode: clicking near a box's BORDER (within 8px) selects it instead of drawing.
  // Clicking in the interior still draws a new child box.
  const BORDER_HIT = 8;
  const hit = [...boxes].reverse().find(b => {
    if (pos.x < b.x - BORDER_HIT || pos.x > b.x + b.w + BORDER_HIT) return false;
    if (pos.y < b.y - BORDER_HIT || pos.y > b.y + b.h + BORDER_HIT) return false;
    const nearLeft   = pos.x <= b.x + BORDER_HIT;
    const nearRight  = pos.x >= b.x + b.w - BORDER_HIT;
    const nearTop    = pos.y <= b.y + BORDER_HIT;  // also covers label area
    const nearBottom = pos.y >= b.y + b.h - BORDER_HIT;
    return nearLeft || nearRight || nearTop || nearBottom;
  });
  if (hit) {
    setMode('select');
    selectBox(hit.id);
    renderAll();
    return;
  }

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
      // Move all descendants by the same delta
      if (dragState.origChildren) {
        dragState.origChildren.forEach(orig => {
          const child = boxes.find(b => b.id === orig.id);
          if (child) {
            child.x = snap(orig.x + dx);
            child.y = snap(orig.y + dy);
          }
        });
      }
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
      // Auto-scale EntryClass (and its children) when its TileView parent is resized
      if (ENTRY_CLASS_TYPES.includes(box.widgetType) && dragState.origEntry) {
        const entry = boxes.find(b => b.parentId === box.id && b.label === 'EntryClass');
        if (entry) {
          const oe = dragState.origEntry;
          const scaleX = box.w / dragState.origW;
          const scaleY = box.h / dragState.origH;
          entry.w = Math.max(Math.round(oe.w * scaleX), 20);
          entry.h = Math.max(Math.round(oe.h * scaleY), 20);
          entry.x = box.x + Math.round((oe.x - dragState.origX) * scaleX);
          entry.y = box.y + Math.round((oe.y - dragState.origY) * scaleY);
          // Sync parent widgetProps entryWidth/entryHeight
          if (!box.widgetProps) box.widgetProps = {};
          box.widgetProps.entryWidth  = entry.w;
          box.widgetProps.entryHeight = entry.h;
          // Scale all descendant boxes inside the EntryClass proportionally
          (oe.children || []).forEach(orig => {
            const child = boxes.find(b => b.id === orig.id);
            if (!child) return;
            child.w = Math.max(Math.round(orig.w * scaleX), 10);
            child.h = Math.max(Math.round(orig.h * scaleY), 10);
            child.x = entry.x + Math.round((orig.x - oe.x) * scaleX);
            child.y = entry.y + Math.round((orig.y - oe.y) * scaleY);
          });
        }
      }
      // When the EntryClass box itself is resized, sync parent's widgetProps.entryWidth/entryHeight
      // and scale all children proportionally
      if (isLockedEntryClass(box)) {
        const parent = boxes.find(b => b.id === box.parentId);
        if (parent) {
          if (!parent.widgetProps) parent.widgetProps = {};
          parent.widgetProps.entryWidth  = box.w;
          parent.widgetProps.entryHeight = box.h;
        }
        // Scale children of EntryClass proportionally
        if (dragState.origEcChildren && dragState.origEcW > 0 && dragState.origEcH > 0) {
          const scaleX = box.w / dragState.origEcW;
          const scaleY = box.h / dragState.origEcH;
          dragState.origEcChildren.forEach(orig => {
            const child = boxes.find(b => b.id === orig.id);
            if (!child) return;
            child.x = box.x + Math.round((orig.x - dragState.origEcX) * scaleX);
            child.y = box.y + Math.round((orig.y - dragState.origEcY) * scaleY);
            child.w = Math.max(Math.round(orig.w * scaleX), 10);
            child.h = Math.max(Math.round(orig.h * scaleY), 10);
          });
        }
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
      const box = createBox(x, y, w, h, null, currentWidgetType);
      boxes.push(box);
      recomputeAllParents(); // update parentId for new box AND existing children
      ensureTileViewEntry(box);
      selectBox(box.id);
      renderAll();
      const typeLabel = currentWidgetType ? `<${currentWidgetType}>` : 'Box';
      log(`绘制 ${typeLabel} ${box.label}  (${Math.round(x)}, ${Math.round(y)})  ${Math.round(box.w)}×${Math.round(box.h)}`, 'ok');
      autoSave(); // persist hierarchy immediately after drawing
      // Auto-switch to select mode so the new box can be dragged immediately
      setMode('select');
    }
  }

  if (dragState) {
    const box = boxes.find(b => b.id === dragState.id);
    if (box) {
      if (dragState.type === 'move') {
        recomputeAllParents(); // update parent for moved box AND any boxes now inside it
        log(`移动 ${box.label} → (${box.x}, ${box.y})`, 'dim');
      } else {
        recomputeAllParents(); // resize can also change containment
        log(`调整 ${box.label} → ${box.w}×${box.h}`, 'dim');
      }
      autoSave();
    }
    dragState = null;
  }
});

/* ───── Keyboard ───── */
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
  if (e.key === 'Escape') { deselectAll(); renderAll(); }
  if (e.key === 'v' || e.key === 'V') {
    currentWidgetType = null;
    document.querySelectorAll('.palette-item').forEach(b => b.classList.remove('active'));
    setMode('select');
  }
  if (e.key === 'b' || e.key === 'B') setMode('draw');
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Z')) { e.preventDefault(); redo(); }

  // Arrow keys to nudge
  if (selectedId && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
    e.preventDefault();
    const d = e.shiftKey ? 10 : 1;
    const box = boxes.find(b => b.id === selectedId);
    if (!box) return;
    if (isLockedEntryClass(box)) return; // locked EntryClass: selection only, no nudge
    if (getLockedEntryClassAncestor(box)) return; // children of EntryClass: no arrow movement
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
  // Clear widget palette selection when manually entering select mode without a type
  if (m === 'select' && !currentWidgetType) {
    document.querySelectorAll('.palette-item').forEach(b => b.classList.remove('active'));
  }
  log(`切换模式: ${m === 'select' ? '选择' : '绘制'}`, 'info');
}

btnSelect.addEventListener('click', () => setMode('select'));
btnDraw.addEventListener('click',   () => setMode('draw'));

/* ───── EntryClass Template Loader ───── */
async function applyEntryClassTemplate(targetBox, templatePath) {
  try {
    const res = await fetch('/docs/api/get?name=' + encodeURIComponent(templatePath));
    const data = await res.json();
    if (!data.success) { showToast('⚠ 无法读取模板：' + (data.error || '')); return; }
    const parsed = JSON.parse(data.content);
    if (!Array.isArray(parsed.boxes) || !parsed.boxes.length) { showToast('⚠ 空模板'); return; }

    // Support both flat (v1.0) and nested-tree (v1.1+) formats
    const flatBoxes = (parsed.version && parsed.version !== '1.0')
      ? deserializeBoxes(parsed.boxes)
      : parsed.boxes;

    // Root = box with no parentId (or first box)
    const rootTpl = flatBoxes.find(b => !b.parentId) || flatBoxes[0];
    const scaleX = targetBox.w / Math.max(rootTpl.w, 1);
    const scaleY = targetBox.h / Math.max(rootTpl.h, 1);

    // Remove existing children of targetBox
    const existingChildIds = new Set(collectDescendants(targetBox.id));
    existingChildIds.delete(targetBox.id);
    existingChildIds.forEach(id => document.getElementById(`box-${id}`)?.remove());
    boxes = boxes.filter(b => !existingChildIds.has(b.id));

    // If targetBox is a locked EntryClass (parent is TileView/ListView/TreeView),
    // also purge stale sibling boxes under the TileView parent that are not targetBox.
    if (isLockedEntryClass(targetBox)) {
      const tileParent = boxes.find(b => b.id === targetBox.parentId);
      if (tileParent) {
        const staleIds = new Set(
          boxes
            .filter(b => b.parentId === tileParent.id && b.id !== targetBox.id)
            .flatMap(b => collectDescendants(b.id))
        );
        staleIds.forEach(id => document.getElementById(`box-${id}`)?.remove());
        boxes = boxes.filter(b => !staleIds.has(b.id));
      }
    }

    // Build ID map (old template id → new id)
    const idMap = {};
    flatBoxes.forEach(b => {
      idMap[b.id] = (b.id === rootTpl.id) ? targetBox.id : nextId++;
    });

    // Import non-root boxes as children of targetBox
    const newBoxes = flatBoxes
      .filter(b => b.id !== rootTpl.id)
      .map(b => ({
        ...b,
        id: idMap[b.id],
        x: Math.round(targetBox.x + b.x * scaleX),
        y: Math.round(targetBox.y + b.y * scaleY),
        w: Math.max(20, Math.round(b.w * scaleX)),
        h: Math.max(20, Math.round(b.h * scaleY)),
        parentId: idMap[b.parentId] ?? targetBox.id,
        anchor: b.anchor || { minX: 0, minY: 0, maxX: 0, maxY: 0 }
      }));

    boxes.push(...newBoxes);
    recomputeAllParents();
    saveState();
    renderAll();
    const tplName = templatePath.split('/').pop().replace(/\.session$/, '');
    log(`📐 EntryClass 模板已应用：${tplName} (${newBoxes.length} 个节点, 缩放 ${scaleX.toFixed(2)}×${scaleY.toFixed(2)})`, 'ok');
    showToast(`📐 已应用 EntryClass「${tplName}」`);
  } catch (e) {
    showToast('⚠ 加载失败：' + e.message);
  }
}

/* ───── Description Modal ───── */
function showDescriptionModal(box) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:200000;display:flex;align-items:center;justify-content:center';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:#1a1a2e;border:1px solid #3a3a5c;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.7);width:420px;max-width:95vw;padding:0;display:flex;flex-direction:column;overflow:hidden';

  const header = document.createElement('div');
  header.style.cssText = 'padding:12px 16px;border-bottom:1px solid #3a3a5c;display:flex;align-items:center;justify-content:space-between';
  header.innerHTML = `<span style="font-weight:600;font-size:14px;color:#ccc">📝 描述 — <em style="color:var(--accent);font-style:normal">${box.label}</em></span>`;
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;color:#888;font-size:16px;cursor:pointer;padding:0 4px';
  closeBtn.onclick = () => overlay.remove();
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const body = document.createElement('div');
  body.style.cssText = 'padding:16px;display:flex;flex-direction:column;gap:10px';

  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:11px;color:var(--text-dim);margin-bottom:2px';
  hint.textContent = '描述这个控件的用途，方便团队协作和后续维护。';
  body.appendChild(hint);

  const textarea = document.createElement('textarea');
  textarea.value = box.description || '';
  textarea.placeholder = '例如：显示背包物品格子，点击后触发物品详情弹窗...';
  textarea.style.cssText = 'width:100%;min-height:100px;resize:vertical;background:#0d0d1a;color:#e0e0e0;border:1px solid #3a3a5c;border-radius:6px;padding:8px;font-size:13px;line-height:1.5;outline:none;box-sizing:border-box;font-family:inherit';
  textarea.addEventListener('keydown', e => { if (e.key === 'Escape') overlay.remove(); e.stopPropagation(); });
  body.appendChild(textarea);

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;padding:4px 0 0';

  if (box.description) {
    const clearBtn = document.createElement('button');
    clearBtn.textContent = '🗑 清除';
    clearBtn.style.cssText = 'padding:6px 14px;border-radius:6px;border:1px solid #5a3a3a;background:#2a1a1a;color:#ff8888;cursor:pointer;font-size:13px';
    clearBtn.onclick = () => { saveState(); delete box.description; renderAll(); autoSave(); overlay.remove(); showToast('描述已清除'); };
    actions.appendChild(clearBtn);
  }

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '取消';
  cancelBtn.style.cssText = 'padding:6px 14px;border-radius:6px;border:1px solid #3a3a5c;background:#222;color:#ccc;cursor:pointer;font-size:13px';
  cancelBtn.onclick = () => overlay.remove();
  actions.appendChild(cancelBtn);

  const saveBtn = document.createElement('button');
  saveBtn.textContent = '✅ 保存';
  saveBtn.style.cssText = 'padding:6px 14px;border-radius:6px;border:none;background:var(--accent);color:#000;cursor:pointer;font-size:13px;font-weight:600';
  saveBtn.onclick = () => {
    const v = textarea.value.trim();
    saveState();
    if (v) { box.description = v; showToast('📝 描述已保存'); }
    else { delete box.description; showToast('描述已清除'); }
    renderAll(); autoSave(); overlay.remove();
  };
  actions.appendChild(saveBtn);
  body.appendChild(actions);

  modal.appendChild(body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  setTimeout(() => textarea.focus(), 60);
}

/* ───── Save EntryClass Modal (preview before saving) ───── */
function showSaveEntryClassModal(box) {
  // Collect subtree to preview
  const ids = new Set(collectDescendants(box.id));
  const subset = boxes.filter(b => ids.has(b.id));
  const ox = box.x, oy = box.y;
  const previewBoxes = subset.map(b => ({ ...b, x: b.x - ox, y: b.y - oy }));

  // Overlay
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:200000;display:flex;align-items:center;justify-content:center';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:#1a1a2e;border:1px solid #3a3a5c;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.7);width:580px;max-width:95vw;display:flex;flex-direction:column;overflow:hidden';

  // Header
  const header = document.createElement('div');
  header.style.cssText = 'padding:12px 16px;border-bottom:1px solid #3a3a5c;display:flex;align-items:center;justify-content:space-between;flex-shrink:0';
  header.innerHTML = '<span style="font-weight:600;font-size:14px;color:#ccc">📐 设置为 EntryClass 模板</span>';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;color:#888;cursor:pointer;font-size:16px;padding:2px 6px;border-radius:3px';
  closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = '#fff'; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = '#888'; });
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // Name input row
  const nameRow = document.createElement('div');
  nameRow.style.cssText = 'padding:12px 16px 8px;display:flex;align-items:center;gap:10px;flex-shrink:0;border-bottom:1px solid #2a2a3c';
  const nameLabel = document.createElement('label');
  nameLabel.textContent = '存档名称：';
  nameLabel.style.cssText = 'font-size:12px;color:#999;white-space:nowrap';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = box.label || 'entryclass';
  nameInput.style.cssText = 'flex:1;background:#0d0f1a;border:1px solid #3a3a5c;border-radius:5px;padding:5px 10px;color:#e0e0e0;font-size:13px;outline:none';
  nameInput.addEventListener('focus', () => { nameInput.style.borderColor = '#7c6af7'; });
  nameInput.addEventListener('blur', () => { nameInput.style.borderColor = '#3a3a5c'; });
  nameRow.appendChild(nameLabel);
  nameRow.appendChild(nameInput);
  modal.appendChild(nameRow);

  // Preview area
  const previewWrap = document.createElement('div');
  previewWrap.style.cssText = 'flex:1;overflow:hidden;background:#12121f;position:relative;height:280px';

  const previewHint = document.createElement('div');
  previewHint.style.cssText = 'position:absolute;top:6px;left:10px;font-size:10px;color:#555;pointer-events:none;z-index:1';
  previewHint.textContent = `预览 — ${subset.length} 个节点`;
  previewWrap.appendChild(previewHint);

  // Render boxes into preview
  function renderSavePreview() {
    previewWrap.querySelectorAll('.ec-prev-box').forEach(e => e.remove());
    if (!previewBoxes.length) return;
    const minX = Math.min(...previewBoxes.map(b => b.x));
    const minY = Math.min(...previewBoxes.map(b => b.y));
    const maxX = Math.max(...previewBoxes.map(b => b.x + b.w));
    const maxY = Math.max(...previewBoxes.map(b => b.y + b.h));
    const natW = maxX - minX || 1;
    const natH = maxY - minY || 1;
    const pw = previewWrap.clientWidth || 520;
    const ph = previewWrap.clientHeight || 280;
    const pad = 20;
    const scale = Math.min((pw - pad * 2) / natW, (ph - pad * 2) / natH, 2);
    const offX = pad + (pw - pad * 2 - natW * scale) / 2 - minX * scale;
    const offY = pad + (ph - pad * 2 - natH * scale) / 2 - minY * scale;
    previewBoxes.forEach(b => {
      const el = document.createElement('div');
      el.className = 'ec-prev-box';
      const bc = b.borderColor || '#7c6af7';
      const bg = b.bgColor || 'rgba(124,106,247,0.06)';
      el.style.cssText = `position:absolute;
        left:${Math.round(offX + b.x * scale)}px;
        top:${Math.round(offY + b.y * scale)}px;
        width:${Math.max(2, Math.round(b.w * scale))}px;
        height:${Math.max(2, Math.round(b.h * scale))}px;
        border:${Math.max(1, Math.round((b.borderWidth || 2) * scale * 0.3))}px solid ${bc};
        background:${bg};
        box-sizing:border-box;overflow:hidden`;
      if (b.w * scale > 30 && b.h * scale > 14) {
        const lbl = document.createElement('div');
        lbl.style.cssText = `font-size:${Math.max(8, Math.min(11, Math.round(10 * scale)))}px;color:${bc};padding:1px 3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0.85`;
        lbl.textContent = b.label ? `${b.label} (${b.widgetType || 'Canvas'})` : '';
        el.appendChild(lbl);
      }
      previewWrap.appendChild(el);
    });
  }
  modal.appendChild(previewWrap);
  requestAnimationFrame(renderSavePreview);

  // Footer
  const footer = document.createElement('div');
  footer.style.cssText = 'padding:10px 16px;border-top:1px solid #3a3a5c;display:flex;justify-content:flex-end;gap:8px;flex-shrink:0';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '取消';
  cancelBtn.style.cssText = 'padding:6px 16px;border:1px solid #444;background:transparent;color:#aaa;border-radius:5px;cursor:pointer;font-size:12px';
  cancelBtn.addEventListener('click', () => overlay.remove());
  const saveBtn = document.createElement('button');
  saveBtn.textContent = '💾 保存为 EntryClass';
  saveBtn.style.cssText = 'padding:6px 16px;border:none;background:#7c6af7;color:#fff;border-radius:5px;cursor:pointer;font-size:12px';
  saveBtn.addEventListener('click', async () => {
    const safeName = nameInput.value.trim();
    if (!safeName) { nameInput.focus(); return; }
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    saveState();
    boxes.forEach(b => { b.isEntryClass = false; });
    box.isEntryClass = true;
    renderAll();
    autoSave();
    const content = JSON.stringify({ version: '1.1', boxes: serializeBoxes(previewBoxes), nextId: 1, savedAt: new Date().toISOString(), entryClassLabel: safeName, isEntryClass: true }, null, 2);
    try {
      const filePath = 'sessions/entryclass/' + safeName + '.session';
      const res = await fetch('/docs/api/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: filePath, content })
      });
      const data = await res.json();
      overlay.remove();
      if (data.success) {
        // Store the session path on the box so right-click "编辑" can open it
        box.entryClassSessionPath = filePath;
        autoSave();
        if (typeof _globalLoadTree === 'function') _globalLoadTree();
        log(`📐 EntryClass 已保存：sessions/entryclass/${safeName}.session`, 'ok');
        showToast(`📐 EntryClass 「${safeName}」已保存`);
      } else showToast('⚠ 保存失败：' + (data.error || ''));
    } catch (e) { overlay.remove(); showToast('⚠ 网络错误：' + e.message); }
  });
  footer.appendChild(cancelBtn);
  footer.appendChild(saveBtn);
  modal.appendChild(footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  // Focus name input and select all
  requestAnimationFrame(() => { nameInput.focus(); nameInput.select(); });
  nameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveBtn.click();
    if (e.key === 'Escape') overlay.remove();
  });
}

async function showEntryClassPicker(targetBox, anchorX, anchorY) {
  // Fetch tree and find sessions/entryclass items
  let templates = [];
  try {
    const res = await fetch('/docs/api/tree');
    const data = await res.json();
    if (data.success) {
      const findEntryClasses = (items) => {
        for (const item of items || []) {
          if (item.type === 'folder' && item.name === 'sessions') {
            for (const sub of item.children || []) {
              if (sub.type === 'folder' && sub.name === 'entryclass') {
                for (const f of sub.children || []) {
                  if (f.type === 'file' && f.name.endsWith('.session')) {
                    templates.push({ name: f.name.replace(/\.session$/, ''), path: f.path });
                  }
                }
              }
            }
          }
          if (item.children) findEntryClasses(item.children);
        }
      };
      findEntryClasses(data.tree);
    }
  } catch (err) { log('⚠ 获取模板列表失败：' + err.message, 'warn'); }

  if (!templates.length) { log('⚠ sessions/entryclass/ 下暂无模板', 'warn'); return; }

  // ── Modal overlay ──
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:200000;display:flex;align-items:center;justify-content:center';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:#1a1a2e;border:1px solid #3a3a5c;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,0.7);width:640px;max-width:95vw;height:420px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden';

  // Header
  const header = document.createElement('div');
  header.style.cssText = 'padding:12px 16px;border-bottom:1px solid #3a3a5c;display:flex;align-items:center;justify-content:space-between;flex-shrink:0';
  header.innerHTML = '<span style="font-weight:600;font-size:14px;color:#ccc">📐 选择 EntryClass 模板</span>';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;color:#888;cursor:pointer;font-size:16px;padding:2px 6px;border-radius:3px';
  closeBtn.addEventListener('mouseenter', () => closeBtn.style.color = '#fff');
  closeBtn.addEventListener('mouseleave', () => closeBtn.style.color = '#888');
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(closeBtn);
  modal.appendChild(header);

  // Body: left list + right preview
  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex:1;overflow:hidden';

  // Left: template list
  const listPane = document.createElement('div');
  listPane.style.cssText = 'width:180px;flex-shrink:0;border-right:1px solid #3a3a5c;overflow-y:auto;padding:6px 0';

  // Right: preview area
  const previewPane = document.createElement('div');
  previewPane.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden';

  const previewLabel = document.createElement('div');
  previewLabel.style.cssText = 'padding:8px 14px;font-size:11px;color:#888;border-bottom:1px solid #2a2a3c;flex-shrink:0';
  previewLabel.textContent = '预览';

  const previewCanvas = document.createElement('div');
  previewCanvas.style.cssText = 'flex:1;position:relative;overflow:hidden;background:#12121f';

  previewPane.appendChild(previewLabel);
  previewPane.appendChild(previewCanvas);

  // Footer with apply button
  const footer = document.createElement('div');
  footer.style.cssText = 'padding:10px 16px;border-top:1px solid #3a3a5c;display:flex;justify-content:flex-end;gap:8px;flex-shrink:0';
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '取消';
  cancelBtn.style.cssText = 'padding:6px 16px;border:1px solid #444;background:transparent;color:#aaa;border-radius:5px;cursor:pointer;font-size:12px';
  cancelBtn.addEventListener('click', () => overlay.remove());
  const applyBtn = document.createElement('button');
  applyBtn.textContent = '应用';
  applyBtn.disabled = true;
  applyBtn.style.cssText = 'padding:6px 16px;border:none;background:#7c6af7;color:#fff;border-radius:5px;cursor:pointer;font-size:12px;opacity:0.5';
  footer.appendChild(cancelBtn);
  footer.appendChild(applyBtn);

  body.appendChild(listPane);
  body.appendChild(previewPane);
  modal.appendChild(body);
  modal.appendChild(footer);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // Render preview of a template
  let selectedPath = null;
  const _tplCache = {};
  async function renderPreview(tpl) {
    previewLabel.textContent = '预览 — ' + tpl.name;
    if (!_tplCache[tpl.path]) {
      previewCanvas.innerHTML = '<div style="color:#555;font-size:12px;padding:16px">加载中…</div>';
      try {
        const r = await fetch('/docs/api/get?name=' + encodeURIComponent(tpl.path));
        const d = await r.json();
        if (d.success) {
          const parsed = JSON.parse(d.content);
          // Handle both flat (v1.0) and nested-tree (v1.1+) formats
          const rawBoxes = parsed.boxes || [];
          _tplCache[tpl.path] = (parsed.version && parsed.version !== '1.0')
            ? deserializeBoxes(rawBoxes)
            : rawBoxes;
        } else { _tplCache[tpl.path] = null; }
      } catch (e) { _tplCache[tpl.path] = null; }
    }
    const tplBoxes = _tplCache[tpl.path];
    if (!tplBoxes) { previewCanvas.innerHTML = '<div style="color:#f66;font-size:12px;padding:16px">⚠ 无法读取模板</div>'; return; }
    if (!tplBoxes.length) { previewCanvas.innerHTML = '<div style="color:#888;font-size:12px;padding:16px">空模板</div>'; return; }

    // Compute bounding box
    const minX = Math.min(...tplBoxes.map(b => b.x));
    const minY = Math.min(...tplBoxes.map(b => b.y));
    const maxX = Math.max(...tplBoxes.map(b => b.x + b.w));
    const maxY = Math.max(...tplBoxes.map(b => b.y + b.h));
    const natW = maxX - minX || 1;
    const natH = maxY - minY || 1;

    // Use getBoundingClientRect for accurate dimensions after layout
    const rect = previewCanvas.getBoundingClientRect();
    const pw = rect.width || previewCanvas.clientWidth || 400;
    const ph = rect.height || previewCanvas.clientHeight || 260;
    const pad = 16;
    const scale = Math.min((pw - pad * 2) / natW, (ph - pad * 2) / natH);
    const offX = pad + (pw - pad * 2 - natW * scale) / 2 - minX * scale;
    const offY = pad + (ph - pad * 2 - natH * scale) / 2 - minY * scale;

    previewCanvas.innerHTML = '';
    tplBoxes.forEach(b => {
      const el = document.createElement('div');
      const bc = b.borderColor || '#7c6af7';
      const bg = b.bgColor || 'rgba(124,106,247,0.06)';
      el.style.cssText = `
        position:absolute;
        left:${Math.round(offX + b.x * scale)}px;
        top:${Math.round(offY + b.y * scale)}px;
        width:${Math.max(2, Math.round(b.w * scale))}px;
        height:${Math.max(2, Math.round(b.h * scale))}px;
        border:${Math.max(1, Math.round((b.borderWidth||2) * scale * 0.3))}px solid ${bc};
        background:${bg};
        opacity:${b.opacity || 1};
        box-sizing:border-box;
        overflow:hidden;
      `;
      if (b.w * scale > 30 && b.h * scale > 14) {
        const lbl = document.createElement('div');
        lbl.style.cssText = `font-size:${Math.max(8, Math.min(11, Math.round(10 * scale)))}px;color:${bc};padding:1px 3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0.85`;
        lbl.textContent = b.label || '';
        el.appendChild(lbl);
      }
      previewCanvas.appendChild(el);
    });
  }

  // Populate list
  templates.forEach(tpl => {
    const row = document.createElement('div');
    row.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:12px;color:#bbb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-left:2px solid transparent;transition:background 0.1s';
    row.title = tpl.name;
    row.textContent = '📐 ' + tpl.name;
    row.addEventListener('mouseenter', () => {
      if (selectedPath !== tpl.path) row.style.background = 'rgba(124,106,247,0.12)';
      renderPreview(tpl);  // preview on hover
    });
    row.addEventListener('mouseleave', () => {
      if (selectedPath !== tpl.path) row.style.background = '';
    });
    row.addEventListener('click', () => {
      listPane.querySelectorAll('div').forEach(r => {
        r.style.background = '';
        r.style.color = '#bbb';
        r.style.borderLeftColor = 'transparent';
      });
      row.style.background = 'rgba(124,106,247,0.3)';
      row.style.color = '#fff';
      row.style.borderLeftColor = '#7c6af7';
      selectedPath = tpl.path;
      applyBtn.disabled = false;
      applyBtn.style.opacity = '1';
      renderPreview(tpl);
    });
    listPane.appendChild(row);
  });

  applyBtn.addEventListener('click', () => {
    if (!selectedPath) return;
    overlay.remove();
    applyEntryClassTemplate(targetBox, selectedPath);
  });

  // Double-click list to apply immediately
  listPane.addEventListener('dblclick', () => {
    if (selectedPath) { overlay.remove(); applyEntryClassTemplate(targetBox, selectedPath); }
  });

  // Auto-select first after layout settles
  requestAnimationFrame(() => {
    const firstRow = listPane.querySelector('div');
    if (firstRow) firstRow.click();
  });
}

/* ───── Delete / Clear ───── */
function collectDescendants(id) {
  const ids = [id];
  const seen = new Set([id]);
  let i = 0;
  while (i < ids.length) {
    const cur = ids[i++];
    boxes.forEach(b => {
      if (b.parentId === cur && !seen.has(b.id)) {
        seen.add(b.id);
        ids.push(b.id);
      }
    });
  }
  return ids;
}

function deleteSelected() {
  if (!selectedId) {
    log('⚠ 请先选中一个节点再删除', 'warn');
    return;
  }
  const box = boxes.find(b => b.id === selectedId);
  if (!box) { selectedId = null; return; }
  try {
    saveState();
    const toDelete = new Set(collectDescendants(selectedId));
    toDelete.forEach(id => document.getElementById(`box-${id}`)?.remove());
    boxes = boxes.filter(b => !toDelete.has(b.id));
    deselectAll();
    renderAll();
    autoSave();
    log('删除 ' + box.label + (toDelete.size > 1 ? ' 及 ' + (toDelete.size - 1) + ' 个子节点' : ''), 'warn');
  } catch(err) {
    log('删除失败: ' + err.message, 'error');
    console.error('[deleteSelected]', err);
  }
}

btnDelete.addEventListener('click', () => { setMode('select'); deleteSelected(); });
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

// Zoom and scroll to fit all boxes in the viewport
function zoomToFit(padding = 40) {
  if (!boxes.length) { setZoom(1); return; }
  const minX = Math.min(...boxes.map(b => b.x));
  const minY = Math.min(...boxes.map(b => b.y));
  const maxX = Math.max(...boxes.map(b => b.x + b.w));
  const maxY = Math.max(...boxes.map(b => b.y + b.h));
  const contentW = maxX - minX;
  const contentH = maxY - minY;
  const vpW = canvasViewport.offsetWidth  - padding * 2;
  const vpH = canvasViewport.offsetHeight - padding * 2;
  const scaleX = vpW / contentW;
  const scaleY = vpH / contentH;
  setZoom(Math.min(scaleX, scaleY, 2)); // cap at 2× to avoid over-zoom
  // Scroll to content origin
  canvasViewport.scrollLeft = (minX * zoom) - padding;
  canvasViewport.scrollTop  = (minY * zoom) - padding;
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

/* ───── Widget Palette Init ───── */
function buildPalette(containerId, items) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  items.forEach(def => {
    const btn = document.createElement('div');
    btn.className = 'palette-item';
    btn.dataset.type = def.type;
    btn.dataset.group = def.category || WIDGET_GROUPS[def.type] || '工具';
    btn.style.setProperty('--widget-color', def.color);
    btn.innerHTML = `<span class="pi-dot" style="background:${def.color}"></span>${def.icon} <code style="font-size:11px">&lt;${def.label}&gt;</code>`;
    btn.title = `<${def.label}> — 点击后绘制区域设为此控件`;
    btn.addEventListener('click', () => {
      const isActive = currentWidgetType === def.type;
      // Deactivate all
      document.querySelectorAll('.palette-item').forEach(b => b.classList.remove('active'));
      currentWidgetType = isActive ? null : def.type;
      if (currentWidgetType) {
        btn.classList.add('active');
        // If something is selected, change its type immediately
        if (selectedId) {
          const box = boxes.find(b => b.id === selectedId);
          if (box) {
            saveState();
            box.widgetType = def.type;
            box.borderColor = def.color;
            box.bgColor = def.bg;
            renderAll();
            log(`设为 <${def.label}>: ${box.label}`, 'ok');
          }
        } else {
          // Auto-enter draw mode
          setMode('draw');
          log(`控件: <${def.label}> — 拖拽画布绘制区域`, 'info');
        }
      } else {
        log('控件类型已取消', 'dim');
      }
    });
    wrap.appendChild(btn);
  });
}

function applyPaletteFilter(group) {
  const showAll = !group || group === 'all';

  document.querySelectorAll('.palette-item').forEach(btn => {
    const match = showAll || btn.dataset.group === group;
    btn.style.display = match ? '' : 'none';
  });

  // Hide section labels/dividers when filtering to a single group
  const labelControls   = document.getElementById('palette-label-controls');
  const labelContainers = document.getElementById('palette-label-containers');
  const divControls     = document.getElementById('palette-div-controls');
  const divContainers   = document.getElementById('palette-div-containers');

  const hasControls   = showAll || group !== '容器';
  const hasContainers = showAll || group === '容器';
  if (labelControls)   labelControls.style.display   = hasControls   ? '' : 'none';
  if (divControls)     divControls.style.display      = hasControls   ? '' : 'none';
  if (labelContainers) labelContainers.style.display  = hasContainers ? '' : 'none';
  if (divContainers)   divContainers.style.display    = hasContainers ? '' : 'none';
}
/* ───── Session Persistence ───── */
let _sessionPath = 'sessions/default.session';
let _sessionName = 'default';
let _saveTimer = null;
let _ecEditMode = false; // true while openEntryClassInCanvas is active — blocks autoSave
let _lastNonEmptySnapshot = null; // JSON string of last non-empty save — used for backup

function setActiveSession(name, filePath) {
  _sessionName = name;
  _sessionPath = filePath || ('sessions/' + name + '.session');
  const lbl = document.getElementById('session-label');
  if (lbl) { lbl.textContent = '📂 ' + name; lbl.title = 'Session: ' + _sessionPath; }
}

/* ───── Hierarchical Serialization ───── */
function serializeBoxes(flatBoxes) {
  // Convert flat array with parentId → nested tree
  const map = {};
  flatBoxes.forEach(b => {
    const { parentId, ...rest } = b;   // drop parentId — it's implicit in nesting
    map[b.id] = { ...rest, children: [] };
  });
  const roots = [];
  flatBoxes.forEach(b => {
    if (b.parentId != null && map[b.parentId]) {
      map[b.parentId].children.push(map[b.id]);
    } else {
      roots.push(map[b.id]);
    }
  });
  // Remove empty children arrays to keep JSON clean
  function clean(node) {
    if (!node.children || !node.children.length) { delete node.children; }
    else { node.children.forEach(clean); }
    return node;
  }
  return roots.map(clean);
}

function deserializeBoxes(nodes, parentId = null, out = []) {
  // Convert nested tree → flat array with parentId
  (nodes || []).forEach(n => {
    const { children, ...box } = n;
    box.parentId = parentId;
    if (!box.anchor) box.anchor = { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    out.push(box);
    if (children && children.length) deserializeBoxes(children, box.id, out);
  });
  return out;
}

function sessionData() {
  return { version: '1.1', savedAt: new Date().toISOString(), nextId, boxes: serializeBoxes(boxes) };
}

function autoSave() {
  if (_ecEditMode) return; // don't overwrite parent session while editing an EntryClass
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    try {
      const data = sessionData();
      const json = JSON.stringify(data, null, 2);
      // Before saving an empty session, backup the last known non-empty state
      if (data.boxes.length === 0 && _lastNonEmptySnapshot) {
        const backupPath = _sessionPath.replace(/\.session$/, '') + '_backup.session';
        await fetch('/docs/api/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: backupPath, content: _lastNonEmptySnapshot })
        }).catch(() => {});
        log('⚠️ 画布已清空，已自动备份到 ' + backupPath.split('/').pop(), 'warn');
      }
      if (data.boxes.length > 0) _lastNonEmptySnapshot = json;
      await fetch('/docs/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: _sessionPath, content: json })
      });
      const ind = document.getElementById('save-indicator');
      if (ind) { ind.textContent = '✓ 已保存'; ind.style.opacity = '1'; setTimeout(() => ind.style.opacity = '0', 1500); }
    } catch (_) {}
  }, 1500);
}

async function loadSession() {
  try {
    const res = await fetch('/docs/api/get?name=' + encodeURIComponent(_sessionPath));
    const json = await res.json();
    if (!json.success || !json.content) return false;
    const d = JSON.parse(json.content);
    if (d.nextId) nextId = d.nextId;
    if (Array.isArray(d.boxes)) {
      // v1.1+: nested tree; v1.0: flat array with parentId
      if (d.version && d.version !== '1.0') {
        boxes = deserializeBoxes(d.boxes);
      } else {
        boxes = d.boxes;
        boxes.forEach(b => { if (!b.anchor) b.anchor = { minX:0, minY:0, maxX:0, maxY:0 }; });
      }
    }
    renderAll();
    log(`会话已恢复 (${boxes.length} 个节点)`, 'ok');
    setActiveSession(_sessionName, _sessionPath);
    return true;
  } catch (_) { return false; }
}

/* ───── Init ───── */
// Double-RAF ensures flexbox layout has settled before reading dimensions
requestAnimationFrame(() => requestAnimationFrame(() => drawGrid()));
setMode('draw');   // Start in draw mode
log('Canvas Editor 已启动  —  拖拽画布可绘制边框，V=选择，B=绘制，Del=删除', 'ok');
// Load widget palette from elements.json, then restore session
loadElements().then(async () => {
  const sel = document.getElementById('palette-group-select');
  if (sel) sel.addEventListener('change', () => applyPaletteFilter(sel.value));
  await loadSession();
  // Mark CanvasPanel as the active palette item (default widget type)
  const canvasBtn = document.querySelector('.palette-item[data-type="CanvasPanel"]');
  if (canvasBtn) canvasBtn.classList.add('active');
});

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

  // ESC: exit hover mode only (keep result panel visible)
  window.addEventListener('keydown', function (e) {
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      setActive(false);
      // Keep panel visible so the last picked result stays on screen
    }
  }, true);

  window.addEventListener('mouseleave', function () {
    if (!active) return;
    const ov = getOverlay(), lbl = getLabel();
    if (ov)  ov.style.display  = 'none';
    if (lbl) lbl.style.display = 'none';
  });
})();

/* ═══════════════════════════════════════════════════════
   Document System — Alice Style (with folder support)
   API: /docs/api/{list|tree|get|save|delete|mkdir}
   Docs stored in: application/canvas-editor/data/docs/
   ═══════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const API = '/docs/api';
  let allDocs    = [];   // flat list for sidebar
  let currentDoc = null; // { name, content }
  let isDirty    = false;
  let renderTimer = null;
  let modalMode   = 'doc'; // 'doc' | 'folder'
  let targetFolder = '';   // folder path prefix for new items

  /* ── DOM refs ── */
  const overlay       = document.getElementById('docs-overlay');
  const fileTree      = document.getElementById('docs-file-tree');
  const sidebarList   = document.getElementById('sidebar-doc-list');
  const searchInput   = document.getElementById('docs-search');
  const textarea      = document.getElementById('docs-textarea');
  const preview       = document.getElementById('docs-preview');
  const docTitle      = document.getElementById('docs-doc-title');
  const docArea       = document.getElementById('docs-doc-area');
  const welcome       = document.getElementById('docs-welcome');
  const modalOverlay  = document.getElementById('docs-modal-overlay');
  const modalInput    = document.getElementById('docs-modal-input');
  const modalHint     = document.getElementById('docs-modal-hint');
  const btnDocs       = document.getElementById('btn-docs');
  const btnNew        = document.getElementById('docs-btn-new');
  const btnRefresh    = document.getElementById('docs-btn-refresh');
  const btnClose      = document.getElementById('docs-btn-close');
  const btnSave       = document.getElementById('docs-btn-save');
  const btnDelete     = document.getElementById('docs-btn-delete');
  const btnWelcomeNew = document.getElementById('docs-welcome-new');
  const btnModalCancel  = document.getElementById('docs-modal-cancel');
  const btnModalConfirm = document.getElementById('docs-modal-confirm');
  const sidebarBtnNew   = document.getElementById('sidebar-doc-new');
  const modalTabs       = document.querySelectorAll('.docs-modal-tab');

  /* ── Open / Close overlay ── */
  window.toggleDocsPanel = openOverlay;

  function openOverlay() {
    overlay.classList.add('open');
    if (btnDocs) btnDocs.classList.add('active');
    loadTree();
  }
  function closeOverlay() {
    if (isDirty && !confirm('有未保存的更改，确定关闭？')) return;
    overlay.classList.remove('open');
    if (btnDocs) btnDocs.classList.remove('active');
  }

  btnClose.addEventListener('click', closeOverlay);

  /* ── Load tree ── */
  async function loadTree() {
    _globalLoadTree = loadTree; // expose for context menu
    fileTree.innerHTML = '<div class="docs-tree-empty">加载中…</div>';
    try {
      const res = await fetch(API + '/tree');
      const data = await res.json();
      if (data.success) {
        renderTree(data.tree, fileTree, searchInput.value.toLowerCase());
        renderSidebarTree(data.tree);
        // Keep allDocs flat list for compatibility
        allDocs = [];
        function flattenDocs(items) {
          items.forEach(item => {
            if (item.type === 'folder') flattenDocs(item.children || []);
            else allDocs.push({ name: item.path, updatedAt: item.updatedAt });
          });
        }
        flattenDocs(data.tree);
      }
    } catch (e) {
      fileTree.innerHTML = '<div class="docs-tree-empty">加载失败，请刷新</div>';
    }
  }

  function renderTree(items, container, q) {
    container.innerHTML = '';
    const filtered = q ? flatFilter(items, q) : items;
    if (!filtered.length) {
      const d = document.createElement('div');
      d.className = 'docs-tree-empty';
      d.textContent = q ? '无匹配文档' : '暂无内容，点击 ＋ 新建';
      container.appendChild(d);
      return;
    }
    appendItems(filtered, container, q);
  }

  // Flatten tree for search
  function flatFilter(items, q) {
    const result = [];
    function walk(list) {
      list.forEach(item => {
        if (item.type === 'folder') walk(item.children || []);
        else if (item.name.toLowerCase().includes(q)) result.push(item);
      });
    }
    walk(items);
    return result;
  }

  /* ── Session file helpers ── */
  async function loadSessionFile(filePath) {
    try {
      const res = await fetch(API + '/get?name=' + encodeURIComponent(filePath));
      const data = await res.json();
      if (!data.success) { showToast('⚠ 无法读取存档：' + (data.error || '')); return; }
      const parsed = JSON.parse(data.content);
      if (parsed.nextId) nextId = parsed.nextId;
      if (Array.isArray(parsed.boxes)) {
        if (parsed.version && parsed.version !== '1.0') {
          boxes = deserializeBoxes(parsed.boxes);
        } else {
          boxes = parsed.boxes;
          boxes.forEach(b => { if (!b.anchor) b.anchor = { minX:0, minY:0, maxX:0, maxY:0 }; });
        }
      }
      saveState();
      renderAll();
      const name = filePath.split('/').pop().replace(/\.session$/, '');
      setActiveSession(name, filePath);
      log(`🎨 已加载画布存档「${name}」(${boxes.length} 个节点)`, 'ok');
      showToast(`🎨 已加载「${name}」`);
      // Close docs overlay to show the canvas
      isDirty = false;
      overlay.classList.remove('open');
      if (btnDocs) btnDocs.classList.remove('active');
      // Always zoom-to-fit so the user can clearly see the loaded content
      if (boxes.length > 0) {
        requestAnimationFrame(() => zoomToFit());
      }
    } catch (e) {
      showToast('⚠ 加载失败：' + e.message);
    }
  }
  // Expose globally so canvas context menu can open sessions
  window.loadSessionFile = loadSessionFile;

  async function saveCanvasAsSession(folderPath) {
    const name = prompt('存档名称（不含扩展名）：', 'session-' + Date.now());
    if (!name) return;
    const filePath = (folderPath ? folderPath + '/' : 'sessions/') + name + '.session';
    const content = JSON.stringify(sessionData(), null, 2);
    try {
      const res = await fetch(API + '/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: filePath, content })
      });
      const data = await res.json();
      if (data.success) { loadTree(); showToast(`💾 已保存存档「${name}」`); }
      else showToast('⚠ 保存失败：' + (data.error || ''));
    } catch (e) {
      showToast('⚠ 网络错误：' + e.message);
    }
  }

  function appendItems(items, container, q) {
    items.forEach(item => {
      if (item.type === 'folder') {
        // Folder row
        const row = document.createElement('div');
        row.className = 'docs-tree-folder open';
        row.innerHTML = `<span class="docs-tree-chevron">▶</span><span>📁 ${esc(item.name)}</span>`;
        container.appendChild(row);

        // Children container
        const childWrap = document.createElement('div');
        childWrap.className = 'docs-tree-children';
        if (item.children && item.children.length) {
          appendItems(item.children, childWrap, q);
        } else {
          const empty = document.createElement('div');
          empty.className = 'docs-tree-empty';
          empty.style.paddingLeft = '14px';
          empty.textContent = '空文件夹';
          childWrap.appendChild(empty);
        }
        container.appendChild(childWrap);

        // Toggle
        row.addEventListener('click', () => {
          row.classList.toggle('open');
          childWrap.classList.toggle('hidden');
        });

        row.addEventListener('contextmenu', e => {
          e.preventDefault();
          showCtxMenu(e.clientX, e.clientY, [
            { label: '✏️ 重命名文件夹', action: () => {
              const newName = prompt('重命名文件夹：', item.name);
              if (!newName || newName === item.name) return;
              const parentPath = item.path.replace(/[^/]+$/, '');
              fetch(API + '/rename', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ oldName: item.path, newName: parentPath + newName })
              }).then(r => r.json()).then(data => {
                if (data.success) { loadTree(); showToast('✏️ 文件夹已重命名：' + newName); }
                else alert('重命名失败：' + (data.error || ''));
              });
            }},
            { label: '🗑 删除文件夹', action: async () => {
              if (!confirm(`确定删除文件夹「${item.name}」及其所有内容？`)) return;
              const res = await fetch(API + '/delete?name=' + encodeURIComponent(item.path), { method: 'DELETE' });
              const data = await res.json();
              if (data.success) { loadTree(); showToast('🗑 已删除文件夹：' + item.name); }
              else alert('删除失败：' + (data.error || ''));
            }}
          ]);
        });
      } else {
        // File row
        const isSession = item.name.endsWith('.session');
        const row = document.createElement('div');
        row.className = 'docs-tree-item' + (currentDoc && currentDoc.name === item.path ? ' active' : '');
        const d = new Date(item.updatedAt);
        const label = item.name;
        const icon = isSession ? '🎨' : '📄';
        row.innerHTML = `<span>${icon} ${esc(label)}</span><span class="docs-tree-meta">${d.getMonth()+1}/${d.getDate()}</span>`;

        if (isSession) {
          row.title = '单击加载到画布';
          row.addEventListener('click', () => loadSessionFile(item.path));
        } else {
          row.addEventListener('click', () => openDoc(item.path));
        }

        row.addEventListener('contextmenu', e => {
          e.preventDefault();
          const baseItems = [
            { label: '✏️ 重命名（含后缀）', action: () => {
              const newName = prompt('重命名（含后缀）：', item.name);
              if (!newName || newName === item.name) return;
              const parentPath = item.path.replace(/[^/]+$/, '');
              fetch(API + '/rename', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ oldName: item.path, newName: parentPath + newName })
              }).then(r => r.json()).then(data => {
                if (data.success) { loadTree(); showToast('✏️ 已重命名：' + newName); }
                else alert('重命名失败：' + (data.error || ''));
              });
            }},
            { label: '🗑 删除', action: async () => {
              if (!confirm(`确定删除「${item.name}」？`)) return;
              const res = await fetch(API + '/delete?name=' + encodeURIComponent(item.path), { method: 'DELETE' });
              const data = await res.json();
              if (data.success) {
                if (currentDoc && currentDoc.name === item.path) { currentDoc = null; textarea.value = ''; docTitle.textContent = '未选择'; }
                loadTree();
                showToast('🗑 已删除：' + item.name);
              } else { alert('删除失败：' + (data.error || '')); }
            }}
          ];
          if (isSession) {
            const backupPath = item.path.replace(/\.session$/, '') + '_backup.session';
            const menuItems = [{ label: '🎨 加载到画布', action: () => loadSessionFile(item.path) }, ...baseItems];
            // Check if backup exists then show restore option
            fetch(API + '/get?name=' + encodeURIComponent(backupPath))
              .then(r => r.json())
              .then(d => {
                if (d.success) menuItems.splice(1, 0, { label: '♻️ 从备份恢复', action: () => { if (confirm('将从备份还原画布，确定？')) loadSessionFile(backupPath); } });
                showCtxMenu(e.clientX, e.clientY, menuItems);
              })
              .catch(() => showCtxMenu(e.clientX, e.clientY, menuItems));
          } else {
            showCtxMenu(e.clientX, e.clientY, baseItems);
          }
        });
        container.appendChild(row);
      }
    });
  }

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase();
    if (!q) { loadTree(); return; }
    // Flatten search
    fetch(API + '/tree').then(r => r.json()).then(data => {
      if (data.success) renderTree(data.tree, fileTree, q);
    }).catch(() => {});
  });

  btnRefresh.addEventListener('click', loadTree);

  function renderSidebarTree(items) {
    if (!sidebarList) return;
    sidebarList.innerHTML = '';
    let hasContent = false;

    function walk(list, depth, container) {
      container = container || sidebarList;
      list.forEach(item => {
        hasContent = true;
        if (item.type === 'folder') {
          // Wrapper li — valid HTML: ul > li > (div header + ul children)
          const li = document.createElement('li');
          li.className = 'sidebar-doc-folder-item';
          li.dataset.path = item.path;

          const header = document.createElement('div');
          header.className = 'sidebar-doc-folder';
          header.style.paddingLeft = (10 + depth * 10) + 'px';

          const chevron = document.createElement('span');
          chevron.className = 'sb-chevron';
          chevron.style.cssText = 'display:inline-block;font-size:9px;margin-right:4px;transition:transform 0.15s;transform:rotate(90deg)';
          chevron.textContent = '▶';

          const label = document.createElement('span');
          label.style.flex = '1';
          label.textContent = '📁 ' + item.name;

          const addBtn = document.createElement('button');
          addBtn.className = 'sb-folder-add';
          addBtn.title = '在此文件夹内新建';
          addBtn.textContent = '＋';
          addBtn.addEventListener('click', e => {
            e.stopPropagation();
            targetFolder = item.path;
            openModal('doc');
          });

          header.appendChild(chevron);
          header.appendChild(label);
          header.appendChild(addBtn);
          li.appendChild(header);

          // Children ul — inside li (valid HTML!)
          const childGroup = document.createElement('ul');
          childGroup.className = 'sb-children';
          li.appendChild(childGroup);

          if (item.children && item.children.length) {
            walk(item.children, depth + 1, childGroup);
          } else {
            const empty = document.createElement('li');
            empty.className = 'sidebar-doc-empty';
            empty.style.paddingLeft = (10 + (depth + 1) * 10) + 'px';
            empty.textContent = '空文件夹';
            childGroup.appendChild(empty);
          }

          header.addEventListener('click', () => {
            const nowOpen = chevron.style.transform === 'rotate(90deg)';
            chevron.style.transform = nowOpen ? '' : 'rotate(90deg)';
            childGroup.style.display = nowOpen ? 'none' : '';
          });

          header.addEventListener('contextmenu', e => {
            e.preventDefault();
            e.stopPropagation();
            const isSessionsFolder = item.name === 'sessions';
            const menuItems = [
              { label: '✏️ 重命名文件夹', action: () => {
                const newName = prompt('重命名文件夹：', item.name);
                if (!newName || newName === item.name) return;
                const parentPath = item.path.replace(/[^/]+$/, '');
                fetch(API + '/rename', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ oldName: item.path, newName: parentPath + newName })
                }).then(r => r.json()).then(data => {
                  if (data.success) { loadTree(); showToast('✏️ 文件夹已重命名：' + newName); }
                  else alert('重命名失败：' + (data.error || ''));
                });
              }},
              { label: '🗑 删除文件夹', action: async () => {
                if (!confirm(`确定删除文件夹「${item.name}」及其所有内容？`)) return;
                const res = await fetch(API + '/delete?name=' + encodeURIComponent(item.path), { method: 'DELETE' });
                const data = await res.json();
                if (data.success) { loadTree(); showToast('🗑 已删除文件夹：' + item.name); }
                else alert('删除失败：' + (data.error || ''));
              }}
            ];
            if (isSessionsFolder) {
              menuItems.unshift({ label: '💾 保存当前画布', action: () => saveCanvasAsSession(item.path) });
            }
            showCtxMenu(e.clientX, e.clientY, menuItems);
          });

          container.appendChild(li);

        } else {
          const isSession = item.name.endsWith('.session');
          const li = document.createElement('li');
          li.style.cssText = `padding-left:${10 + depth * 10}px;display:flex;align-items:center;gap:4px;`;
          li.title = isSession ? '双击加载此画布存档' : item.path;
          if (!isSession && currentDoc && currentDoc.name === item.path) li.classList.add('active');

          if (isSession) {
            const nameSpan = document.createElement('span');
            nameSpan.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#56cfba;cursor:pointer';
            nameSpan.textContent = '🎨 ' + item.name;
            nameSpan.addEventListener('click', () => loadSessionFile(item.path));

            const viewBtn = document.createElement('button');
            viewBtn.textContent = '📄';
            viewBtn.title = '文档方式查看';
            viewBtn.style.cssText = 'background:none;border:none;cursor:pointer;padding:1px 4px;font-size:11px;color:#888;flex-shrink:0;border-radius:3px';
            viewBtn.addEventListener('mouseenter', () => viewBtn.style.color = '#ccc');
            viewBtn.addEventListener('mouseleave', () => viewBtn.style.color = '#888');
            viewBtn.addEventListener('click', e => {
              e.stopPropagation();
              openOverlay();
              openDoc(item.path);
            });

            li.appendChild(nameSpan);
            li.appendChild(viewBtn);
          } else {
            li.textContent = '📄 ' + item.name;
            li.style.cursor = 'pointer';
            li.addEventListener('click', () => { openOverlay(); openDoc(item.path); });
          }
          li.addEventListener('contextmenu', e => {
            e.preventDefault();
            const baseItems = [
              ...(isSession ? [
                { label: '🎨 加载到画布', action: () => loadSessionFile(item.path) },
                { label: '📄 用文档打开', action: () => { openOverlay(); openDoc(item.path); } },
              ] : [{ label: '✏️ 重命名', action: () => {
                const newName = prompt(`重命名（含后缀）：`, item.name);
                if (!newName || newName === item.name) return;
                fetch(API + '/rename', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ oldName: item.path, newName: item.path.replace(/[^/]+$/, '') + newName })
                }).then(r => r.json()).then(data => {
                  if (data.success) { loadTree(); showToast('✏️ 已重命名：' + newName); }
                  else alert('重命名失败：' + (data.error || ''));
                });
              }}]),
              { label: '🗑 删除', action: async () => {
                if (!confirm(`确定删除「${item.name}」？`)) return;
                const res = await fetch(API + '/delete?name=' + encodeURIComponent(item.path), { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                  if (!isSession && currentDoc && currentDoc.name === item.path) { currentDoc = null; textarea.value = ''; docTitle.textContent = '未选择'; }
                  loadTree();
                  showToast('🗑 已删除：' + item.name);
                } else { alert('删除失败：' + (data.error || '')); }
              }}
            ];
            if (isSession) {
              const backupPath = item.path.replace(/\.session$/, '') + '_backup.session';
              fetch(API + '/get?name=' + encodeURIComponent(backupPath))
                .then(r => r.json())
                .then(d => {
                  if (d.success) baseItems.splice(2, 0, { label: '♻️ 从备份恢复', action: () => { if (confirm('将从备份还原画布，确定？')) loadSessionFile(backupPath); } });
                  showCtxMenu(e.clientX, e.clientY, baseItems);
                })
                .catch(() => showCtxMenu(e.clientX, e.clientY, baseItems));
            } else {
              showCtxMenu(e.clientX, e.clientY, baseItems);
            }
          });
          container.appendChild(li);
        }
      });
    }

    walk(items, 0, sidebarList);

    if (!hasContent) {
      const li = document.createElement('li');
      li.className = 'sidebar-doc-empty';
      li.textContent = '暂无文档';
      sidebarList.appendChild(li);
    }
  }

  function renderSidebarList(docs) {
    if (!sidebarList) return;
    sidebarList.innerHTML = '';
    if (!docs.length) {
      const li = document.createElement('li');
      li.className = 'sidebar-doc-empty';
      li.textContent = '暂无文档';
      sidebarList.appendChild(li);
      return;
    }
    docs.forEach(doc => {
      const li = document.createElement('li');
      const shortName = doc.name.split('/').pop();
      li.textContent = '📄 ' + shortName;
      li.title = doc.name;
      if (currentDoc && currentDoc.name === doc.name) li.classList.add('active');
      li.addEventListener('click', () => { openOverlay(); openDoc(doc.name); });
      sidebarList.appendChild(li);
    });
  }

  /* ── Open document ── */
  async function openDoc(name) {
    if (isDirty && !confirm('有未保存的更改，确定切换？')) return;
    try {
      const res = await fetch(API + '/get?name=' + encodeURIComponent(name));
      const data = await res.json();
      if (!data.success) { alert('打开失败: ' + data.error); return; }
      currentDoc = { name: data.name, content: data.content, ext: data.ext || '.md' };
      isDirty = false;
      textarea.value = data.content;
      docTitle.textContent = data.name.split('/').pop();
      showDocArea();
      if (currentDoc.ext === '.json' || currentDoc.ext === '.session') {
        preview.textContent = data.content; // show raw for JSON/session
      } else {
        renderPreview(data.content);
      }
      // Refresh tree to update active state
      await loadTree();
    } catch (e) {
      alert('网络错误: ' + e.message);
    }
  }

  function showDocArea() { welcome.style.display = 'none'; docArea.style.display = 'flex'; }
  function showWelcome()  { welcome.style.display = ''; docArea.style.display = 'none'; }

  /* ── Live preview ── */
  function renderPreview(content) {
    if (typeof marked === 'undefined') { preview.textContent = content; return; }
    marked.setOptions({ breaks: true, gfm: true });
    preview.innerHTML = marked.parse(content || '');
    if (typeof hljs !== 'undefined') {
      preview.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
    }
  }

  textarea.addEventListener('input', () => {
    isDirty = true;
    docTitle.textContent = (currentDoc ? currentDoc.name.split('/').pop() : '未命名') + ' ●';
    clearTimeout(renderTimer);
    if (currentDoc && currentDoc.ext === '.json') {
      renderTimer = setTimeout(() => { preview.textContent = textarea.value; }, 300);
    } else {
      renderTimer = setTimeout(() => renderPreview(textarea.value), 300);
    }
  });

  /* ── Save ── */
  async function saveDoc() {
    if (!currentDoc) return;
    const content = textarea.value;
    try {
      const res = await fetch(API + '/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: currentDoc.name, content })
      });
      const data = await res.json();
      if (data.success) {
        currentDoc.content = content; isDirty = false;
        docTitle.textContent = currentDoc.name.split('/').pop();
        await loadTree();
      } else { alert('保存失败: ' + data.error); }
    } catch (e) { alert('网络错误: ' + e.message); }
  }
  btnSave.addEventListener('click', saveDoc);

  /* ── Delete ── */
  btnDelete.addEventListener('click', async () => {
    if (!currentDoc) return;
    if (!confirm(`确定删除「${currentDoc.name}」？`)) return;
    try {
      const res = await fetch(API + '/delete?name=' + encodeURIComponent(currentDoc.name), { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        currentDoc = null; isDirty = false;
        showWelcome(); await loadTree();
      } else { alert('删除失败: ' + data.error); }
    } catch (e) { alert('网络错误: ' + e.message); }
  });

  /* ── Modal: new doc / new folder ── */
  function openModal(mode) {
    modalMode = mode || 'doc';
    modalTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === modalMode));
    updateModalHint();
    // Pre-fill with target folder prefix if set
    modalInput.value = targetFolder ? targetFolder + '/' : '';
    modalOverlay.classList.add('open');
    setTimeout(() => { modalInput.focus(); modalInput.setSelectionRange(modalInput.value.length, modalInput.value.length); }, 50);
  }
  function updateModalHint() {
    if (modalMode === 'doc') {
      modalHint.innerHTML = '文档名（可用 / 指定路径，如 <code>项目/笔记</code>）';
      modalInput.placeholder = '文档名称…';
    } else {
      modalHint.innerHTML = '文件夹名（可用 / 嵌套，如 <code>项目/子目录</code>）';
      modalInput.placeholder = '文件夹名称…';
    }
  }

  modalTabs.forEach(tab => {
    tab.addEventListener('click', () => { modalMode = tab.dataset.mode; openModal(modalMode); });
  });

  async function confirmModal() {
    const name = modalInput.value.trim();
    if (!name) { modalInput.focus(); return; }
    if (modalMode === 'folder') {
      // Create folder
      try {
        const res = await fetch(API + '/mkdir', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        });
        const data = await res.json();
        if (data.success) {
          targetFolder = '';
          modalOverlay.classList.remove('open');
          await loadTree();
          showToast('📁 文件夹已创建：' + name);
        } else { alert('创建失败: ' + data.error); }
      } catch (e) { alert('网络错误: ' + e.message); }
    } else {
      // Create document
      try {
        const res = await fetch(API + '/save', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, content: `# ${name.split('/').pop()}\n\n` })
        });
        const data = await res.json();
        if (data.success) {
          targetFolder = '';
          modalOverlay.classList.remove('open');
          await loadTree();
          if (!overlay.classList.contains('open')) openOverlay();
          await openDoc(name);
        } else { alert('创建失败: ' + data.error); }
      } catch (e) { alert('网络错误: ' + e.message); }
    }
  }

  btnNew.addEventListener('click', () => { targetFolder = ''; openModal('doc'); });
  btnWelcomeNew.addEventListener('click', () => { targetFolder = ''; openModal('doc'); });
  if (sidebarBtnNew) sidebarBtnNew.addEventListener('click', () => { targetFolder = ''; openModal('doc'); });
  btnModalCancel.addEventListener('click', () => { targetFolder = ''; modalOverlay.classList.remove('open'); });
  btnModalConfirm.addEventListener('click', confirmModal);
  modalInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmModal();
    if (e.key === 'Escape') { targetFolder = ''; modalOverlay.classList.remove('open'); }
  });

  /* ── Split divider resize ── */
  const divider     = document.getElementById('docs-split-divider');
  const editorPane  = document.getElementById('docs-editor-pane');
  const previewPane = document.getElementById('docs-preview-pane');
  let dragging = false, startX = 0, startW = 0;
  divider.addEventListener('mousedown', e => {
    dragging = true; startX = e.clientX;
    startW = editorPane.getBoundingClientRect().width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const container = editorPane.parentElement.getBoundingClientRect().width;
    const newW = Math.max(200, Math.min(startW + e.clientX - startX, container - 204));
    const r = newW / container;
    editorPane.style.flex = `0 0 ${(r*100).toFixed(1)}%`;
    previewPane.style.flex = `0 0 ${((1-r)*100).toFixed(1)}%`;
  });
  document.addEventListener('mouseup', () => {
    if (dragging) { dragging = false; document.body.style.cursor = ''; document.body.style.userSelect = ''; }
  });

  /* ── Keyboard shortcuts ── */
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'd') { e.preventDefault(); overlay.classList.contains('open') ? closeOverlay() : openOverlay(); return; }
    if (!overlay.classList.contains('open')) return;
    if (e.key === 'Escape' && !modalOverlay.classList.contains('open')) { closeOverlay(); return; }
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveDoc(); return; }
    if (e.ctrlKey && e.key === 'n') { e.preventDefault(); openModal('doc'); return; }
  });

  /* ── Tab key in textarea ── */
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = textarea.selectionStart, end = textarea.selectionEnd;
      textarea.value = textarea.value.substring(0, s) + '  ' + textarea.value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = s + 2;
    }
  });

  /* ── Helpers ── */
  function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function showToast(msg) {
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:#1e2028;color:#e8eaf0;padding:8px 18px;border-radius:8px;font-size:13px;z-index:9999;border:1px solid rgba(255,255,255,0.12);box-shadow:0 4px 16px rgba(0,0,0,0.4);pointer-events:none;transition:opacity 0.4s;white-space:nowrap';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 2200);
  }

  let _ctxMenu = null;
  function showCtxMenu(x, y, items) {
    if (_ctxMenu) _ctxMenu.remove();
    const menu = document.createElement('div');
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:#1e2028;border:1px solid rgba(255,255,255,0.12);border-radius:6px;box-shadow:0 4px 20px rgba(0,0,0,0.5);z-index:99999;min-width:120px;overflow:hidden`;
    items.forEach(item => {
      const btn = document.createElement('div');
      btn.style.cssText = 'padding:8px 14px;cursor:pointer;font-size:13px;color:#e8eaf0;white-space:nowrap;transition:background 0.1s';
      btn.textContent = item.label;
      btn.onmouseenter = () => btn.style.background = 'rgba(255,255,255,0.08)';
      btn.onmouseleave = () => btn.style.background = '';
      btn.addEventListener('click', () => { menu.remove(); _ctxMenu = null; item.action(); });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    _ctxMenu = menu;
    const dismiss = e => { if (!menu.contains(e.target)) { menu.remove(); _ctxMenu = null; document.removeEventListener('mousedown', dismiss); } };
    setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
  }

  /* ── Init sidebar on page load ── */
  (async function init() {
    try {
      const res = await fetch(API + '/tree');
      const data = await res.json();
      if (data.success) {
        renderSidebarTree(data.tree);
        allDocs = [];
        function flattenDocs(items) {
          items.forEach(item => {
            if (item.type === 'folder') flattenDocs(item.children || []);
            else allDocs.push({ name: item.path, updatedAt: item.updatedAt });
          });
        }
        flattenDocs(data.tree);
      }
    } catch (_) {}

    // Auto-load EntryClass session from URL param ?ecload=<path>
    const _ecLoadPath = new URLSearchParams(location.search).get('ecload');
    if (_ecLoadPath && window.loadSessionFile) {
      setTimeout(() => window.loadSessionFile(_ecLoadPath), 600);
    }
  })();
})();

/* ───── Console / Chat Tab ───── */
let _chatLastLoadedSession = null;

function switchConsoleTab(tab) {
  const consolePane = document.getElementById('console-pane');
  const chatPane    = document.getElementById('chat-pane');
  const tabBtns     = document.querySelectorAll('.console-tab');
  const clearBtn    = document.getElementById('btn-clear-console');

  tabBtns.forEach(btn => btn.classList.toggle('active', btn.id === 'tab-' + tab));
  if (tab === 'console') {
    consolePane.style.display = '';
    chatPane.style.display    = 'none';
    if (clearBtn) clearBtn.style.display = '';
  } else {
    consolePane.style.display = 'none';
    chatPane.style.display    = '';
    if (clearBtn) clearBtn.style.display = 'none';
    // Restore saved session ID
    const saved = localStorage.getItem('chat-session-id');
    const inp = document.getElementById('chat-session-id');
    if (inp && saved && !inp.value) inp.value = saved;
    document.getElementById('chat-input')?.focus();
    // Load session history on first open (or if session changed)
    const currentSession = inp?.value.trim() || '';
    if (currentSession && currentSession !== _chatLastLoadedSession) {
      _chatLastLoadedSession = currentSession;
      if (typeof window.loadChatHistory === 'function') window.loadChatHistory();
    }
  }
}

// Persist session ID on change
document.getElementById('chat-session-id')?.addEventListener('input', function() {
  localStorage.setItem('chat-session-id', this.value.trim());
});

// Ctrl+Enter sends message
document.getElementById('chat-input')?.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); chatSend(); }
});

function chatAddMsg(text, role) {
  const wrap = document.getElementById('chat-messages');
  if (!wrap) return;
  const div = document.createElement('div');
  div.className = 'chat-msg chat-msg-' + role;
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  div.innerHTML = `<span class="chat-ts">${ts}</span><span class="chat-text">${text.replace(/</g,'&lt;').replace(/\n/g,'<br>')}</span>`;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

async function chatSend() {
  const sessionInp = document.getElementById('chat-session-id');
  const textInp    = document.getElementById('chat-input');
  const sendBtn    = document.getElementById('chat-send-btn');
  const sessionId  = sessionInp?.value.trim();
  const task       = textInp?.value.trim();

  if (!sessionId) { sessionInp?.focus(); showToast('⚠ 请先填写 Session ID'); return; }
  if (!task)      { textInp?.focus(); return; }

  chatAddMsg(task, 'user');
  textInp.value = '';
  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '发送中…'; }

  try {
    const res = await fetch('http://localhost:7439/agent/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, task })
    });
    const data = await res.json();
    if (data.success) {
      chatAddMsg('✅ 任务已送达，爱丽丝处理中…', 'system');
    } else {
      chatAddMsg('❌ 发送失败：' + (data.error || '未知错误'), 'system');
    }
  } catch (err) {
    chatAddMsg('❌ 网络错误：' + err.message, 'system');
  } finally {
    if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '发送'; }
  }
}
