# SDXL Service

> **端口**: `8189`  
> **类型**: Python FastAPI 服务  
> **路径**: `application/sdxl-service/`  
> **启动**: `python main.py`

## 简介

基于 Diffusers 的 SDXL / SD1.5 图像生成服务，支持 CivitAI 模型（`.safetensors`），包含 LoRA 加载与融合。

## 内置模型

| 模型 ID | 名称 | 类型 | 分辨率 | Steps |
|---------|------|------|--------|-------|
| `wai-sdxl` | WAI-Illustrious SDXL v1.6 | sdxl | 832x1216 | 24 |
| `gameicon` | GameIcon Institute v3.0 | sd15 | 512x512 | 20 |
| `gameicon-icons` | GameIcon + sxz-icons LoRA | sd15 | 512x512 | 20 |

## API 接口

### `POST /generate` — 生成图像

```json
{
  "prompt": "a cute frog, game icon style",
  "model": "gameicon",
  "width": 512,
  "height": 512,
  "steps": 20,
  "guidance_scale": 7.5,
  "seed": -1
}
```

响应:
```json
{ "success": true, "filename": "20260302_abcd1234.png", "model": "gameicon", "seed": 42, "elapsed_seconds": 3.5 }
```

### `GET /outputs/{filename}` — 下载图像

### `GET /models` — 列出可用模型

### `GET /health` — 健康检查（含 VRAM 用量）

## 特性

- 懒加载：首次调用时加载模型，切换时自动卸载旧模型并清空 VRAM
- LoRA 支持：diffusers 内置接口加载并融合（fuse_lora）
- 并发锁：asyncio.Lock 保护推理，防止并发冲突
- SDXL 模式开启 VAE slicing 节省显存