# UiData 侧边栏更新

## 完成时间
2026-03-19

## 任务1：侧边栏解开下限制
- 移除 `#sidebar-doc-list` 的 `min-height: 60px` 和 `border-bottom` CSS 限制
- 为 `.sb-children` 添加明确的 `max-height: none` 确保子项无高度限制

## 任务2+3：UiData 数据文件夹系统
- `.uidata` 文件夹已位于 `data/docs/uidata/`（与 `sessions/` 同级）✓
- 服务器 `/api/uidata/*` 和 `/api/uidatas` 接口已存在 ✓
- `bag9.uidata` 示例文件已存在 ✓

## 新增功能（app.js）
1. **loadTree** 合并 uidata 文件：调用 `/api/uidatas` 获取 uidata 文件列表，注入到 uidata 文件夹节点中
2. **renderSidebarTree**：`.uidata` 文件用 `🗄` 图标显示（紫色），点击加载对应 session + uidata 并打开编辑器
3. **uidata 文件夹右键菜单**：新增「为当前画布创建/更新 UiData」选项
4. **openDoc**：`.uidata` 文件以原始 JSON 模式显示

## 数据流
`.uidata` 文件 → 点击 → `loadUiData(name)` → 加载对应 session → `showUidataEditor()` → 预览模式中数据覆盖 widgetProps
