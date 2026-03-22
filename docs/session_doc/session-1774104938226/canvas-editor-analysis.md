# Canvas Editor 应用深度技术分析报告

> 分析时间：2026-03-21 | 端口：8331

---

## 一、系统架构概览

`
Frontend (Web UI) - port 8331
  index.html / app.js (~283KB) / style.css

Backend (Express 4.18.2) - server.js
  /docs/api/*  → 文档系统
  /api/*       → 画布资源 (session/theme/uidata/elements)
  /proxy/*     → 爱丽丝Agent (localhost:7439)

Data Layer
  data/docs/sessions/*.session    画布工程文件 (23个)
  data/docs/uidata/*.uidata       数据绑定
  data/docs/config/elements.json  控件定义 (26种)
  data/themes/*.json              主题配置
`

### 应用启动流程

`
页面加载 → index.html
    ↓
app.js 初始化
    ├→ loadElements()   加载 elements.json
    ├→ loadSession()    恢复上次 session
    ├→ loadTheme()      加载主题
    └→ drawGrid()       绘制背景网格
`

---

## 二、API 端点

### 文档管理 /docs/api/*

| 端点 | 方法 | 功能 |
|------|------|------|
| /docs/api/list | GET | 扁平文件列表 |
| /docs/api/tree | GET | 树形结构 |
| /docs/api/get?name= | GET | 获取文档内容 |
| /docs/api/save | POST | 创建/更新文档 |
| /docs/api/mkdir | POST | 创建文件夹 |
| /docs/api/delete?name= | DELETE | 删除文件/文件夹 |
| /docs/api/rename | POST | 重命名 |

支持格式：.md .json .session .uidata

### 画布资源 /api/*

| 端点 | 方法 | 功能 |
|------|------|------|
| /api/elements | GET | 控件定义 (containers+controls) |
| /api/images | GET | 列出图片资源 |
| /api/data-asset/:name | GET | 数据资产 JSON |
| /api/session/:name | GET/POST | 读写 session |
| /api/sessions | GET | 列出所有 session |
| /api/theme | GET/POST | 读写主题 |
| /api/themes | GET | 列出主题 |
| /api/uidata/:name | GET/POST | 读写 UiData |
| /api/uidatas | GET | 列出所有 UiData |

### Agent 代理 /proxy/agent/*

| 端点 | 方法 | 功能 |
|------|------|------|
| /proxy/agent/task | POST | 提交任务给爱丽丝 |
| /proxy/agent/task-status | GET | 查询任务状态 |
| /proxy/agent/chat-history | GET | 获取会话历史 |
| /proxy/agent/sessions-list | GET | 获取会话列表 |

---

## 三、核心数据结构

### 3.1 Box 节点对象

`json
{
  "id": 200,
  "label": "Box200",
  "x": 100, "y": 50,
  "w": 400, "h": 300,
  "borderColor": "#7c6af7",
  "bgColor": "rgba(124,106,247,0.06)",
  "borderWidth": 1,
  "borderRadius": 0,
  "opacity": 1,
  "bgImage": "",
  "widgetType": "CanvasPanel",
  "widgetProps": {},
  "anchor": { "minX": 0, "minY": 0, "maxX": 0, "maxY": 0 },
  "children": [],
  "isEntryClass": false,
  "entryClassRef": ""
}
`

### 3.2 Session 文件格式 (v1.1)

`json
{
  "version": "1.1",
  "savedAt": "2026-03-21T05:12:51.262Z",
  "nextId": 54,
  "boxes": [
    {
      "id": "bagWidget",
      "widgetType": "CanvasPanel",
      "children": [
        { "id": "titleBar", "children": [...] },
        { "id": "invPanel",  "children": [...] }
      ]
    }
  ]
}
`

- v1.1：嵌套 children 树（推荐）
- v1.0：扁平数组 + parentId 引用（向后兼容）

### 3.3 elements.json 结构

`json
{
  "containers": [ { "type": "CanvasPanel", "label_zh": "画布面板", ... } ],
  "controls":   [ { "type": "TextBlock",   "label_zh": "文本块", ... } ]
}
`

每个控件定义：type / label / label_zh / icon / color / bg / render / props

---

## 四、控件体系（26种）

### 容器（15种）

| 类型 | 中文名 | 说明 |
|------|--------|------|
| CanvasPanel | 画布面板 | 绝对定位，INVISIBLE_CONTAINER |
| Border | 边框容器 | 带背景和边框 |
| HorizontalBox | 水平布局 | 横排子元素 |
| VerticalBox | 垂直布局 | 竖排子元素 |
| GridPanel | 网格面板 | 格网定位 |
| ScrollBox | 滚动容器 | 超出时滚动 |
| SizeBox | 固定尺寸盒 | 强制固定子 w/h |
| Overlay | 叠层容器 | 子元素互叠 |
| TileView | 平铺视图 | 列表（需 EntryClass） |
| ListView | 列表视图 | 纵向列表（需 EntryClass） |
| TreeView | 树形视图 | 树形列表 |
| UniformGridPanel | 均匀网格 | 均等格网 |
| WrapBox | 流式布局 | 自动换行 |
| ScaleBox | 缩放容器 | 等比缩放内容 |
| SkillList | 技能列表 | 游戏技能专用 |

### 控件（11种）

| 类型 | 中文名 | 渲染方式 |
|------|--------|---------|
| TextBlock | 文本块 | text |
| TextBox | 只读文本框 | text |
| Button | 按钮 | text+icon |
| Image | 图片 | image |
| ProgressBar | 进度条 | progress |
| Slider | 滑块 | slider |
| EditableText | 单行输入 | input |
| EditableTextBox | 多行输入 | input |
| CheckBox | 复选框 | checkbox |
| SpinBox | 数字旋转框 | spinbox |
| ComboBox | 下拉框 | combo |

---

## 五、渲染流程

`
renderAll()  ← RAF 防抖
  └→ _renderAllNow()
       ├→ 重建 _boxById O(1) 缓存
       ├→ 清理已删除 DOM 元素
       ├→ boxes.forEach(b => renderBox(b))
       │     ├→ 创建/复用 .box-item DOM
       │     ├→ 更新 CSS 位置尺寸
       │     ├→ 应用视觉样式 (border/bg/opacity/radius)
       │     ├→ 更新选中态 (resize-handle)
       │     ├→ applyThemeOverlay()
       │     ├→ renderEntryClassPreview() (有 entryClassRef 时)
       │     ├→ renderTileViewGrid()      (TileView 网格预览)
       │     └→ renderWidgetContent()
       │           text / image / progress / slider
       │           input / checkbox / combo / spinbox
       ├→ syncZOrder()   同步Z轴
       ├→ renderLayers() 层级树
       └→ renderProps()  属性面板
`

**性能优化**：
- RAF 防抖：同帧请求合并，避免冗余渲染
- renderPositionsOnly()：拖拽时仅改 CSS，不重建 DOM
- widgetContentKey 缓存：控件内容变化才重建
- _boxById O(1)：ID→Box 映射缓存

---

## 六、交互功能

| 功能 | 实现 |
|------|------|
| 拖拽移动 | Snap 吸附 + edgeSnap 兄弟对齐 |
| 8向缩放 | resize-handle (nw/n/ne/e/se/s/sw/w) |
| 撤销/重做 | 50级 JSON快照 (Ctrl+Z/Y) |
| 锚点布局 | 16预设, minX/maxX/minY/maxY (0~1) |
| 层级面板 | 树形显示, 右键菜单, scrollIntoView |
| EntryClass | TileView条目模板, 子节点锁定保护 |
| 批量创建 | TileView/ListView 快速生成对话框 |
| 预览模式 | P键, 隐藏边框, UiData数据覆盖 |
| 资源面板 | 扫描URL引用, 图片预览 |
| 主题系统 | 图案叠加层, 不写入session |
| UiData绑定 | 预览模式下 data 覆盖 widgetProps |

---

## 七、Session 文件列表（23个）

| 文件 | 说明 |
|------|------|
| default.session | 默认空白项目 |
| bag.session | 背包 v1 |
| bag2.session | RPG背包完整布局 (136节点) |
| bag3.session | 背包 v3 |
| bag4.session | InvGrid+BeltQuick TileView化 |
| bag5.session | beltPanel层级修复 |
| bag6.session | 层级规范化（根节点减为1） |
| bag7.session | 全新语义化ID, 规范TextBlock (80节点) |
| bag8.session | EntryClass 完整化 |
| bag9.session | EntryClass 外部引用架构 |
| bag10.session | 最新简化版 (3节点) |
| bagItem_entry.session | 背包格 EntryClass (62×62) |
| beltSlot_entry.session | 腰带槽 EntryClass (66×44) |
| skil_list.session | 技能列表 UI |
| weapon_customization.session | 武器自定义界面 |
| test*.session | 测试用例 |

---

## 八、EntryClass 规范

TileView/ListView/TreeView 的条目模板设计规范：

`
EntryClass 结构：
SizeBox (固化 w/h)
  └→ Overlay (叠层容器)
       ├→ Background (Border, 背景)
       ├→ Icon       (Image, 图标)
       └→ ItemCount  (TextBlock, 右下角数量)
`

- isEntryClass=true 的节点及其子节点被锁定
- 外部引用：widgetProps.entryClass = "entryclass/InvSlotEntry"
- 不得内嵌在 TileView.children，必须通过路径引用

---

## 九、开发建议

### 扩展新控件（无需改 JS）
在 elements.json 的 controls 数组追加：
`json
{
  "type": "MyWidget",
  "label": "MyWidget",
  "label_zh": "自定义控件",
  "icon": "🎯",
  "group": "自定义",
  "color": "#ff6b6b",
  "bg": "rgba(255,107,107,0.05)",
  "render": { "type": "text", "src": "text" },
  "props": [
    { "key": "text", "label": "内容", "type": "text", "default": "Hello" }
  ]
}
`

### 性能瓶颈

| 操作 | 复杂度 | 优化建议 |
|------|--------|---------|
| parentId重计算 | O(n²) | 增量更新，仅重算受影响节点 |
| undo 序列化 | O(n) | 差异化保存 |
| DOM节点过多 | O(n) | 虚拟滚动/分层渲染 |

---

## 总结

Canvas Editor 是功能完整的**游戏 UI 编辑器（UMG 风格）**：

- ✅ 绝对坐标系 + 锚点响应式布局（16预设）
- ✅ 26种控件，JSON 驱动可扩展
- ✅ Session v1.1 嵌套树持久化 + v1.0 向后兼容
- ✅ EntryClass 模板系统（外部 .session 引用）
- ✅ UiData 数据绑定（预览模式真实渲染）
- ✅ 爱丽丝 Agent 集成（Chat任务提交）
- ✅ 主题系统 + 资源管理面板
- ✅ 50级撤销/重做 + 自动保存
- ✅ RAF防抖渲染 + O(1)缓存 + 增量CSS更新
