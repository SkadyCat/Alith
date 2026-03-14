# SOP: 图像生成（Game Icon / UI 素材）

> 触发关键词: 图像生成|生成图片|背景图|纹理|图标|SD|ComfyUI|Stable Diffusion

---

## 系统配置

| 项目 | 值 |
|------|-----|
| Python | `E:\AIGC\Flux\backend\venv\Scripts\python.exe` |
| 模型 | `E:\AIGC\GameIcon\models\checkpoints\gameIconInstitute_v30.safetensors` |
| 正确LoRA | `E:\AIGC\GameIcon\models\loras\GameIconResearch_skill4_Lora.safetensors` (alpha=0.5) |
| 错误LoRA | ~~sxz-icons-v5~~（效果差，不要用）|
| SDXL模型 | `E:\AIGC\SDXL\models\checkpoints\waiIllustriousSDXL_v160.safetensors` |
| 代理 | `HTTP_PROXY=http://127.0.0.1:7890`（下载时必须设置）|

---

## Step 1: 确定图像类型

| 类型 | 推荐方案 |
|------|----------|
| 游戏图标（武器/装备/药水/技能）| GameIcon SD1.5 + GameIconResearch_skill4_Lora |
| 大背景/UI面板背景 | PIL 程序生成 或 SDXL |
| UI边框/装饰 | PIL 程序生成（最干净）|

---

## Step 2: 图标生成参数（必须遵守）

```python
# ✅ 正确
width=512, height=512          # 不能用128x128！
num_inference_steps=20
guidance_scale=7.0             # 不是7.5
LORA = "GameIconResearch_skill4_Lora.safetensors"
lora_alpha = 0.5

# 触发词前缀（必须包含）
BASE_TAG = "Game Icon Research Institute, game icons, dark fantasy,"
NEGATIVE = "EasyNegative, lowresolution, poor anatomical structure, text, errors, worst quality, low quality, normal quality, jpeg artifacts, signatures, watermarks, username, multiple objects, structural errors, blurry, out of focus"
```

---

## Step 3: Prompt 写法

**好prompt = 具体物体描述 + 风格词 + 背景**

```
✅ "heavy iron gauntlet fist raised, power aura red glow, dark RPG, centered, black background"
✅ "round glass bottle filled with glowing red liquid, crimson elixir, dark fantasy, centered, black background"
✅ "gold coin stack pile, gleaming metallic coins, treasure, dark background"

❌ "strength muscle power aura"（太抽象）
❌ "red potion"（太简单，模型无法理解）
```

---

## Step 4: 运行脚本

```powershell
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:HTTP_PROXY  = "http://127.0.0.1:7890"
$py = "E:\AIGC\Flux\backend\venv\Scripts\python.exe"
& $py "E:\AIGC\GameIcon\generate_bag_icons_v2.py"
```

---

## Step 5: 输出路径

```
E:\AIGC\GameIcon\outputs\{prefix}_{ts}_{hash}.png   # 原始
E:\docs-service\public\images\{fname}               # 公开访问 /images/{fname}
E:\docs-service\application\canvas-editor\public\assets\bag\{prefix}.png  # Canvas资产
```

---

## 常见错误

| 错误现象 | 原因 | 修复 |
|----------|------|------|
| 图标像石头方块 | 用了sxz-icons-v5或128x128 | 换LoRA + 改512x512 |
| 药水生成的是盒子 | Prompt不够具体 | 加"round glass bottle, liquid inside" |
| 卡在"Fetching files" | 无代理 | 设置HTTP_PROXY=7890 |
| 背景不是黑色 | 缺少"black background, centered" | 在prompt末尾加 |

---

## 备用方案：Flux.1-schnell（LoRA效果差时使用）

当 SD1.5+LoRA 效果不满意时，改用 Flux.1-schnell GGUF：

| 项目 | 值 |
|------|-----|
| 脚本 | `E:\AIGC\GameIcon\generate_bag_icons_flux.py` |
| 模型 | `flux1-schnell-Q2_K.gguf` (Q2_K 量化) |
| 步数 | 4步（schnell 专用，不可改大） |
| guidance_scale | **0.0**（schnell 无需 CFG） |
| 负提示词 | **不需要**（Flux 不支持） |
| Prompt 风格 | 自然语言描述，越详细越好 |

```powershell
$py = "E:\AIGC\Flux\backend\venv\Scripts\python.exe"
& $py "E:\AIGC\GameIcon\generate_bag_icons_flux.py"
```

**Flux Prompt 写法（与 SD1.5 不同！）：**

```
✅ "A fantasy RPG game icon of a heavy iron gauntlet with fist raised,
    glowing red power aura around it, dark fantasy style,
    centered on pure black background, single object, highly detailed 3D render, game asset"

❌ "Game Icon Research Institute, game icons, dark fantasy, strength warrior stat icon..."
   （SD1.5 触发词对 Flux 无效）
```

**输出路径**（与 SD1.5 版本相同，可直接替换）：
- `E:\AIGC\GameIcon\outputs\{prefix}_flux_{ts}_{hash}.png`
- `E:\docs-service\public\images\{fname}`
- `E:\docs-service\application\canvas-editor\public\assets\bag\{prefix}.png`


---

## 八、背景去除（rembg）

生成的 AI 图标默认有黑色背景，放在 UI 上会很突兀，必须去除背景。

**工具**: `rembg`（已安装在 `E:\AIGC\Flux\backend\venv`）

```python
from rembg import remove
from PIL import Image
import io, os

with open("icon.png", "rb") as f:
    result = remove(f.read())

img = Image.open(io.BytesIO(result)).convert("RGBA")
img.save("icon_nobg.png")  # 透明背景 PNG
```

**批量脚本**: `E:\AIGC\GameIcon\remove_bg.py`

**注意**:
- 输出为 RGBA PNG（透明背景），适合叠在任意背景上
- rembg 使用 CPU 推理（CUDA DLL 缺失但不影响结果）
- 原图备份在: `E:\AIGC\GameIcon\outputs\bag_ui_originals\`
- ⚠️ 暗黑风格图标黑色背景 → 去背后边缘可能模糊，可考虑用 `alpha_matting=True` 提升边缘精度
