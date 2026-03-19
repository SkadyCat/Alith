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