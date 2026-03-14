# Canvas Editor 修改规范 SOP

## 关键架构

- **坐标系**：所有 box 使用绝对坐标 (x,y,w,h)，parent-child 仅表示层级关系，不做坐标变换
- **渲染模型**：renderAll() → renderBox(box) → renderWidgetContent(box, el, def)
- **CSS 层次**：CSS class 用 outline（不影响 layout），JS inline 用 border（设计属性）
  - box-sizing: border-box → 设计 border 在内部，w/h = 精确外边界
  - .box-item 默认 outline: transparent，hover 显示淡紫虚线，selected 显示实线
- **widgetProps 初始化**：renderBox 中在 renderWidgetContent 之前先填充缺失 defaults，避免首次渲染对齐错误
- **预览模式 (P键)**：INVISIBLE_CONTAINER_TYPES (CanvasPanel等) 在预览模式下 border→thin dashed，outline→none

## 已修改文件

| 文件 | 修改内容 |
|------|---------|
| public/app.js | 层级面板隐藏 label，只显示 icon+(类型)#id，label 保留在 tooltip(hover) |
| public/app.js | renderBox 前置 widgetProps defaults 初始化，解决首次渲染对齐错误 |
| public/app.js | 预览模式对 INVISIBLE_CONTAINER_TYPES 额外 outline:none |
| public/style.css | .box-item 从 border 改 outline，box-sizing:border-box，overflow:hidden |
| data/docs/sessions/bag2.session | POE/Diablo 风格背包，53 节点，nextId=54 |
| public/app.js | renderLayers() layerList 分支：隐藏 box.label，改为 icon+(typeZh)，tooltip=label (type) #id |

## 常见 Bug 模式

1. **点击后才居中**：renderWidgetContent 读取 widgetProps 时 key 未定义，回退到 prop 键名而非默认值 → 修复：渲染前先初始化 defaults
2. **位置交叉/重叠**：.box-item 用 border 导致 min-height/border 撑大 → 修复：改用 outline（不影响 layout）
3. **P 键预览无效**：CSS outline 仍然显示 → 修复：预览模式下 inline style outline:none
4. **节点名混乱**：层级面板显示 label → 修复：移除 li.innerHTML 中的 `${box.label}` span，tooltip(li.title) 保留完整信息，选中时 right_info 顶部 p-label 输入框显示
| public/app.js | openAssetsPanel(): 扫描所有 boxes 的 bgImage/widgetProps.*，找出 URL 型资源，分组展示（含图片预览、复制按钮、引用位置标签） |
| public/index.html | 移除重复按钮，保留唯一 #btn-assets，调用 openAssetsPanel()，移除无效的 #btn-resources 和 showResourcesPanel() 引用 |
| data/docs/sessions/bag2.session | 全新 RPG 背包布局（136节点）：TitleBar+StatPanel+EquipPanel(12装备槽)+InvPanel(7×7网格)+BeltPanel |

## RPG 背包布局规范

参见 `docs/design/rpg-bag-ui.md`，核心原则：
- **纸娃娃居中**：装备槽围绕人体轮廓排列（头/胸/腿/武/盾/靴/戒×2/护符）
- **物品栏最大**：右侧最宽区域，7×7=49格，62px每格
- **属性在左**：STR/DEX/INT/VIT + HP/MP/负重/金币条
- **快捷栏底部**：8个快捷格（药水/消耗品）
- **颜色**：极深棕黑背景 `#0a0703`，暗金边框 `#4a3010`，金色标题 `#d4a84b`