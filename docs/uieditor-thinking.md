# UIEditor Thinking — UI 编辑器设计思维规范

> **目的**：记录在使用 canvas-editor 设计 UI 时出现的设计思维问题，建立规范，避免重蹈覆辙。
> **维护方式**：每次发现新的设计误区，追加一个条目。

---

## 核心原则

1. **语义优先**：选择能表达设计意图的控件类型，而不是"能实现视觉效果就行"
2. **专控专用**：有专用控件的需求，不使用通用控件拼凑替代
3. **可维护性**：控件结构应让接手者一眼看懂用途，而不是靠命名猜测
4. **编辑器友好**：选用编辑器有属性支持的控件，可以在 props 面板直接配置，而不是手动调 CSS 数值

---

## 问题记录

### ❌ 问题 #1：用嵌套 Border 模拟进度条

**发现时间**：2026-03-13  
**触发场景**：bag2.session — 背包界面重量指示条

**错误设计**：

```
WeightBG  (Border, w=188, h=24)      ← 背景
  └─ WeightFill (Border, w=94, h=24) ← 填充，手动设为 50% 宽度
```

**问题分析**：
- 两个 Border 嵌套本质上是在模拟一个进度条（background + fill 结构）
- WeightFill 的宽度需要手动写死（94px），无法表达"当前重量/最大重量"的语义
- 在编辑器中看起来像两个独立的普通容器，维护者需要通过命名猜测其用途
- 如果后续要动态改变填充比例，需要操作 DOM 宽度，而不是设置 `Percent` 属性

**正确设计**：

```
WeightBar (ProgressBar, w=188, h=24)
  └─ 使用 ProgressBar 控件，设置 Percent 属性（0.0 ~ 1.0）
```

**规则**：
> 任何「背景 + 填充色块」结构，若表达的是一个百分比/进度，**必须使用 `ProgressBar` 控件**，而非嵌套 Border。

**canvas-editor 已有 `ProgressBar` 控件类型**（属于图像类），直接可用。

---

### ✅ 修复记录 #2：root 级 EntryClass 不应显示金色实线边框

**发现时间**：2026-03-13  
**触发场景**：bag2.session — BagWidget (CanvasPanel) 被标记 `isEntryClass: true` 后，全身出现 `2px solid #f5c542` 实线描边（"很粗的边框"）

**根本原因**：
- `isEntryClass: true` 有两个用场：①作为 TileView/ListView 的模板（locked）②用于在画布根节点标识 EntryClass 画布
- 旧代码在 `renderBox` 的 `else` 分支对所有 `isEntryClass=true` 且非 locked 的 box 加 `2px solid #f5c542` 实线框
- root 级别（没有 TileView 父节点）的 CanvasPanel 进入了这个 else 分支 → 整个面板包了一层实线金框

**修复**：
```js
// 修改前 (app.js ~line 943)
el.style.outline = box.isEntryClass ? '2px solid #f5c542' : '';

// 修改后：else 分支统一清空 outline
el.style.outline = '';
el.style.outlineOffset = '';
el.style.cursor = '';
el.style.pointerEvents = '';
```

**规则**：
> 只有在 TileView/ListView/TreeView 内（`isLockedEntryClass = true`）的 EntryClass 才应显示虚线金色指示框。
> root 级别或孤立的 `isEntryClass` box 不加任何特殊描边。

---

### ✅ 修复记录 #3：初次加载 session 不自动 Zoom-to-Fit

**发现时间**：2026-03-13  
**触发场景**：刷新页面或首次打开编辑器时，画布内容不居中/不适配视口；但通过文件浏览器加载 session 会自动居中

**根本原因**：
- `loadSession()`（初始化时调用）未调用 `zoomToFit()`
- `loadSessionFile()`（文件浏览器点击时调用）调用了 `requestAnimationFrame(() => zoomToFit())`
- 行为不一致 → 某些操作（如进入 EntryClass 编辑后退出）触发 `zoomToFit()` 显得像"点击后自动居中"

**修复**：在 `loadSession()` 成功分支加上：
```js
if (boxes.length > 0) requestAnimationFrame(() => zoomToFit());
```

**规则**：
> 任何「加载 session 并 renderAll」的路径，后必须跟一个 `requestAnimationFrame(() => zoomToFit())` 保证视口适配内容。

---

### ✅ 修复记录 #4：返回主画布后视口不自动适配内容

**发现时间**：2026-03-13  
**触发场景**：双击 TileView 控件 → 进入 EntryClass 编辑模式（视口自动 zoomToFit）→ 点击"← 返回主画布" → 视口**不**适配，画布显示偏移

**根本原因**：
- `openEntryClassInCanvas()`（进入 EntryClass）：在 `renderAll()` 后调用了 `requestAnimationFrame(() => zoomToFit())` ✅
- `_returnToParentCanvas()`（返回主画布）：只调用了 `renderAll()`，**未调用 `zoomToFit()`** ❌
- 行为不一致 → 进入时居中，返回后不居中

**修复**：在 `_returnToParentCanvas()` 的 `renderAll()` 后追加：
```js
requestAnimationFrame(() => zoomToFit()); // Re-fit viewport after returning to parent canvas
```

**规则**：
> 任何切换画布上下文（进入 EntryClass / 返回主画布 / 加载 session）的操作，**都必须在 `renderAll()` 后调用 `requestAnimationFrame(() => zoomToFit())`**，保证视口始终适配内容。

---

### ✅ 修复记录 #5：初始加载 session 时 zoomToFit 时机不对

**发现时间**：2026-03-13  
**触发场景**：刷新页面后，`loadSession()` 调用 `zoomToFit()`，但 DOM 尚未完全渲染（单 RAF 不够），导致适配计算偏差

**根本原因**：
- 单 `requestAnimationFrame(() => zoomToFit())` 可能在浏览器第一帧布局还未 settle 时就运行
- 双击 EntryClass 触发的 `zoomToFit()` 在用户交互后运行，此时 DOM 已 settle，因此成功

**修复**：将 `loadSession()` 中的单 RAF 改为双 RAF：
```js
// 修改前
if (boxes.length > 0) requestAnimationFrame(() => zoomToFit());

// 修改后
if (boxes.length > 0) requestAnimationFrame(() => requestAnimationFrame(() => zoomToFit()));
```

**规则**：
> 在初始化（页面加载）阶段调用 `zoomToFit()` 时，**必须用双 RAF**（`requestAnimationFrame(() => requestAnimationFrame(() => zoomToFit()))`）确保 flexbox/scroll 布局已 settle。用户交互触发的 `zoomToFit()` 使用单 RAF 即可。

---

### 💡 行为记录 #6：borderWidth 默认值为 2，导致设计好的 session 出现"粗框"

**发现时间**：2026-03-13  
**触发场景**：用代码批量创建 bag2.session 后，编辑器打开显示所有控件都有明显的 2px 描边

**根本原因**：
- `createBox()` 中 `borderWidth: 2` 是硬编码默认值
- 代码生成 session 时，如果不显式设置 `borderWidth: 0`，所有控件都带 2px 边框

**规则**：
> **代码生成 session JSON 时**，对装饰性/容器类控件（Border/CanvasPanel/Image）必须显式设置 `borderWidth: 0`。  
> 只有以下情况保留边框：
> - UI 外框容器（如主面板 BagWidget），设 `borderWidth: 1~2` + 品质金色
> - 功能性数值条（ProgressBar/WeightBar），设 `borderWidth: 1`
> - 明确需要可见分割线的 Divider（h=1 Border）

---

### 💡 行为记录 #7：P 键预览模式只影响布局容器类

**发现时间**：2026-03-13  
**触发场景**：在 bag2.session 中按 P 键，看不到明显变化

**根本原因**：
- `togglePreviewMode()` 只隐藏 `INVISIBLE_CONTAINER_TYPES` 的边框/背景：
  `CanvasPanel / HorizontalBox / VerticalBox / GridPanel / UniformGridPanel / WrapBox / Overlay / SizeBox / ScaleBox`
- `Border` 类型控件**不受预览模式影响**（它的边框和背景是设计意图，不是布局辅助线）
- bag2.session 的主要面板（EquipPanel/InvPanel/StatPanel/BottomBar）都是 `Border` 类型

**规则**：
> P 键预览仅针对 UE4 UMG 中"本身不可见"的布局容器。如果希望看到"无布局框"效果，要把面板改为 CanvasPanel 而非 Border。

---

### 💡 行为记录 #8：TextBlock 叠在 ProgressBar 上显示数值 — 这是合法的设计模式

**发现时间**：2026-03-13  
**触发场景**：bag2.session — HPText 与 HPBar 坐标完全相同，WeightValue 与 WeightBar 几乎重叠

**表象**：  
在 canvas-editor 层级面板里可以看到 TextBlock 和 ProgressBar 共享相同的 x/y/w，视觉上显示为两个控件"重叠"。

**本质**：  
这是正确的「**进度条数值叠层**」模式——ProgressBar 作为背景条，TextBlock 以相同坐标浮在上方显示如 `500/1000` 的文字。UMG/UE4 中这是标准做法（Canvas Panel 的绝对叠层）。

**正确结构**（以血量条为例）：
```
HPGroup (CanvasPanel, x=36, y=514, w=200, h=22)
  ├─ HPBar    (ProgressBar, x=36, y=518, w=200, h=14)   ← 在下
  └─ HPText   (TextBlock,   x=36, y=514, w=200, h=22)   ← 在上，居中显示
```

**规则**：
> ProgressBar + TextBlock 共处同一区域是**刻意叠层**，不是布局错误。
> 可以在 canvas-editor 中通过选择不同节点来分别编辑它们。
> 如果觉得难以选中底层的 ProgressBar，可以在 Hierarchy 面板点选。

**检查点**：叠层控件的 z-order（在层级中的顺序）决定谁在上：列表靠后的元素渲染在更高层。

---

### 📋 待归纳模式（发现时持续追加）

| 误用模式 | 正确控件 | 备注 |
|---------|---------|------|
| 两个嵌套 Border 模拟进度条 | ProgressBar | 见问题 #1 |
| 多个 TextBlock 叠加显示富文本 | 单个 TextBlock（RichText） | 待验证 |
| 多个 Image 叠加做背景+前景 | Border + Image / CanvasPanel | 视情况而定 |

---

### ❌ 问题 #2：初次加载后画布视口未自动居中

**发现时间**：2026-03-13  
**触发场景**：打开 session 后，内容偏在左上角，点击某些控件才"看起来居中"

**根本原因分析**：

原来的 `zoomToFit()` 只做了 `scale()` 变换，试图用 `scrollLeft/scrollTop` 平移视口，但 `#canvas-viewport` 是 `overflow: hidden`，所以滚动代码完全无效，内容始终从 `(0,0)` 开始渲染，大坐标的控件就会跑到屏幕外。

**正确设计**：

使用 `translate(panX, panY) scale(zoom)` 组合变换来实现"平移+缩放"，而不依赖 `scrollLeft/scrollTop`：

```
// 将内容中心对齐视口中心
panX = vpW / 2 - contentCenterX * zoom
panY = vpH / 2 - contentCenterY * zoom
canvasRoot.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`
```

**附带改进**：
- `Ctrl+Wheel` 现在以光标为圆心缩放（而不是左上角）
- `+` / `-` 按钮以视口中心为圆心缩放
- 按 `F` 键可随时重新执行 Fit-to-viewport
- 按住 `Space` + 拖拽，或中键拖拽，可自由平移画布

**规则**：
> canvas 视口内容居中/平移，**必须使用 CSS translate + scale 组合**，而非依赖 overflow 容器的 scrollLeft/scrollTop。

---

## 设计检查清单（提交 session 前自查）

- [ ] 是否有「背景 + 填充」结构 → 应改为 ProgressBar
- [ ] 是否有只放一张图的 Border → 可能直接用 Image 更清晰
- [ ] 是否有高度为 1px 的 Border → 分隔线，命名应包含 Divider/Sep/Line
- [ ] EntryClass 内部是否使用了正确的 `isEntryClass: true` 标记
- [ ] 是否有 label 与 widgetType 语义不符的控件（如 label=Button 但 widgetType=Border）
- [ ] Session 加载后内容是否居中？→ 按 F 键重新触发 Fit-to-viewport
- [ ] 代码生成的 session：装饰性控件是否显式设置了 `borderWidth: 0`？
- [ ] 切换画布上下文的操作路径是否都有 `requestAnimationFrame(() => zoomToFit())`？

---

## 相关工具速查

| 需求 | 控件类型 |
|-----|---------|
| 进度/血量/重量条 | `ProgressBar` |
| 容器/背景/装饰框 | `Border` |
| 图标/背景图 | `Image` |
| 绝对布局面板 | `CanvasPanel` |
| 列表（TileView 模板） | `TileView` + EntryClass |
| 分隔线 | `Border`（h=1 或 w=1） |
| 可点击按钮 | `Button` |
| 文字显示 | `TextBlock` |


---

## 问题 #3 — TileView/EntryClass 坐标一致性与超框问题

**问题描述**：
TileView（ItemGrid）里面的 EntryClass ghost tiles 超出 ItemGrid 范围渲染。

**根本原因**：
1. `renderTileViewGrid` 只检查了底部溢出 (`ty + itemH > box.h + 2 → break`)，没有检查左右溢出
2. 所有 box 使用**绝对画布坐标**，EntryClass 若与 ItemGrid 坐标不一致（偏移计算出现负数），会导致 tiles 从负位置渲染

**修复方案**：
- `renderTileViewGrid` 增加左右检查：`if (tx < 0 || tx + itemW > box.w + 2) continue;`
- EntryClass 必须位于 TileView 内部（坐标需在 TileView 的 [x, x+w) × [y, y+h) 范围内）

**规范**：
- TileView 的 EntryClass 应始终从 TileView 原点偏移 **+8px** 以上（避免与外框重叠）
- 坐标公式：`EntryClass.x = TileView.x + inset`，`EntryClass.y = TileView.y + inset`（inset ≥ 8）
- EntryClass 的**所有子节点**必须使用相同的绝对坐标基准（从 EntryClass.x/y 出发）
- 不应让 startX 或 startY 为负数（意味着 EntryClass 超出了 TileView 左/上边界）

**✅ 检查清单**（设计 TileView 时）：
- [ ] EntryClass.x >= TileView.x + 8
- [ ] EntryClass.y >= TileView.y + 8
- [ ] EntryClass + size 在 TileView 内部：EntryClass.x + w <= TileView.x + TileView.w
- [ ] EntryClass 的子节点坐标 >= EntryClass.x/y（不能"超出"EntryClass 边界）
