# 本地图像生成 — 背包资产指南

> 生成时间：2026-03-13  
> 目标：为 bag2.session 生成背景图和装备栏图标

---

## 一、本地可用服务

| 服务 | 端口 | 模型 | 状态 |
|------|------|------|------|
| SDXL Service | 8189 | wai-sdxl (SDXL) | ✅ 运行中 |
| GameIcon 独立脚本 | — | gameIconInstitute_v30 (SD1.5) | ✅ 可用 |
| ComfyUI compat | 8188 | 兼容层→8331 | ⚠️ 未接后端 |
| Flux Backend | 8331 | Canvas Editor | ✅ 运行中 |

---

## 二、已生成图标

所有图标位于：`http://localhost:8331/assets/icons/`

| 文件名 | 用途 |
|--------|------|
| `helmet_slot.png` | 头盔槽 |
| `sword_slot.png` | 武器槽 |
| `shield_slot.png` | 盾牌槽 |
| `ring_slot.png` | 戒指槽 |
| `boot_slot.png` | 靴子槽 |
| `amulet_slot.png` | 项链槽 |
| `gloves_slot.png` | 手套槽 |
| `belt_slot.png` | 腰带槽 |
| `chest_slot.png` | 胸甲槽 |
| `legs_slot.png` | 腿甲槽 |
| `gold_icon.png` | 金币图标 |
| `health_pot.png` | 血药图标 |

---

## 三、生成方式

### GameIcon SD1.5（推荐用于小图标 512×512）

```python
from diffusers import StableDiffusionPipeline, DPMSolverMultistepScheduler
import torch

CHECKPOINT = r"E:\AIGC\GameIcon\models\checkpoints\gameIconInstitute_v30.safetensors"
pipe = StableDiffusionPipeline.from_single_file(CHECKPOINT, torch_dtype=torch.float16, safety_checker=None)
pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config, use_karras_sigmas=True)
pipe.to("cuda")

img = pipe(
    prompt="game icon, iron helmet, dark fantasy, diablo style, black background, gameicon",
    negative_prompt="bad quality, text, watermark, people",
    num_inference_steps=20,
    guidance_scale=7.5,
    width=512, height=512
).images[0]
img.save("helmet.png")
```

**Python 环境**：`E:\AIGC\Flux\backend\venv\Scripts\python.exe`

### 关键词模板（PoE/Diablo 风格）

```
游戏图标：game icon, {物品名}, dark fantasy, path of exile style, diablo, detailed, isolated, black background, gameicon
负面词：   bad quality, worst quality, watermark, text, signature, deformed, ugly, people
```

---

## 四、在 canvas-editor 中使用

在 `bag2.session` 的 Image 节点 widgetProps 中设置：

```json
{
  "src": "http://localhost:8331/assets/icons/helmet_slot.png",
  "objectFit": "contain"
}
```

Image 节点可作为装备槽的图标叠加层。

---

## 五、背景图生成

使用 wai-sdxl 生成大背景（推荐 512×512 或更大）：

```python
from diffusers import StableDiffusionXLPipeline, EulerAncestralDiscreteScheduler
CHECKPOINT = r"E:\AIGC\SDXL\models\checkpoints\waiIllustriousSDXL_v160.safetensors"
pipe = StableDiffusionXLPipeline.from_single_file(CHECKPOINT, torch_dtype=torch.float16)
pipe.to("cuda"); pipe.vae.enable_slicing()
img = pipe(
    prompt="dark leather fantasy game UI panel background, worn texture, no characters, abstract, dark brown",
    num_inference_steps=20, width=512, height=512
).images[0]
```

---

## 六、后续计划

- [ ] 为 EquipPanel 生成暗色石板背景纹理
- [ ] 为 StatPanel 生成羊皮纸/皮革背景
- [ ] 用 wai-sdxl 生成宽幅背包底图（800×600）
- [ ] LoRA：安装 peft 后可叠加 GameIconResearch_skill4 LoRA 提升质量