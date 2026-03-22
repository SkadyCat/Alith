# UI 创建规范

> 基于 bag3.session 背包 UI 创建经验总结。

---

## 一、节点 ID 命名规范

**强制要求**：每个节点的 `id` 必须是描述该节点功能的语义化英文单词或词组，**禁止使用数字**。

| ✅ 正确示例 | ❌ 错误示例 |
|------------|------------|
| `titleBar` | `10` |
| `closeBtn` | `11` |
| `statPanel` | `id_12` |
| `invGrid_slot_0_0` | `slot1` |
| `equipSlot_head` | `100` |

**命名格式建议**：
- 容器：`xxxPanel`、`xxxBox`、`xxxBar`、`xxxArea`
- 文本：`xxxText`、`xxxLabel`、`xxxTitle`
- 按钮：`xxxBtn`
- 图片：`xxxIcon`、`xxxImg`、`xxxBg`
- 槽位：`xxxSlot_描述`（如 `equipSlot_head`、`invGrid_slot_0_0`）
- 进度条：`xxxBar`（如 `hpBar`、`mpBar`）

---

## 二、widgetType 必须精确匹配

`widgetType` 字段必须使用 `elements.json` 中注册的**精确类型名**，大小写敏感。

| 类型名 | 说明 |
|--------|------|
| `TextBlock` | 文本块（**不是** `Label`、`Text`、`text`） |
| `Button` | 按钮 |
| `Image` | 图片 |
| `ProgressBar` | 进度条 |
| `Slider` | 滑块 |
| `EditableText` | 单行输入框 |
| `EditableTextBox` | 多行输入框 |
| `CheckBox` | 复选框 |
| `SpinBox` | 数字输入框 |
| `ComboBox` | 下拉框 |
| `TextBox` | 文本框 |
| `CanvasPanel` | 画布容器 |
| `Border` | 边框容器 |
| `HorizontalBox` | 横向布局 |
| `VerticalBox` | 竖向布局 |
| `GridPanel` | 网格布局 |
| `ScrollBox` | 滚动容器 |
| `TileView` | 平铺列表 |
| `ListView` | 滚动列表 |

> **不需要 widgetType 的纯容器已禁止**：所有节点必须有合法的 `widgetType`，纯容器使用 `CanvasPanel`，**禁止 `widgetType: null`（即 Box）**。

---

## 三、widgetProps 字段名必须与控件定义一致

每种控件的 prop key 有严格限制，常见错误：

### TextBlock
```json
{
  "widgetType": "TextBlock",
  "widgetProps": {
    "text": "文本内容",
    "fontSize": 14,
    "textColor": "#d4a84b",
    "textAlign": "center",
    "bold": true,
    "italic": false,
    "autoWrap": true
  }
}
```
| ✅ 正确 key | ❌ 错误 key |
|------------|------------|
| `textColor` | `color` |
| `textAlign` | `align` |
| `bold: true` | `fontWeight: "bold"` |

### ProgressBar
```json
{
  "widgetType": "ProgressBar",
  "widgetProps": {
    "percent": 0.75,
    "fillColor": "#e04040",
    "barColor": "#333344"
  }
}
```
| ✅ 正确 key | ❌ 错误 key |
|------------|------------|
| `percent` (0.0–1.0) | `value` / `maxValue` |

### Button
```json
{
  "widgetType": "Button",
  "widgetProps": {
    "text": "按钮文字",
    "fontSize": 14,
    "textColor": "#ffffff",
    "textAlign": "center",
    "bold": false
  }
}
```

### Image
```json
{
  "widgetType": "Image",
  "widgetProps": {
    "imagePath": "/assets/icons/head.png",
    "tintColor": "#ffffff",
    "imageDrawType": "Normal"
  }
}
```

---

## 四、Session 文件格式

### 基本结构
```json
{
  "version": "1.1",
  "savedAt": "ISO 时间字符串",
  "nextId": 1000,
  "boxes": [ /* 根节点数组（嵌套 children 格式） */ ]
}
```

### 每个 Box 的必填字段
```json
{
  "id": "语义化ID",
  "label": "显示名称",
  "x": 0,
  "y": 0,
  "w": 100,
  "h": 30,
  "bgColor": "#0a0703",
  "borderColor": "#4a3010",
  "borderWidth": 2,
  "borderRadius": 4,
  "opacity": 1,
  "boxShadow": "",
  "widgetType": "CanvasPanel",
  "widgetProps": {},
  "anchor": { "minX": 0, "minY": 0, "maxX": 0, "maxY": 0 },
  "children": []
}
```

### nextId 规则
- 所有 box 使用**语义化字符串 id**（如 `titleBar`）
- `nextId` 设为 `1000`（预留给动态创建节点用）

---

## 五、坐标系规范

- 所有 box 使用**绝对坐标** `(x, y, w, h)`
- parent-child 关系**仅表示层级**，不做坐标变换（子节点坐标是相对于画布，不是相对于父节点）
- 设计时从整体到局部，先确定大容器位置，再计算子节点位置

---

## 六、RPG 背包 UI 配色（bag3 风格）

| 元素 | 颜色值 |
|------|--------|
| 主背景 | `#0a0703` |
| 暗金边框 | `#4a3010` |
| 金色标题文字 | `#d4a84b` |
| 暗红色 HP | `#e04040` |
| 蓝色 MP | `#4060e0` |
| 青绿进度 | `#56cfba` |
| 栏目背景 | `#0d0a05` / `#0f0c07` |
| 面板标题背景 | `#1a1008` |
| 暗金边框高亮 | `#6a4820` |
| 暗色文字 | `#8a6040` |

---

## 七、常见 Bug 速查

| 现象 | 原因 | 修复方法 |
|------|------|----------|
| 节点 ID 为字符串时控件无法选中 | `+el.id.replace('box-', '')` 把字符串 ID 转为 NaN | app.js 使用 `parseBoxId()` 解析，已修复 |
| 文本全部不显示 | `widgetType: "Label"` 不存在 | 改为 `TextBlock` |
| 文本颜色无效 | prop key 用了 `color` | 改为 `textColor` |
| 文本对齐无效 | prop key 用了 `align` | 改为 `textAlign` |
| 文字不加粗 | `fontWeight: "bold"` | 改为 `bold: true` |
| 进度条不显示 | prop key 用了 `value/maxValue` | 改为 `percent` (0–1) |
| 节点 ID 冲突 | 大量节点用数字 ID | 全部改为语义化字符串 |
| 节点加载乱序 | `nextId` 太小与字符串 ID 冲突 | `nextId` 设为 1000 |

---

## 九、层级面板显示规则

- 每个节点显示格式：`nodeName (widgetType)`
- `widgetType` 显示**完整英文名**（如 `TextBlock`、`CanvasPanel`），不使用中文翻译
- 选中画布控件后，层级面板自动滚动定位到对应节点

---

## 十、节点层级规范（Parent-Child 正确性）

**核心原则：生成或替换节点时，节点必须放置在正确的父容器下，严禁追加到根 `boxes` 数组。**

### 根节点只允许以下情况

| 节点类型 | 是否允许作为根节点 |
|---------|------------------|
| 整个窗口的顶层容器（如 `bagWidget`） | ✅ 允许 |
| 独立浮动元素（如 `closeBtn`，有意脱离层级） | ✅ 允许（需注释说明） |
| 其他任何节点 | ❌ 禁止 |

### 生成代码规范

**错误做法（禁止）：**
```powershell
# ❌ 直接追加到根数组
$data.boxes = @($data.boxes) + @($newNode)
```

**正确做法：**
```powershell
# ✅ 先找到目标父节点，再追加到其 children
$parent = Find-NodeById $data.boxes "beltPanel"
$parent.children = @($parent.children) + @($newNode)
```

### 替换节点时的正确流程

1. **先定位原节点的父容器**（不能只找节点本身）
2. **在父容器的 `children` 中删除旧节点**
3. **将新节点插入同一父容器的 `children`**
4. **不得将新节点追加到根 `boxes`**

> **历史错误记录**：bag4.session 生成时，BeltQuick TileView 被追加到根 `boxes` 数组，  
> 而非放入其对应父容器 `beltPanel.children`，导致层级结构错误（bag5.session 已修复）。

---

## 十一、合规性检查清单

提交 session 前必须通过以下检查：

- [ ] 所有节点 `id` 为语义化字符串，无纯数字
- [ ] 所有节点 `widgetType` 为 `elements.json` 中的合法类型，无 `null`（纯容器用 `CanvasPanel`）
- [ ] 所有 `widgetProps` 的 key 与控件定义完全一致
- [ ] `nextId` 设为 `1000`
- [ ] **根节点只有顶层容器和有意浮动的元素，无其他节点**
- [ ] **所有功能节点都在其逻辑父容器的 `children` 内**


> 以下规则待用户进一步确认和补充。

- [ ] 装备槽标准尺寸（推荐 56×56 或 64×64？）
- [ ] 格子物品槽间距（当前 bag3 用 62px 格，2px 间距）
- [ ] 字体大小层级（标题 16px？副标题 12px？数值 11px？）
- [ ] ProgressBar 标准高度（当前 bag3 用 10px）
- [ ] 窗口标准尺寸（当前 bag3 为 960×622）

## 文本控件规范

- **文本节点 widgetType 必须使用 TextBlock**，禁止使用 Label
- Label 是 canvas editor 的节点标注名（label 属性），与 UMG 的文本控件 TextBlock 是两回事
- ag3_before_textfix.session 曾错误地将所有文本节点的 widgetType 设为 "Label"，导致导出后文本控件类型错误
- 修复方式：将 session 文件中所有 "widgetType": "Label" 替换为 "widgetType": "TextBlock"
- ag4.session 已应用此修复（45处 Label → TextBlock）


## 十二、TileView / ListView EntryClass 规范

**EntryClass 必须完整**，不得只创建空容器占位。

### 标准结构

`
EntryClass (CanvasPanel, isEntryClass=true)
  └── SizeBox  (widgetProps: widthOverride, heightOverride — 固化格子尺寸)
       └── Overlay  (叠层容器，所有内容层叠)
            ├── Background  (Border — 格子背景样式)
            ├── Icon        (Image  — 物品图标占位)
            └── Text        (TextBlock — 数量/快捷键等标注)
`

### 各控件说明

| 节点 | widgetType | 作用 |
|------|-----------|------|
| EntryClass | CanvasPanel | 模板根节点，标记 isEntryClass=true |
| SizeBox | SizeBox | 固化尺寸：widthOverride + heightOverride |
| Overlay | Overlay | 叠层：子节点按Z序堆叠，无需额外props |
| Background | Border | 格子背景+边框，bgColor+borderColor定义外观 |
| Icon | Image | imagePath=""(占位), tintColor="#ffffff" |
| Text | TextBlock | 右下角数量或左上角快捷键，fontSize=9~10 |

### SizeBox widgetProps 示例（invGrid 62×62）

`json
{ "widthOverride": 62, "heightOverride": 62 }
`

### ❌ 禁止

- EntryClass 留空（无 children）
- 不用 SizeBox 固化尺寸
- 不用 Overlay 叠层，而是把 Background/Icon/Text 平铺为兄弟节点

## 十三、EntryClass 独立 Session 规范

TileView / ListView 的 EntryClass **必须是独立的 session 文件**，不得内嵌在父 TileView 的 children 中。

### 创建流程

1. 新建 xxx_entry.session，根节点为 SizeBox，内含 Overlay + [Background, Icon, Text] 结构
2. 在 TileView/ListView 的 widgetProps.entryClass 填写 session 名（不含 .session 后缀）
3. TileView 本身 children = []（不内嵌模板节点）

### 命名约定

| 用途 | session 文件名 |
|------|--------------|
| 背包物品格 | agItem_entry.session |
| 快捷栏槽位 | eltSlot_entry.session |
| 技能列表行 | skillRow_entry.session |

### widgetProps 示例

`json
{
  "entryWidth": 62,
  "entryHeight": 62,
  "entryClass": "bagItem_entry"
}
`

### ❌ 旧做法（已废弃）

- 在 TileView.children 内放 isEntryClass: true 节点（bag7/bag8 已废弃）
---

## 十四、TileView / ListView 预览数量（gridPreviewNum）规则

`gridPreviewNum` 控制 canvas-editor 在设计时渲染的占位格子数量，**必须与容器实际容量精确匹配**。

### 计算公式

```
cols = floor((containerW + gapX) / (entryW + gapX))
rows = floor((containerH + gapY) / (entryH + gapY))
gridPreviewNum = cols × rows
```

> **变量说明**
> - `containerW / containerH`：TileView 节点的 `w / h`（像素）
> - `entryW / entryH`：`widgetProps.entryWidth / entryHeight`（每格尺寸）
> - `gapX / gapY`：`widgetProps.placeHolder.x / .y`（格间距，默认 0）

### 标准示例

| TileView 用途     | 容器尺寸    | 格尺寸    | 间距         | 公式                                              | gridPreviewNum |
|------------------|-------------|-----------|--------------|---------------------------------------------------|----------------|
| invGrid（背包7×7）| 472 × 472   | 62 × 62   | gapX=4, gapY=4 | cols=floor(476/66)=7, rows=7                     | **49**         |
| beltQuick（快捷8格）| 592 × 44  | 66 × 44   | gapX=8, gapY=0 | cols=floor(600/74)=8, rows=1                     | **8**          |
| ListView 一列示例 | 200 × 320   | 200 × 40  | gapX=0, gapY=2 | cols=1, rows=floor(322/42)=7                    | **7**          |

### 强制规则

- **禁止**：`gridPreviewNum` 留默认值 4（系统默认），必须按公式计算后显式填写
- **禁止**：随意填写（如 10、100），需与真实容量一致
- `placeHolder` 字段存储间距，格式为 `{ "x": gapX, "y": gapY }`
- 如使用外部 EntryClass（`widgetProps.entryClass` 为路径），TileView 第一格显示 entryClass 名称 badge

### widgetProps 模板

**TileView（背包格 7×7）：**
```json
{
  "entryWidth":  62,
  "entryHeight": 62,
  "gridPreviewNum": 49,
  "entryClass": "bagItem_entry",
  "placeHolder": { "x": 4, "y": 4 }
}
```

**ListView（技能列表 8行）：**
```json
{
  "entryWidth":  280,
  "entryHeight": 36,
  "gridPreviewNum": 8,
  "entryClass": "skillRow_entry",
  "placeHolder": { "x": 0, "y": 2 }
}
```

---

## 十五、TileView / ListView 预览数据规则

canvas-editor 支持两种方式为 TileView/ListView 提供模拟填充数据，**优先级：uidata > session previewData**。

### 方式一（推荐）：uidata 的 `items` 字段

在对应的 `.uidata` 文件中，TileView 节点的 `data.items` 数组即为预览数据。这是与游戏运行时数据结构最接近的方式。

```json
// bag11.uidata — invGrid 节点
{
  "id": "invGrid",
  "data": {
    "items": [
      { "icon": "sword_iron",   "count": 1, "rarity": "common"   },
      { "icon": "potion_red",   "count": 5, "rarity": "common"   },
      { "icon": "bow_short",    "count": 1, "rarity": "uncommon" }
    ]
  }
}
```

beltQuick 额外支持 `key` 字段（快捷键标注，显示在格子左上角）：

```json
{ "icon": "potion_red", "count": 5, "key": "1" }
```

### 方式二（session 内嵌）：widgetProps 的 `previewData` 字段

当没有 `.uidata` 文件时，可在 `widgetProps` 中内嵌 `previewData`：

```json
"previewData": [
  { "icon": "assets/preview/sword.png", "count": "1",  "rarity": "rare"   },
  { "icon": "assets/preview/helm.png",  "count": "1",  "rarity": "magic"  },
  { "icon": "",                          "count": "",   "rarity": "normal" }
]
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `icon` | string | 图标标识或路径；空字符串 = 空槽（不显示） |
| `count` | number/string | 数量；≤1 或空字符串不显示数量标注 |
| `rarity` | string | 品质，见下表 |
| `key` | string | （仅 beltQuick）快捷键，显示在格子左上角 |

### 品质颜色映射

| rarity | fillColor（游戏实际色） | canvas-editor 预览背景 | canvas-editor 预览边框 | 含义 |
|--------|----------------------|----------------------|----------------------|------|
| `normal` | `#3a3025` | `rgba(40,40,40,0.85)` | `#555` | 普通（暗棕） |
| `magic`  | `#1a2a4a` | `rgba(10,30,60,0.88)` | `#4477cc` | 魔法（深蓝） |
| `rare`   | `#3a3000` | `rgba(50,42,0,0.88)`  | `#ccaa00` | 稀有（暗金） |
| `unique` | `#4a2800` | `rgba(60,30,0,0.88)`  | `#cc6600` | 传奇（深橙） |
| `set`    | `#003a00` | `rgba(10,50,20,0.88)` | `#22aa44` | 套装（深绿） |

### canvas-editor 预览模式渲染行为（2026-03 实现）

进入 **预览模式（P）** 后，`renderTileViewGrid` 会读取 `previewData`：

- **有 previewData 的格子**：按品质色渲染背景和边框；若 `icon` 不为空则显示图标；`count > 1` 在右下角显示数量
- **无对应数据的格子**（i ≥ previewData.length）：回退为空槽样式（虚线边框+半透明）
- **退出预览模式**：全部回退为空槽占位样式
- 图标路径不存在时静默隐藏（不显示 broken image）

### 强制规则

- `previewData.length` **必须 ≤ `gridPreviewNum`**（不允许超出格子数量）
- **空槽**：用 `{ "icon": "", "count": "", "rarity": "normal" }` 或直接省略尾部条目（省略 = 空槽）
- `previewData` **整体省略**时：canvas-editor 按 entryClass 模板渲染所有空槽，不报错
- `rarity` 省略时：默认使用 `normal` 颜色

### 标准示例（invGrid 7×7 背包格）

```json
"widgetProps": {
  "entryWidth":    62,
  "entryHeight":   62,
  "gridPreviewNum": 49,
  "entryClass":    "bagItem_entry",
  "placeHolder":   { "x": 4, "y": 4 },
  "previewData": [
    { "icon": "assets/preview/sword.png",   "count": "1", "rarity": "rare"   },
    { "icon": "assets/preview/helm.png",    "count": "1", "rarity": "magic"  },
    { "icon": "assets/preview/chestplate.png", "count": "1", "rarity": "unique" },
    { "icon": "assets/preview/boots.png",   "count": "1", "rarity": "normal" },
    { "icon": "assets/preview/ring.png",    "count": "1", "rarity": "rare"   },
    { "icon": "assets/preview/potion_hp.png","count": "5", "rarity": "normal" },
    { "icon": "assets/preview/potion_mp.png","count": "3", "rarity": "normal" }
  ]
}
```

> 其余 42 个格子省略 = 空槽，不需要显式填写。

### 标准示例（beltQuick 快捷8格）

```json
"widgetProps": {
  "entryWidth":    66,
  "entryHeight":   44,
  "gridPreviewNum": 8,
  "entryClass":    "beltSlot_entry",
  "placeHolder":   { "x": 8, "y": 0 },
  "previewData": [
    { "icon": "assets/preview/potion_hp.png", "count": "5", "rarity": "normal" },
    { "icon": "assets/preview/potion_mp.png", "count": "3", "rarity": "normal" },
    { "icon": "assets/preview/scroll.png",    "count": "2", "rarity": "magic"  },
    { "icon": "",                              "count": "",  "rarity": "normal" }
  ]
}
```

### ListView previewData 字段扩展

ListView 行数据（如技能列表）使用相同 `previewData` 格式，但字段含义扩展：

| 字段 | ListView 含义 | 示例 |
|------|-------------|------|
| `icon` | 技能图标 | `"assets/skills/fireball.png"` |
| `count` | 等级标注 | `"Lv.5"` |
| `rarity` | 技能类型色 | `"magic"` |

---

## 十六、装备槽层级规范（paperdollPanel）

**RPG 背包 UI 中，所有装备槽节点必须放置在 `paperdollPanel.children` 内，严禁挂到根 `boxes` 数组。**

### 标准层级结构

```
bagWidget (根节点 ✅)
  ├── titleBar
  ├── statPanel
  ├── paperdollPanel
  │    ├── paperdollBody (Image — 纸娃娃体轮廓占位图)
  │    ├── equipTitle (TextBlock)
  │    ├── equipDiv   (CanvasPanel — 分隔线)
  │    ├── headSlot   (CanvasPanel)
  │    ├── neckSlot   (CanvasPanel)
  │    ├── weaponSlot (CanvasPanel)
  │    ├── chestSlot  (CanvasPanel)
  │    ├── offhandSlot (CanvasPanel)
  │    ├── gloveSlot  (CanvasPanel)
  │    ├── equipBeltSlot (CanvasPanel)
  │    ├── ringLSlot  (CanvasPanel)
  │    ├── ringRSlot  (CanvasPanel)
  │    ├── legSlot    (CanvasPanel)
  │    ├── amuletSlot (CanvasPanel)
  │    └── bootSlot   (CanvasPanel)
  ├── invPanel
  │    └── invGrid (TileView)
  └── beltPanel
       └── beltQuick (TileView)
```

> 根节点只允许 `bagWidget`（唯一顶层容器），其余全部通过 children 嵌套。

### paperdollBody 规范

`paperdollPanel` 的第一个子节点必须是 `paperdollBody`（Image）用于放置人体轮廓图：

```json
{
  "id": "paperdollBody",
  "widgetType": "Image",
  "widgetProps": {
    "imagePath": "",
    "tintColor": "#8a6040",
    "imageDrawType": "Normal"
  }
}
```

- `imagePath` 默认空字符串（设计阶段占位），运行时由游戏绑定实际角色轮廓图
- `tintColor` 使用暗金色 `#8a6040` 作为占位着色

### ❌ 历史错误（已修复）

- bag9.session（及更早版本）中，12个装备槽作为根节点，与 `bagWidget` 并列 → **已在 bag11.session 修复**
- 根节点从 13 个减少到 1 个（仅 `bagWidget`）