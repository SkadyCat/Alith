# UI 图像制作指南

## 1. 已下载的图标（立即可用）

图标存放于：`canvas-editor/public/assets/icons/`  
画布中 **Image 控件** 设置 `图片路径` 为以下路径即可：

| 图标文件 | 用途 | 路径 |
|---------|------|------|
| str.svg | 力量 STR（肌肉臂） | `/assets/icons/str.svg` |
| dex.svg | 敏捷 DEX（羽毛） | `/assets/icons/dex.svg` |
| int.svg | 智力 INT（魔法旋涡） | `/assets/icons/int.svg` |
| vit.svg | 体力 VIT（十字/血量） | `/assets/icons/vit.svg` |
| gold.svg | 金币 | `/assets/icons/gold.svg` |
| atk.svg | 攻击（交叉剑） | `/assets/icons/atk.svg` |
| def2.svg | 防御（盾击） | `/assets/icons/def2.svg` |
| potion.svg | 药水 | `/assets/icons/potion.svg` |
| helmet.svg | 头盔装备槽 | `/assets/icons/helmet.svg` |
| boots.svg | 靴子装备槽 | `/assets/icons/boots.svg` |
| gear.svg | 盔甲/装备 | `/assets/icons/gear.svg` |
| health.svg | 生命/血量 | `/assets/icons/health.svg` |
| lightning.svg | 闪电/魔法 | `/assets/icons/lightning.svg` |
| scroll.svg | 卷轴/技能书 | `/assets/icons/scroll.svg` |

> 图标颜色为金色 `#c9a84c`，透明背景。

---

## 2. 下载更多图标（game-icons.net）

### 网站
- 官网：https://game-icons.net  
- 3000+ 免费 SVG 图标，CC BY 3.0 授权

### 下载方法（已验证可用）

1. 在网站上找到图标，记下作者名和图标名（URL 中可见）
2. 用 PowerShell 下载：
```powershell
# 格式：https://game-icons.net/icons/ffffff/000000/1x1/{作者}/{图标名}.svg
$proxy = "http://127.0.0.1:7890"
$url = "https://game-icons.net/icons/ffffff/000000/1x1/delapouite/axe.svg"
$wc = New-Object System.Net.WebClient
$wc.Proxy = New-Object System.Net.WebProxy($proxy)
$wc.DownloadFile($url, "E:\docs-service\application\canvas-editor\public\assets\icons\axe_raw.svg")
```

3. 处理（去黑色背景，改金色）：
```powershell
$c = [IO.File]::ReadAllText("...\axe_raw.svg") -replace '<path d="M0 0h512v512H0z"/>', '' -replace 'fill="#fff"', 'fill="#c9a84c"'
[IO.File]::WriteAllText("...\axe.svg", $c, [Text.Encoding]::UTF8)
```

### 常用 RPG 图标名

| 含义 | 作者 | 图标名 |
|------|------|--------|
| 力量 | delapouite | biceps |
| 敏捷 | lorc | feather |
| 智力 | lorc | magic-swirl |
| 体力 | sbed | health-normal |
| 金币 | delapouite | coins |
| 攻击 | lorc | crossed-swords |
| 弓 | lorc | bow-arrow |
| 斧头 | delapouite | axe |
| 魔法棒 | lorc | magic-wand |
| 骷髅 | lorc | skull |
| 背包 | lorc | swap-bag |
| 钥匙 | delapouite | key |
| 药水 | lorc | potion-ball |

---

## 3. 免费 RPG UI 完整包（Kenney.nl）

**RPG UI Pack**（CC0 免费商用，85个文件，含面板/按钮/边框/槽位）

下载链接：
```
https://kenney.nl/media/pages/assets/ui-pack-rpg-expansion/b1e1f298c6-1677661824/kenney_ui-pack-rpg-expansion.zip
```

包含：
- `panel_beige*.png` — 各种面板背景（米色石头风格）
- `frame_*.png` — 边框装饰
- `slot_*.png` — 物品槽（装备槽、背包格）
- `button_*.png` — 各种按钮状态

下载后解压到：`canvas-editor/public/assets/kenney/`

---

## 4. 自制像素图标（Piskel）

**Piskel** — 免费在线像素画工具，无需安装
- 网址：https://www.piskelapp.com
- 画布大小推荐：32×32 或 64×64
- 导出：PNG（透明背景）

**制作 RPG 图标步骤：**
1. 新建画布 32×32，背景透明
2. 用亮金色 `#c9a84c` 绘制图标线条
3. 内部填充深金色 `#8a6a20`
4. 导出 PNG
5. 保存到 `public/assets/icons/` 目录

---

## 5. 背景图（CSS 方案 — 不需要图片文件）

对于背景面板，使用 CSS 渐变效果比图片文件更灵活。

在 Image 控件的 `imagePath` 留空时，背包背景面板直接用 **CanvasPanel** 的 `backgroundColor` 设置：
- 主面板背景：`rgba(15,12,8,0.92)` 深色石头感
- 分割线：用 Border 控件，`borderColor: #c9a84c44`

如果需要纹理背景图，推荐：
- **Lospec** 上找像素艺术纹理：https://lospec.com/palette-list
- 或者用 Piskel 手绘一个 4×4 或 8×8 小纹理瓦片，设置为 CSS background-repeat

---

## 6. AI 生成（Stable Diffusion）

### 本地安装（推荐 ComfyUI）
```bash
# 需要 NVIDIA GPU（8GB VRAM 最低）
git clone https://github.com/comfyanonymous/ComfyUI
cd ComfyUI
pip install -r requirements.txt
python main.py
```

### 推荐 Prompt（背包背景）
```
dark fantasy RPG inventory bag background, leather texture, 
ornate golden border, dark brown and gold, transparent background,
game UI element, no text, clean edges, 
high quality pixel art, 2D game asset
```

### 推荐 Prompt（属性图标）
```
RPG stat icon, golden metallic, transparent background, 
32x32 pixel art, game icon, single icon centered,
[strength/agility/intelligence/vitality]
```

---

## 7. 在 Canvas Editor 中使用图片

1. 添加 **Image** 控件到画布
2. 在右侧属性面板设置 `图片路径`
3. 使用本地路径：`/assets/icons/str.svg`
4. 或使用完整 URL：`https://game-icons.net/icons/ffffff/000000/1x1/delapouite/biceps.svg`

> **SVG 优势**：矢量图，任意缩放不失真，颜色可通过 CSS 修改
