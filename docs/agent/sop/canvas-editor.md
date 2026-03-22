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

## Session 生成规范

**生成或改写 session 文件时，必须遵守以下规则：**

1. **节点必须放在正确父容器下**，禁止追加到根 `boxes` 数组（除非是顶层容器）
2. **替换节点流程**：先找原节点 → 找其父容器 → 在父容器 `children` 中替换，不得挂到根
3. **生成后必须验证**：
   ```powershell
   # 验证根节点数量是否合理（通常只有 1~2 个）
   $data.boxes.Count  # 期望值: 1~3
   # 验证目标节点在正确父容器下
   $parent.children | Where-Object { $_.id -eq "targetId" }
   ```
4. **生成代码模板**（替换节点时）：
   ```powershell
   # 找父容器
   function Find-NodeById($nodes, $id) {
       foreach ($n in $nodes) {
           if ("$($n.id)" -eq $id) { return $n }
           if ($n.children) { $r = Find-NodeById $n.children $id; if ($r) { return $r } }
       }
   }
   # 在父容器 children 中替换，不追加到 $data.boxes
   $parent = Find-NodeById $data.boxes "beltPanel"
   $parent.children = @($parent.children | Where-Object { "$($_.id)" -ne "oldId" }) + @($newNode)
   ```

---

## 常见 Bug 模式

1. **点击后才居中**：renderWidgetContent 读取 widgetProps 时 key 未定义，回退到 prop 键名而非默认值 → 修复：渲染前先初始化 defaults
2. **位置交叉/重叠**：.box-item 用 border 导致 min-height/border 撑大 → 修复：改用 outline（不影响 layout）
3. **P 键预览无效**：CSS outline 仍然显示 → 修复：预览模式下 inline style outline:none
4. **节点名混乱**：层级面板显示 label → 修复：移除 li.innerHTML 中的 `${box.label}` span，tooltip(li.title) 保留完整信息，选中时 right_info 顶部 p-label 输入框显示
| public/app.js | renderLayers(): hierarchyList + layerList 显示 nodeName (typeName)，选中后 scrollIntoView |
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

| public/app.js | parseBoxId() 修复字符串 ID 选中：+el.id.replace → parseBoxId，支持语义化 ID（如 titleBar）|

| public/app.js | hierarchyList 右键菜单：showSimpleCtxMenu 全局函数 + contextmenu 事件，支持复制节点信息(JSON)/位置/ID |

| public/app.js + index.html | 批量控件按钮 openBatchCreateDialog()：TileView/ListView 快速创建对话框，支持项目数/尺寸/列数/间距，自动生成 EntryClass |

| data/docs/sessions/bag3.session | bag2 迭代版：PotSlot1-4 替换为 BeltQuick TileView（8格，每格32×32，间距4px，gridPreviewNum=8）；HP/MP bar 压缩至160px；ExpBar 右移至x=726 |

| data/docs/sessions/bag4.session | bag3_before_textfix 迭代：49个InvSlot00-66→InvGrid TileView(7×7,62×62,gap4)；BeltQuick1-8+BeltNum1-8→BeltQuick TileView(8格,66×44,gap8) |

| bag4.session textfix | 将所有 widgetType:Label 改为 widgetType:TextBlock（45处）；ui创建规范.md 新增文本控件规范章节 |

| data/docs/sessions/bag5.session | bag4 修复：BeltQuick(id=1002) 从根节点移入 beltPanel.children |
| data/docs/sessions/bag6.session | bag5 规范修复：BeltQuick(id=1002) 正确移入 beltPanel.children（首位），不再挂根节点；根节点仅 bagWidget+closeBtn |
| data/docs/sessions/bag6.session | bag5 层级规范化：1002 BeltQuick→beltPanel.children（首位）；lvLabel/lvValue→titleBar.children；closeBtn→titleBar.children；根节点由3减为1（仅bagWidget） |
| data/docs/sessions/bag7.session | 全新背包（从零构建）：80节点，所有 ID 语义化字符串，无 null widgetType（纯容器用 CanvasPanel），TextBlock props 规范（textColor/textAlign/bold），beltQuick TileView 正确在 beltPanel.children 内，根节点仅 bagWidget+closeBtn |
| data/docs/sessions/bag8.session | bag7 迭代：TileView EntryClass 完整化：CanvasPanel(isEntryClass) → SizeBox(widthOverride/heightOverride) → Overlay → [Border(bg), Image(icon), TextBlock(count/key)]；invGrid 3子节点，beltQuick 4子节点 |
| data/docs/sessions/bag8.session | bag7 迭代：InvGrid+BeltQuick 两个 TileView 添加完整 EntryClass（SizeBox→Overlay→[Background/Icon/ItemCount]）；遵循 UMG 规范：SizeBox 固化大小，Overlay 叠加容器，Background(Border)+Icon(Image)+ItemCount(TextBlock) |
| EntryClass 设计规范 | 每个 TileView 的 EntryClass 必须：① widgetType=SizeBox（固化 w/h）② 内含 Overlay ③ Overlay 子节点：Background(Border) + Icon(Image) + ItemCount(TextBlock)。ItemCount 置于右下角(x=parent.x+w-22, y=parent.y+h-14) |
| entryclass/InvSlotEntry.session | 背包格 EntryClass（62×62）：SizeBox→Overlay→[Background(Border)+Icon(Image)+ItemCount(TextBlock)] |
| entryclass/BeltSlotEntry.session | 快捷格 EntryClass（66×44）：SizeBox→Overlay→[Background(Border)+Icon(Image)+ItemCount(TextBlock)] |
| data/docs/sessions/bag9.session | bag7 迭代：TileView widgetProps 添加 entryClass 字段引用独立 EntryClass.session 文件（invGrid→entryclass/InvSlotEntry, beltQuick→entryclass/BeltSlotEntry），无 inline children |
| EntryClass 引用规范 | TileView/ListView 的 EntryClass 必须独立为 entryclass/*.session，通过 widgetProps.entryClass 引用路径。不得内嵌在 TileView children 中。 |
| data/docs/sessions/bag9.session | bag8 架构升级：EntryClass 独立为外部 session 文件（bagItem_entry.session / beltSlot_entry.session），TileView 通过 widgetProps.entryClass 引用；elements.json TileView/ListView 新增 entryClass prop |
| data/docs/sessions/bag10.session | bag9 架构修正：12个装备槽从根节点移入 paperdollPanel.children；根节点减至1个（仅bagWidget），符合层级规范 |
| data/docs/sessions/bag11.session | bag10 迭代：paperdollPanel 新增 paperdollBody(Image) 占位体轮廓；TileView gridPreviewNum 按公式验证（invGrid=49, beltQuick=8） |
| ui创建规范 §十四 | 新增 TileView/ListView 预览数量规则：gridPreviewNum = cols×rows，提供计算公式与三个标准示例 |
| data/docs/sessions/bag11.session | bag11 迭代（previewData）：invGrid + beltQuick TileView 添加 widgetProps.previewData 模拟数据（invGrid=7项, beltQuick=4项），字段格式：icon/count/rarity |
| ui创建规范 §十五 | 新增 TileView/ListView 预览数据规则：previewData 数组格式、字段映射（icon→Image.src, count→TextBlock.text, rarity→品质颜色映射表）、强制规则与 invGrid/beltQuick/ListView 三个标准示例 |
| app.js renderTileViewGrid | 实现 previewData 渲染：预览模式下按 rarity 显示品质背景色+边框，icon 显示图标，count>1 右下角标注数量，超出 previewData.length 的格子回退为空槽样式 |
| ui创建规范 §十五 | 补充 canvas-editor 预览颜色映射表（RARITY_BG/RARITY_BORDER）与渲染行为说明，与游戏实际 fillColor 并列标注 |
| uidata/bag11.uidata | 基于 bag10.uidata 创建 bag11 对应的 uidata；paperdollPanel 新增 paperdollBody 子节点（imagePath:""）；保留全部装备槽图标数据 |
| app.js renderTileViewGrid | 修正预览数据读取顺序：uidata.data.items 优先 > session.widgetProps.previewData；新增 rarity 别名映射（common→normal，uncommon→magic）；beltQuick 支持 key 字段左上角快捷键标注 |
| ui创建规范 §十五 | 重写为双模式文档：方式一 uidata.items（推荐）、方式二 session previewData；统一字段说明 |
| bag11.session | 移除 invGrid/beltQuick 的 session 内嵌 previewData（改由 bag11.uidata 提供） |
| data/docs/sessions/bag11.session | bag9→bag11 层级修正：12个装备槽从根节点移入 paperdollPanel.children；paperdollBody(Image) 添加为 paperdollPanel 首个子节点；根节点从13减为1（仅bagWidget）；符合§十六规范 |
| ui创建规范 §十六 | 新增装备槽层级规范：paperdollPanel必须包含paperdollBody+equipTitle+equipDiv+12装备槽，根节点只允许bagWidget；记录bag9历史错误与bag11修复 |
| app.js renderTileViewGrid | Bug修复：函数头部添加 uidata 合并（`Object.assign({}, box.widgetProps, _uidataMap[box.id])`），使 uidata.data.items 能正确传递到预览渲染层 |
| app.js renderBox | Bug修复：TileView/ListView 共用条件扩展为 `widgetType === 'TileView' \|\| widgetType === 'ListView'`，ListView 现在也会调用 renderTileViewGrid |
| assets/icons/paperdoll_body.svg | 新增人体轮廓 SVG：半透明暗金色剪影，用于 paperdollPanel 纸娃娃区域占位体轮廓图 |
| data/docs/sessions/bag11.session | 完善预览效果：paperdollBody 居中（x=270,w=140,h=280）并绑定 paperdoll_body.svg；12个装备槽_icon 绑定 /assets/icons/slots/*.svg |
| data/docs/uidata/bag11.uidata | 完善预览数据：invGrid 7项物品绑定真实 icon 路径（sword/health/mana/shield/bow/arrow/scroll）；beltQuick 4项绑定 icon 路径+key+rarity；装备槽_icon 绑定 /images/bag/equip_*.png |
| app.js renderBox | 新增 uidata bgImage 覆盖：预览模式下 _uidataMap[box.id].bgImage 优先于 box.bgImage，编辑模式保持干净无背景图 |
| data/docs/uidata/bag11.uidata | 新增各主面板 bgImage：bagWidget→bag_background.png，statPanel/paperdollPanel/invPanel/beltPanel 各绑定对应 bg_*.png，仅在预览模式生效 |

| data/docs/sessions/bag11.session | 层级规范修复：12个装备槽从根节点移入 paperdollPanel.children；根节点从13减为1（仅bagWidget）；保留现有 uidata 绑定数据 |
| app.js renderBox | 预览模式 bgImage 修复：_uidataMap 覆盖 bgImage，CanvasPanel 有 bgImage 时不再强制 transparent；_activeBgImage = _bgImageOverride || box.bgImage |
| app.js renderWidgetContent TextBlock | TextBlock 动态 padding：min(4,floor(h*0.1))px vertical / min(6,floor(w*0.05))px horizontal；fontSize 上限 min(size,(h-padV*2)*0.9)，避免 mpLabel(h=14) 等矮盒文字超框 |
