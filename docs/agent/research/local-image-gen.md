# 本地图像生成工具调研 — 背包 UI 资源生成

## 需求

为 bag2.session 背包 UI 生成：
- **背景图**：深色奇幻风格底图（Bag 320×472, EquipPanel 200×564, StatPanel 200×564）
- **状态图标**：STR/DEX/INT/VIT、金币、伤害、防御等小图标（24~32px）

---

## 推荐工具对比

| 工具 | 难度 | Windows 支持 | 适合场景 |
|------|------|-------------|---------|
| **ComfyUI Desktop** | ★★☆ | ✅ 一键安装 | 背景图、批量生成、工作流复用 |
| **SD WebUI (A1111)** | ★☆☆ | ✅ 脚本安装 | 教程最多，txt2img 最简单 |
| **InvokeAI** | ★★★ | ✅ | 专业 Canvas 编辑 |

### 最推荐：ComfyUI Desktop（Windows）
- 下载：https://www.comfy.org/download
- 支持 SDXL、Flux、SD3.5 等主流模型
- 节点式工作流，可保存复用
- 下载模型时走 Clash 代理 7890 会更快

---

## 背景图 Prompt 参考

### Bag 整体底图（320×472）

```
dark stone texture, worn leather border, aged metal rivets,
RPG inventory background, gothic dark fantasy, game UI panel,
path of exile style, diablo style, no text, no characters,
cinematic lighting, high detail
```

Negative:
```
bright, cartoon, anime, text, watermark, people
```

### 装备栏/状态栏区域（200×564）

```
dark iron panel background, medieval fantasy game UI,
subtle worn metal texture, gothic frame decoration,
dark brown and gold color palette, no text
```

---

## 状态图标方案

### 方案 A：game-icons.net（最推荐，快速免费）

- 地址：https://game-icons.net
- 免费 SVG 矢量图标，3000+ 种
- 可直接在网站设置前景/背景颜色后下载 PNG

| 属性 | 搜索关键词 |
|------|-----------|
| STR 力量 | muscle, fist, anvil |
| DEX 敏捷 | feather, arrow, wind |
| INT 智力 | lightning-star, crystalball |
| VIT 体力 | heart-plus, shield-heart |
| 金币 | coins, gold-bar |
| 伤害 | sword, crossed-swords |
| 防御 | shield, armor |

### 方案 B：AI 生成图标（SDXL）

尺寸：生成 512×512 → 缩放到 32px

```
single icon, [属性名] symbol, glowing gemstone rune,
fantasy RPG UI, flat design, transparent background,
path of exile style, dark gold border, no background
```

### 方案 C：Python 批量处理 game-icons SVG

```python
# pip install cairosvg pillow
import cairosvg
from PIL import Image
import io

def svg_to_png(svg_path: str, size: int = 32, color: str = "#c9a84c") -> Image.Image:
    with open(svg_path) as f:
        svg = f.read()
    svg = svg.replace('fill="#000"', f'fill="{color}"')
    svg = svg.replace('fill="black"', f'fill="{color}"')
    png_data = cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size)
    return Image.open(io.BytesIO(png_data))

img = svg_to_png("muscle.svg", 32, "#e8c06b")
img.save("str_icon.png")
```

---

## 推荐模型（CivitAI 下载，走代理 7890）

| 模型 | 风格 | 用途 |
|------|------|------|
| DreamShaper XL | 幻想风 | 背景图、图标 |
| Juggernaut XL | 写实质感 | 石材/皮革纹理 |
| Flux.1 Schnell | 通用快速 | 任意图像 |

---

## 整合到 Canvas Editor

1. 生成图片放入 `application/canvas-editor/public/assets/`
2. 在 canvas-editor 选中 Image 控件
3. 属性面板 → 图片路径 → 填入 `/assets/xxx.png`
