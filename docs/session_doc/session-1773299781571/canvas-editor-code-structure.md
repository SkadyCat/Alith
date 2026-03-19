# Canvas Editor 代码结构文档

> 版本：2026-03-19  
> 主要文件：`application/canvas-editor/`

---

## 一、目录结构

```
canvas-editor/
├── public/
│   ├── app.js          # 主前端逻辑（5900+ 行）
│   ├── index.html      # 单页应用入口（361行）
│   └── style.css       # 样式（1366行）
├── data/
│   ├── docs/
│   │   ├── config/
│   │   │   ├── elements.json       # 控件类型注册表（385行）
│   │   │   └── DA_WeaponScreenData.json
│   │   └── sessions/               # session 文件存储目录
│   ├── sessions/
│   │   └── default.json
│   └── themes/
│       └── default.json            # 控件视觉主题
├── server.js           # Express 后端（349行）
└── package.json
```

---

## 二、server.js 路由表

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/` | 返回 index.html |
| GET  | `/api/elements` | 返回 elements.json（控件类型定义） |
| GET  | `/api/session/:name` | 读取 session 文件 |
| POST | `/api/session/:name` | 保存 session 文件 |
| GET  | `/api/sessions` | 列出所有 session 文件 |
| GET  | `/api/theme` | 读取主题 |
| POST | `/api/theme` | 保存主题 |
| GET  | `/api/themes` | 列出所有主题 |
| GET  | `/api/images` | 扫描可用图片资源 |
| GET  | `/docs/api/tree` | 文件树 |
| GET  | `/docs/api/get` | 读取文件内容 |
| POST | `/docs/api/save` | 保存文件内容 |
| POST | `/proxy/agent/task` | 代理到 Alice 服务 |

---

## 三、app.js 模块分区

app.js 按 `/* ───── 区块名 ───── */` 注释分隔，共约 30 个功能区：

### 3.1 全局状态（顶部）

```javascript
let boxes        = [];       // 所有 Box 节点（扁平数组，parentId 关联）
let selectedId   = null;     // 当前选中的 box.id
let nextId       = 1;        // 自增 ID（语义化 ID 用字符串，此值预留给动态创建）
let mode         = 'select'; // 'select' | 'draw'
let zoom         = 1.0;
let panX, panY   = 0;
let _previewMode = false;    // P 键切换布局/预览模式
```

### 3.2 核心渲染流程

```
renderAll()
  └── _renderAllNow()
       ├── boxes.forEach(b => renderBox(b))
       │     ├── 创建/更新 DOM div.box-item
       │     ├── renderWidgetContent(box, el, def)  — 渲染控件内容
       │     ├── renderEntryClassPreview(box, el)    — EntryClass 预览
       │     └── renderTileViewGrid(box, el)          — TileView 格子预览
       ├── syncZOrder()      — 子节点 z-index 高于父节点
       ├── renderLayers()    — 左侧层级面板
       └── renderProps()     — 右侧属性面板
```

### 3.3 函数索引（按区块）

| 区块 | 关键函数 | 说明 |
|------|---------|------|
| **Global** | `canvasW/H()`, `parseBoxId()`, `showToast()` | 工具函数 |
| **Widget Theme** | `applyThemeOverlay()`, `getWidgetDef()` | 主题/控件定义 |
| **Anchor System** | `applyAnchorPreset()`, `buildAnchorPickerHTML()` | 锚点约束 |
| **Snap** | `snap()`, `edgeSnap()` | 对齐/吸附 |
| **Undo/Redo** | `saveState()`, `undo()`, `redo()` | 历史记录栈 |
| **Box Model** | `createBox()`, `initWidgetProps()` | 创建节点 |
| **Preview Mode** | `togglePreviewMode()` | P 键预览模式 |
| **Icon Picker** | `openIconPicker()`, `applyIcon()` | 图标选择器 |
| **Assets Panel** | `openAssetsPanel()` | 资源面板 |
| **EntryClass** | `isLockedEntryClass()`, `getLockedEntryClassAncestor()`, `ensureTileViewEntry()` | EntryClass 锁定/查找 |
| **Parent Calc** | `findParentFor()`, `recomputeAllParents()` | 父子关系计算 |
| **Render** | `renderBox()` | 核心渲染（约220行） |
| **EntryClass Editor** | `showEntryClassEditor()` | TileView EntryClass 编辑器弹窗 |
| **Return Bar** | `_showReturnBar()`, `_returnToParentCanvas()` | 返回父画布 |
| **TileView Grid** | `renderTileViewGrid()` | TileView 格子预览 |
| **Widget Props** | `renderWidgetContent()`, `renderWidgetProps()` | 控件内容+属性面板 |
| **Context Menu** | `showBoxCtxMenu()`, `showSimpleCtxMenu()` | 右键菜单 |
| **Sync/Render** | `syncZOrder()`, `renderAll()`, `_renderAllNow()`, `renderPositionsOnly()` | 渲染触发 |
| **Layers/Props** | `renderLayers()`, `renderProps()` | 面板 UI |
| **Selection** | `selectBox()`, `deselectAll()` | 选中状态 |
| **Mouse Events** | `onBoxMouseDown()`, `onResizeStart()`, `getCanvasPos()` | 拖拽/缩放 |
| **Mode Switch** | `setMode()` | select/draw 模式 |
| **Description** | `showDescriptionModal()` | 节点描述弹窗 |
| **Resources** | `showResourcesPanel()` | 资源面板（旧） |
| **Save EntryClass** | `showSaveEntryClassModal()` | 保存 EntryClass 弹窗 |
| **Delete** | `collectDescendants()`, `deleteSelected()` | 删除节点+子树 |
| **Zoom** | `setZoom()`, `zoomAroundPoint()`, `zoomToFit()` | 缩放控制 |
| **Palette** | `buildPalette()`, `applyPaletteFilter()` | 左侧控件托盘 |
| **Session** | `setActiveSession()`, `serializeBoxes()`, `deserializeBoxes()`, `autoSave()` | 序列化/反序列化 |
| **Batch Create** | `openBatchCreateDialog()` | 批量创建对话框 |
| **Console/Chat** | `chatAddMsg()`, `switchConsoleTab()` | 控制台/对话 |

---

## 四、数据流：Session 文件格式

```json
{
  "version": "1.1",
  "savedAt": "ISO时间",
  "nextId": 1000,
  "boxes": [
    {
      "id": "bagWidget",        // 语义化字符串 ID（禁止纯数字）
      "label": "BagWidget",
      "x": 0, "y": 0, "w": 960, "h": 622,
      "bgColor": "#0a0703",
      "borderColor": "#4a3010",
      "borderWidth": 2,
      "borderRadius": 0,
      "opacity": 1,
      "boxShadow": "",
      "widgetType": "CanvasPanel",  // 必须是 elements.json 中注册的类型
      "widgetProps": {},
      "anchor": { "minX": 0, "minY": 0, "maxX": 0, "maxY": 0 },
      "children": []               // 嵌套子节点（序列化格式）
    }
  ]
}
```

**内存格式（boxes 数组）**：反序列化后是扁平结构，每个节点有 `parentId` 字段。
**文件格式**：嵌套 `children` 结构（序列化/反序列化时转换）。

---

## 五、TileView / ListView 架构（bag9 规范）

```
TileView (widgetProps)
  ├── entryWidth:     62
  ├── entryHeight:    62
  ├── gridPreviewNum: 49          // 属性面板可调，renderTileViewGrid 用此值生成预览格
  └── entryClass:     "bagItem_entry"   // 外部 session 文件名（不含 .session）

bagItem_entry.session (独立文件)
  └── SizeBox (62×62, widthOverride=62, heightOverride=62)
       └── Overlay
            ├── Border     (背景)
            ├── Image      (图标)
            └── TextBlock  (数量)
```

**renderTileViewGrid 逻辑**：
1. 如果有内嵌 `isEntryClass` 子节点 → 用其 w/h/borderColor 渲染格子（兼容旧格式）
2. 否则 → 从 `widgetProps.entryWidth/entryHeight` 读取格子尺寸，渲染虚拟占位格子
3. 外部 entryClass 的首格显示 entryClass session 名称作为标注

---

## 六、elements.json 控件类型注册格式

```json
{
  "type": "TileView",
  "label": "TileView",
  "label_zh": "平铺视图",
  "icon": "🔲",
  "group": "列表",
  "props": [
    { "key": "entryWidth",     "label": "格宽",     "type": "number", "default": 60 },
    { "key": "entryHeight",    "label": "格高",     "type": "number", "default": 60 },
    { "key": "gridPreviewNum", "label": "预览数量", "type": "number", "default": 4 },
    { "key": "entryClass",     "label": "EntryClass", "type": "text", "default": "" }
  ]
}
```

`props` 驱动右侧属性面板的自动生成（`renderWidgetProps` 函数）。

---

## 七、坐标系

- 所有 box 使用**画布绝对坐标** (x, y, w, h)
- parent-child 关系**仅表示逻辑层级**，不做坐标变换
- 缩放/平移：`zoom`, `panX`, `panY` 通过 CSS transform 应用在 `#box-layer`

---

## 八、预览模式（P 键）

- `_previewMode = true` 时：
  - 隐藏：`.box-label`、`.resize-handle`、`#sel-overlay`
  - `INVISIBLE_CONTAINER_TYPES`（CanvasPanel 等）border 改为细虚线
  - 控件内容（TextBlock 文字、Image、ProgressBar）正常渲染
- TileView 在任何模式下都渲染 `gridPreviewNum` 个格子占位