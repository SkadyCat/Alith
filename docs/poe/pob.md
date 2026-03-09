# POB（Path of Building）使用文档

> 最后更新：2026-03-06

---

## 一、简介

**Path of Building（POB）** 是 Path of Exile 最重要的第三方离线构建规划工具，支持：
- 离线天赋树规划
- 技能宝石配置与 DPS 计算
- 装备属性模拟与比较
- 角色导入（通过账号 API）
- Build 分享（base64 编码字符串）

---

## 二、本地安装信息

| 项目 | 内容 |
|------|------|
| 工具名称 | PoeCharm3（中文增强版 POB） |
| 安装路径 | `G:\poegj\PoeCharm3[20251103]-Release-3.5.0` |
| PoeCharm3 版本 | 3.5.0（发布日期：2025/11/03） |
| 内置 POB Community | **v2.60.0**（更新日期：2026/01/28） |
| 启动文件 | `PoeCharm3.exe` |
| POB 可执行文件 | `PathOfBuildingCommunity-Portable\Path of Building.exe` |

### PoeCharm3 特色功能
- 中文界面支持
- 内置技能搜索、天赋搜索、物品搜索增强
- 集成 POB Community 最新版本

---

## 三、版本状态（截至 2026-03）

### POB Community（适用于 POE1）

| 版本 | 日期 | 状态 |
|------|------|------|
| **v2.60.0** | 2026/01/28 | ✅ 最新版（本地已同步） |
| v2.59.2 | 2025/11/23 | 旧版 |
| v2.59.0 | 2025/11/22 | 旧版（3.27 初始支持） |

**GitHub**: https://github.com/PathOfBuildingCommunity/PathOfBuilding

### POB Community for POE2（适用于 Path of Exile 2）

| 版本 | 状态 |
|------|------|
| **v0.15.0** | ✅ 最新版 |
| v0.14.0 | 支持 0.4 补丁 |
| v0.13.0 | 支持 0.4 赛季内容 |

**GitHub**: https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2

---

## 四、v2.60.0 更新内容（POE1 / 3.27 Phrecia）

### 新功能
- ✨ 新增 3.27 **Phrecia** 天赋树支持
- ✨ 新增 Bitterbind Point 的 Unveil 词条支持
- ✨ 宝石搜索支持 `aoe` 关键词过滤

### 崩溃修复
- 🐛 修复添加辅助宝石/导入物品时的崩溃问题
- 🐛 修复 Radius Jewels 在共享物品中崩溃的问题
- 🐛 修复使用 Foulborn Gruthkel's Pelt 排序宝石时崩溃的问题

### 界面修复
- 修复 Foulborn 图标显示在天赋节点上的问题
- 修复 Foil 物品导入类型错误的问题

### 计算修复
- 修复 Spellslinger 获取通用伤害而非法术伤害的问题
- 修复 Choir of the Storm 的过盖上限 Mod 未应用于总魔力的问题

### 行为修复
- 修复 Party Tab 最大护甲层数覆盖失效的问题
- 修复 Utula's 与 The Tides of Time 联动问题

---

## 五、POB2 v0.15.0 更新内容（POE2）

### 新功能
- ✨ 新增 Transcendent Limbs 支持
- ✨ 新增 Ancient Augment 灵魂核心
- ✨ 新增 The Adorned 稀有变体支持
- ✨ 新增 Rageforged 辅助宝石支持
- ✨ 新增 Bulwark 和 Primal Hunger 关键石支持
- ✨ 新增 Falling Thunder 投射物支持

### 界面
- 导入物品时显示"Twice Corrupted"标记

### 修复
- 修复 The Adorned 稀有变体导入崩溃
- 修复 Berserk 血量损失和 Rage 效果
- 修复双手枪矛问题
- 修复 Mark for Death 时护甲破碎显示问题

---

## 六、常用功能说明

### 导入角色
1. 打开 POB → Import/Export Build
2. 输入账号名 + 角色名 → Fetch
3. 需要联网（可使用 Clash 代理端口 7890）

### 分享 Build
- Build 字符串为 Base64 编码，可粘贴至 pastebin 或直接发送
- 导入：Import/Export → Import → 粘贴字符串

### 天赋树快捷操作
- 搜索节点：`Ctrl+F`
- 比较点数：点击节点查看路径消耗

---

## 七、更新方法

### 方式一：POB 内置自动更新
打开 `Path of Building.exe` → 右上角检查更新

### 方式二：手动下载最新版
- POE1 POB: https://github.com/PathOfBuildingCommunity/PathOfBuilding/releases/latest
- POE2 POB: https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/releases/latest

### 代理加速下载
```
代理地址: http://127.0.0.1:7890（Clash）
```

---

## 八、参考截图（本地）

截图路径：`G:\poegj\PoeCharm3[20251103]-Release-3.5.0\`
- `主界面.png` - 主界面截图
- `搜索技能.png` - 技能搜索功能
- `搜索天赋.png` - 天赋搜索功能
- `搜索物品.png` / `搜索物品2.png` - 物品搜索功能