# 游戏UI图像制作 — 正确方案研究

> 更新: 2026-03-13 | 前一版文档方案不够具体，本版重新整理

---

## 一、问题所在（上一版的错误）

| 问题 | 原因 |
|------|------|
| 普通 txt2img 不适合制作 UI 图标 | 没有透明背景，AI 不理解"图标"的概念 |
| PoE 风格提示词太模糊 | 生成的是"艺术图"而不是可用的 UI 素材 |
| 没有区分资源类型 | 背景图 vs 图标 vs 状态栏 需要完全不同的工作流 |

---

## 二、资源分类及正确工具

### 类型 A：状态图标（血/魔/耐力/技能）

**最佳方案：game-icons.net** ⭐⭐⭐

- 地址: https://game-icons.net
- 超过 4000 个 SVG 游戏图标，完全免费 (CC BY 3.0)
- 专为 RPG 设计，包含 health / mana / sword / shield / potion 等所有类型
- **SVG 格式**可自由更改颜色、大小
- 在线编辑器可直接调整前景色/背景色后导出 PNG

```
# 示例：直接下载健康图标 SVG
# https://game-icons.net/1x1/lorc/glass-heart.svg  (血量)
# https://game-icons.net/1x1/lorc/potion-ball.svg  (药水)
# https://game-icons.net/1x1/sbed/mana.svg          (魔法)
```

**或者用 Python 批量下载+着色：**
```python
import requests
icons = {
    "health": "https://game-icons.net/icons/ffffff/000000/1x1/lorc/glass-heart.svg",
    "mana":   "https://game-icons.net/icons/ffffff/000000/1x1/sbed/mana.svg",
    "stamina":"https://game-icons.net/icons/ffffff/000000/1x1/lorc/run.svg",
}
for name, url in icons.items():
    r = requests.get(url)
    open(f"assets/{name}.svg", "wb").write(r.content)
```

---

### 类型 B：AI生成图标（透明背景）

**正确工具：LayerDiffuse（ComfyUI扩展）**

- GitHub: https://github.com/layerdiffusion/sd-forge-layerdiffuse
- 支持 SDXL 原生透明背景生成（不是事后抠图）
- 支持半透明、发光效果、毛发等精细透明
- 需要：ComfyUI + SDXL 模型 + LayerDiffuse LoRA

**正确提示词（透明背景图标）：**
```
# 好的提示词
"a glowing red heart gem, game icon, fantasy RPG, 
 no background, transparent, isolated object,
 ornate gothic frame, dark fantasy aesthetic,
 high detail, clean edges"

negative: "background, scenery, text, watermark, multiple objects"
```

---

### 类型 C：背景纹理（物品槽、面板背景）

**工具：ComfyUI + SDXL 或 FLUX.1**

背景图的关键是：**纹理** 而不是场景，需要明确不要有 UI 元素和文字。

**正确提示词（深色皮革/石材纹理）：**
```
"dark worn leather texture, seamless tile, 
 close-up, surface material, RPG inventory background,
 dark brown, aged, subtle scratches, no objects, 
 no text, no UI, just texture, 4k"

"rough stone texture, medieval, dark, 
 gothic carved surface, seamless, game asset,
 no text, no characters, tileable texture"
```

**关键参数：**
- 尺寸：512×512 或 1024×1024（2的幂次方）
- 格式：PNG（背景纹理不需要透明，JPG也可以）
- 宽高比：正方形（用于物品槽）/ 矩形（用于面板）

---

### 类型 D：装饰边框（面板边框）

**工具：Python Pillow / SVG手工制作 / AI**

对于简单的暗金色边框，完全可以用 CSS 或者 SVG 制作，不需要 AI：
```css
/* CSS 模拟 PoE 暗金色边框 */
border: 2px solid #6a4f20;
box-shadow: 
  inset 0 0 8px rgba(180,120,30,0.3),
  0 0 12px rgba(0,0,0,0.8);
background: linear-gradient(135deg, #1a1208, #0d0c07);
```

---

## 三、ComfyUI 完整安装+使用流程

### 安装（约 2-5 分钟，使用 Clash 代理）

```powershell
# 1. 设置代理
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"

# 2. 下载 ComfyUI Portable NVIDIA 版 (约1.87GB)
Invoke-WebRequest `
  -Uri "https://github.com/Comfy-Org/ComfyUI/releases/download/v0.17.0/ComfyUI_windows_portable_nvidia.7z" `
  -OutFile "E:\AI\ComfyUI.7z" `
  -Proxy "http://127.0.0.1:7890"

# 3. 解压到 E:\AI\ComfyUI
# 4. 下载模型（选一个，放到 ComfyUI\models\checkpoints\）
#    SDXL (6.5GB): https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0
#    FLUX-schnell FP8 (约8GB): https://huggingface.co/Comfy-Org/flux1-schnell

# 5. 启动
E:\AI\ComfyUI\run_nvidia_gpu.bat
# 访问 http://localhost:8188
```

### 透明背景工作流（LayerDiffuse）

```
1. 打开 ComfyUI -> Manager -> 搜索 LayerDiffuse -> 安装
2. 重启 ComfyUI
3. 在工作流中添加 LayerDiffuse 节点
4. 模型会自动下载（layer_xl_transparent_attn.safetensors）
5. 生成直接得到带 alpha 通道的 PNG
```

---

## 四、可立即使用的素材源

| 资源 | 地址 | 内容 | 许可 |
|------|------|------|------|
| **game-icons.net** ⭐ | https://game-icons.net | 4000+ RPG SVG图标 | CC BY 3.0 |
| OpenGameArt | https://opengameart.org | 纹理、背景、UI套件 | 多种开源 |
| Kenney.nl | https://kenney.nl/assets | UI套件、图标 | CC0 完全免费 |
| itch.io 免费资产 | https://itch.io/game-assets/free | 大量RPG UI包 | 各有不同 |

---

## 五、推荐行动顺序

1. **先去 game-icons.net** 下载需要的状态图标 SVG（免费，立即可用）
2. **决定是否安装 ComfyUI**（背景纹理生成，需要下载约10GB）
3. **确定艺术风格**：PoE暗黑 / 中世纪奇幻 / 像素风？
4. 针对背景纹理写正确的提示词

> 是否需要我帮你：(A) 从 game-icons.net 下载一批图标到项目里？(B) 开始下载安装 ComfyUI？
