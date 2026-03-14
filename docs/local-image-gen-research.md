# 本地图像生成方案 — 背包UI素材

> 研究时间: 2026-03-13 | 目标: 为背包UI生成背景图和状态图标

## 一、当前环境

- GPU: **NVIDIA GeForce RTX 4080 SUPER (16GB VRAM)** — 顶级显卡，可跑最强模型
- E: 盘剩余 ~228GB，空间充足
- Python: 未安装
- 代理: Clash 7890 可加速下载

## 二、推荐工具: ComfyUI Portable ⭐

**为什么选 ComfyUI:**
- 自带 Python，解压即用，无需额外安装
- RTX 4080 SUPER 可跑 FLUX.1（最强开源模型）
- 节点工作流精确控制，支持批量生成
- 提供 HTTP API，未来可与 canvas-editor 集成

**下载地址 (v0.17.0, ~1.87GB):**
```
https://github.com/Comfy-Org/ComfyUI/releases/download/v0.17.0/ComfyUI_windows_portable_nvidia.7z
```

## 三、对比表

| 工具 | 安装 | 质量 | 游戏素材 |
|------|------|------|---------|
| ComfyUI ⭐ | 解压即用 | 极高 | 最佳 |
| A1111 WebUI | 需Python | 高 | 好 |
| Fooocus | 一键 | 高 | 一般 |

## 四、推荐模型

### 背景图 (PoE 暗黑奇幻风格)
- **DreamShaper XL** (civitai) — 专为奇幻/游戏风格优化 ★
- **SDXL Base 1.0** (6.5GB) — 通用高质量基础

### 图标 (状态图标/物品)
- SDXL + Game Icon LoRA (civitai 大量可选)
- SDXL + Pixel Art LoRA (像素风)

## 五、Prompt 参考

### 背包背景
```
dark fantasy RPG inventory background, worn leather texture,
gothic ornamental border, medieval stone, game UI panel,
dark brown and gold color palette, high detail, 4k, game asset
negative: bright colors, modern, text
```

### 状态图标 (血/魔/耐力)
```
RPG status icon, health/mana/stamina, dark fantasy game UI,
glowing gem, circular icon frame, isolated black background,
256x256, game asset
```

### 物品槽
```
empty inventory slot, dark fantasy, stone texture, gothic frame,
subtle glow, square format, game UI asset, isolated
```

## 六、安装步骤

```powershell
# 1. 用 Clash 代理下载 (7890)
Invoke-WebRequest -Uri "https://github.com/Comfy-Org/ComfyUI/releases/download/v0.17.0/ComfyUI_windows_portable_nvidia.7z" -OutFile "E:\AI\ComfyUI.7z" -Proxy "http://127.0.0.1:7890"

# 2. 解压到 E:\AI\ComfyUI\
# 3. 双击 run_nvidia_gpu.bat 启动
# 4. 浏览器访问 http://localhost:8188
```

## 七、与 canvas-editor 集成

ComfyUI 提供 HTTP API，可在 canvas-editor 中添加"生成图片"按钮直接调用:
```js
fetch("http://localhost:8188/prompt", { method:"POST", body: JSON.stringify(workflow) })
```

> 是否需要立即下载安装 ComfyUI？还是先研究 Civitai 上的模型？

