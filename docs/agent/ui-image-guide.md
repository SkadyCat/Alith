# 游戏 UI 图像制作指南 — 研究总结

> 基于 gameIconInstitute_v30 (SD 1.5) + LoRA 的完整实战经验  
> 文档路径: docs/agent/ui-image-guide.md

---

## 一、当前问题诊断

### 问题 1：图标分辨率错误（最严重）
```
当前: 128x128 → SD 1.5 无法在此分辨率有效工作
正确: 始终生成 512x512，完成后用 PIL resize 到目标尺寸
```
SD 1.5 的 U-Net 结构在 512x512 训练，生成 128x128 相当于让它"缩小 16 倍"输出，
结果是内容模糊、失真、无法识别的抽象图案。

### 问题 2：LoRA 设备不匹配 Bug
```
错误: Expected all tensors to be on the same device, cuda:0 and cpu
原因: load_lora_weights() 在 pipe.to("cuda") 之后才加载 LoRA，
      但 LoRA 权重 load_file() 默认加载到 CPU
修复: 
  option A: 先加载 LoRA（在 to("cuda") 之前）
  option B: load_file(..., device="cuda")
  option C: weight.to(pipe.device) 后再做矩阵乘法
```
没有 LoRA 的结果是纯粹 SD 1.5 的游戏感很弱，无专属风格。

### 问题 3：图标黑色背景（不可用于 UI）
```
当前: black background（硬黑色背景）
游戏 UI 需要: PNG 透明背景（alpha 通道）
```
处理方式：生成后用 rembg 或 PIL 抠图去背景。

### 问题 4：UI 背景提示词方向错误
```
当前提示词: "dungeon stone wall background, gothic arch texture..."
  → 生成出来是一张"场景照片"，不像 UI 面板
正确方向:   强调 "flat panel", "HUD element", "game interface texture", 
             "top-down view", "seamless tile", "no depth"
```

---

## 二、SD 1.5 游戏图标正确使用方法

### 2.1 分辨率策略
```python
# ❌ 错误 - 直接生成小图
pipe(width=128, height=128, ...)

# ✅ 正确 - 生成 512x512，事后缩放
result = pipe(width=512, height=512, num_inference_steps=25, ...)
img = result.images[0]
img_resized = img.resize((128, 128), Image.LANCZOS)
img_resized.save("icon.png")
```

### 2.2 LoRA 加载修复
```python
# 修复方式：load_file 指定 device="cuda"
from safetensors.torch import load_file

def load_lora_weights(pipeline, lora_path, alpha=0.6):
    # ✅ 直接加载到 GPU
    state_dict = load_file(lora_path, device="cuda")
    ...
```

### 2.3 透明背景处理
```python
# 方法 A: 用 rembg（自动 AI 抠图，效果最好）
from rembg import remove
from PIL import Image

img = Image.open("icon_512.png")
img_nobg = remove(img)   # 返回 RGBA 图像（透明背景）
img_nobg = img_nobg.resize((128, 128), Image.LANCZOS)
img_nobg.save("icon_128.png")

# 方法 B: PIL 魔法棒（黑色背景专用）
from PIL import Image
import numpy as np

img = Image.open("icon_512.png").convert("RGBA")
data = np.array(img)
# 将暗色像素设为透明 (R+G+B < 60)
mask = (data[:,:,0].astype(int) + data[:,:,1] + data[:,:,2]) < 60
data[mask, 3] = 0
result = Image.fromarray(data, "RGBA")
result.save("icon_transparent.png")
```

### 2.4 游戏图标提示词模板（gameIconInstitute_v30）
```
触发词（必须放在最前）:
  "Game Icon Research Institute, game icons,"

图标类型关键词:
  技能图标: "skill icon, {技能名称}, centered composition, black background"
  道具图标: "item icon, {道具名称}, centered, black background"  
  状态图标: "stat icon, {属性名称}, HUD element, centered, black background"

反向提示词（重要）:
  "EasyNegative, lowresolution, blurry, multiple objects, text, watermark,
   background scene, landscape, environment, characters, worst quality,
   poor anatomical structure"

推荐参数:
  steps: 25-30（比20更清晰）
  cfg_scale: 7.0-8.0
  sampler: Euler a
  width x height: 512x512（必须！）
```

---

## 三、UI 背景/面板生成方法

### 3.1 错误方向 vs 正确方向

| | 错误写法 | 正确写法 |
|--|--|--|
| 背景图 | "dungeon stone wall background" | "game UI panel texture, flat stone surface, seamless tiling background" |
| 面板 | "gothic arch frame" | "inventory panel frame, 2D game interface element, flat top-down" |
| 风格 | "fantasy scene" | "game HUD, dark fantasy game interface, no depth of field" |

### 3.2 推荐提示词模板

**背景面板 (768x512):**
```
dark stone game inventory background, game UI panel texture, flat worn leather surface,
golden trim border frame, dark RPG interface background, 2D game UI,
no characters, no objects, seamless stone texture, deep shadow overlay,
top-down view, flat composition
negative: 3D render, depth of field, characters, objects, bright light
```

**物品格子背景 (512x512):**
```
dark leather game slot background, inventory grid cell, RPG item slot,
recessed square panel, iron border, worn dark fabric,
game UI element, flat 2D, centered
```

### 3.3 程序化生成（效果更稳定，推荐用于框架/格子）
```python
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

def make_inventory_bg(width=512, height=512, cell_size=64):
    """程序化生成背包背景 - 效果比 SD 更稳定"""
    img = Image.new("RGBA", (width, height), (20, 15, 10, 255))
    draw = ImageDraw.Draw(img)
    
    # 添加噪点纹理
    noise = np.random.randint(0, 15, (height, width, 3), dtype=np.uint8)
    noise_img = Image.fromarray(noise, "RGB")
    img = Image.blend(img.convert("RGB"), noise_img, alpha=0.1).convert("RGBA")
    
    # 绘制格子
    draw = ImageDraw.Draw(img)
    for x in range(0, width, cell_size):
        for y in range(0, height, cell_size):
            draw.rectangle([x+1, y+1, x+cell_size-2, y+cell_size-2],
                           outline=(80, 60, 40, 200), width=1)
    
    return img

bg = make_inventory_bg()
bg.save("inventory_bg.png")
```

---

## 四、可用资源清单

| 资源 | 路径 | 说明 |
|------|------|------|
| gameIconInstitute_v30 | E:\AIGC\GameIcon\models\checkpoints\ | SD 1.5 游戏图标专用模型 |
| sxz-icons-v5 LoRA | E:\AIGC\GameIcon\models\loras\ | 图标风格 LoRA |
| GameIconResearch_skill4_Lora | E:\AIGC\GameIcon\models\loras\ | 技能图标 LoRA |
| SDXL WAI-Illustrious | E:\AIGC\SDXL\models\checkpoints\ | SDXL 高质量模型（anime/插画风格） |
| Flux | E:\AIGC\Flux\ | Flux 模型（高质量，较慢） |

---

## 五、修复后的生成脚本关键改动

```python
# 1. LoRA 修复：加载到 CUDA
state_dict = load_file(lora_path, device="cuda")

# 2. 分辨率修复：始终 512x512 生成
result = pipe(width=512, height=512, num_inference_steps=28, guidance_scale=7.5)
img = result.images[0]

# 3. 缩放到目标尺寸
target_size = (128, 128)
img_small = img.resize(target_size, Image.LANCZOS)

# 4. 去除黑色背景（方法 B，无需额外依赖）
import numpy as np
data = np.array(img_small.convert("RGBA"))
dark_mask = (data[:,:,0].astype(int) + data[:,:,1].astype(int) + data[:,:,2].astype(int)) < 50
data[dark_mask, 3] = 0
final = Image.fromarray(data)
final.save(output_path)
```

---

## 六、推荐工作流

```
任务类型判断:
  → 图标 (icon):      SD 1.5 gameIconInstitute + LoRA → 512x512 → resize → 去背景
  → UI 背景/面板:     程序化生成（PIL） 或 SD 1.5 768x512（提示词见3.2）
  → 角色/插画:        SDXL WAI-Illustrious（port:8332）
```

---

*由爱丽丝整理，时间: 2026-03-13*
