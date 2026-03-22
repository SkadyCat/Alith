# TileView/ListView previewData 规则新增 & bag11 更新记录

## 变更内容

### 1. ui创建规范 §十五（新增）
- 文件：docs/session_doc/session-1774176596529/ui创建规范.md
- 新增 §十五：TileView / ListView 预览数据（previewData）规则
- 定义了 widgetProps.previewData 数组格式：字段 icon/count/rarity
- 品质颜色映射表（normal/magic/rare/unique/set）
- 强制规则（previewData.length ≤ gridPreviewNum 等）
- invGrid(7×7)、beltQuick(8格)、ListView 三套标准示例

### 2. bag11.session（更新）
- 文件：pplication/canvas-editor/data/docs/sessions/bag11.session
- invGrid TileView：添加 7 条 previewData（sword/helm/chestplate/boots/ring/potion_hp/potion_mp）
- beltQuick TileView：添加 4 条 previewData（potion_hp×5, potion_mp×3, scroll×2, 空槽）
- 总节点数：102（不变），根节点：1（不变）

### 3. canvas-editor SOP（更新）
- 文件：docs/agent/sop/canvas-editor.md
- 追加两条修改记录

## 迭代链
bag9 → bag10（层级修正）→ bag11（paperdollBody + gridPreviewNum验证 + previewData）