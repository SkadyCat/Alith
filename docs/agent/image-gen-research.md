# 游戏 UI 图像制作指南

> 版本：v1.0 | 更新：2026-03-13 | 适用：canvas-editor bag2.session 暗黑/PoE 风格

---

## 一、问题根源分析

### 为什么之前的图片"内容不对"？

| 问题 | 原因 | 修复方案 |
|------|------|----------|
| 随机噪点纹理 | PIL 逐像素随机，非结构化 | 使用真实纹理瓦片 |
| 边框太粗/太简单 | 仅用 `draw.rectangle()` | 使用 9-slice 边框素材 |
| 颜色不统一 | 各元素独立着色 | 建立调色板，统一色调 |
| 无真实材质感 | 缺乏高光/阴影 | 借助现成游戏素材包 |

---

## 二、正确制作游戏 UI 图像的方法

### 方法 A：使用免费素材包（推荐，立即可用）

#### Kenney.nl（CC0 — 无需署名，可商用）
| 素材包 | 下载链接 | 适用场景 |
|--------|----------|----------|
| UI Pack RPG Expansion | https://kenney.nl/assets/ui-pack-rpg-expansion | 按钮/面板/图标 |
| Fantasy UI Borders | https://opengameart.org/content/fantasy-ui-borders | 9-slice 边框 |
| RPG Items Pack | https://kenney.nl/assets/rpg-items | 装备/药水图标 |

**使用方式（Python PIL 处理）：**
```python
from PIL import Image

# 1. 加载 panelInset_brown.png（93×94）
inset = Image.open("panelInset_brown.png").convert("RGBA")

# 2. 缩放到目标尺寸
slot = inset.resize((56, 56), Image.LANCZOS)

# 3. 暗化 + 金棕色调
r, g, b, a = slot.split()
r = r.point(lambda x: int(x * 0.35 * 1.0))  # 保留红色分量
g = g.point(lambda x: int(x * 0.35 * 0.65)) # 减弱绿色
b = b.point(lambda x: int(x * 0.35 * 0.30)) # 大幅减弱蓝色
slot_dark = Image.merge("RGBA", (r, g, b, a))
slot_dark.save("equip_slot.png")
```

**关键参数调色板（暗黑 PoE 风格）：**
```
主色调：      rgba(15, 8, 3, 255)   — 极深棕黑
装备槽色调：  rgba(30, 18, 6, 220)  — 暗棕
金色边框：    rgb(200, 160, 60)     — 琥珀金
绿色药瓶：    rgba(10, 40, 10, 210) — 暗绿
紫色戒指：    rgba(30, 15, 40, 210) — 暗紫
```

---

### 方法 B：使用 Stable Diffusion 生成（高质量，需 GPU）

**你的配置（RTX 4080 SUPER 16GB）完全满足要求。**

#### 推荐安装：ComfyUI Desktop
- 下载：https://www.comfy.org/download
- 一键安装，不需要手动配置环境

#### 推荐模型（civitai.com 搜索）
| 模型 | 用途 | 风格 |
|------|------|------|
| DreamShaper XL | 通用高质量 | 幻想/写实 |
| DarkSushiMix | 暗黑幻想 | PoE 风格 |
| Realistic Vision | 写实纹理 | 石材/金属背景 |

#### 推荐 Prompts（装备槽背景）
```
# 装备槽背景
game UI element, dark fantasy item slot, 
square inset frame, dark stone border, 
gold trim, gothic style, 8k, transparent center,
--no characters, --no text

# 面板背景纹理
dark stone texture, gothic panel background, 
aged leather pattern, dark fantasy UI, 
seamless, game asset, 8k
```

---

### 方法 C：SVG + CSS（程序化，零安装）

适合简单图标和边框，直接在浏览器渲染，无需图片文件。

```svg
<!-- 金色边框装备槽 -->
<svg width="56" height="56" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1e0e04"/>
      <stop offset="100%" stop-color="#0d0603"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#8b6914"/>
      <stop offset="50%" stop-color="#c8a030"/>
      <stop offset="100%" stop-color="#8b6914"/>
    </linearGradient>
  </defs>
  <!-- 背景 -->
  <rect width="56" height="56" fill="url(#bg)" rx="2"/>
  <!-- 金色外框 -->
  <rect x="0.5" y="0.5" width="55" height="55" fill="none" 
        stroke="url(#gold)" stroke-width="1.5" rx="2"/>
  <!-- 内阴影 -->
  <rect x="3" y="3" width="50" height="50" fill="none" 
        stroke="rgba(0,0,0,0.5)" stroke-width="2"/>
  <!-- 高光 -->
  <rect x="3" y="3" width="50" height="50" fill="none" 
        stroke="rgba(200,160,60,0.3)" stroke-width="0.5" rx="1"/>
</svg>
```

将 SVG 转为 data URI 可直接在 CSS/style 中使用：
```
background-image: url("data:image/svg+xml,<svg...>");
```

---

## 三、9-Slice 边框技术（专业游戏UI标准）

9-slice 是将一张图分割成 3×3 = 9 个区域，四角不缩放，边缘单向拉伸，中心双向拉伸：

```
┌──┬──────────┬──┐
│角│  上边框  │角│
├──┼──────────┼──┤
│左│  中心区  │右│
│边│  (拉伸)  │边│
├──┼──────────┼──┤
│角│  下边框  │角│
└──┴──────────┴──┘
```

**CSS 实现：**
```css
.panel {
  border-image: url('/assets/bag/kenney/border_00.png') 16 fill / 16px / 0 stretch;
}
```

**适用文件：** `kenney/border_00.png` ~ `border_07.png`（已下载到 public/assets/bag/kenney/）

---

## 四、当前已准备的资源清单

| 文件 | 来源 | 尺寸 | 用途 |
|------|------|------|------|
| equip_slot.png | Kenney panelInset_brown（处理） | 56×56 | 装备槽 |
| weapon_slot.png | Kenney panelInset_brown（处理） | 56×80 | 武器/盾/甲槽 |
| ring_slot.png | Kenney panelInset_brown（紫色调） | 40×40 | 戒指槽 |
| neck_slot.png | Kenney panelInset_brown（紫调） | 40×40 | 项链槽 |
| belt_slot.png | Kenney panelInset_brown（处理） | 56×28 | 腰带槽 |
| flask_slot.png | Kenney panelInset_brown（绿调） | 24×52 | 药瓶槽 |
| bg_main.png | Kenney panel_brown（瓦片+暗化） | 960×620 | 背包主背景 |
| bg_equip.png | Kenney panel_brown（瓦片+暗化） | 200×564 | 装备栏背景 |
| bg_inv.png | Kenney panel_brown（瓦片+暗化） | 556×564 | 背包格子背景 |
| bg_stat.png | Kenney panel_brown（瓦片+暗化） | 200×564 | 属性栏背景 |
| slot_bg.png | Kenney panelInset_brown（极暗） | 60×60 | TileView 物品格 |
| kenney/border_*.png | Kenney Fantasy UI Borders | 48×48 | 9-slice 边框 |

---

## 五、进阶改进建议

1. **安装 ComfyUI + SD** → 生成真正暗黑风格的石材/皮革纹理背景
2. **使用 Pillow 的 `ImageFilter.BLUR`** → 模糊边缘实现"嵌入感"
3. **SVG 图标** → 使用 Inkscape 制作矢量装备图标（刀、盾、戒指等）
4. **CSS `box-shadow: inset`** → 在 canvas-editor 中用 boxShadow 属性添加内凹阴影
5. **叠加透明边框** → 使用 kenney 边框作为叠加层，产生9-slice效果

---

*参考：CC0 素材来源 Kenney.nl | 全部资源均为免费可商用*
