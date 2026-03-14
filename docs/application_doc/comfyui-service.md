# ComfyUI Service

> **端口**: 8188  
> **类型**: Python FastAPI 服务  
> **路径**: pplication/comfyui-service/  
> **启动**: 运行 unserver.bat（使用 Flux venv 的 Python）

## 简介

ComfyUI-compatible 图像生成服务，封装 Flux 后端（端口 8331），对外提供标准 ComfyUI API。  
同时支持通过腾讯混元 Vision API 进行图生文（Image-to-Text）。

## 依赖

`
fastapi, uvicorn, httpx, pyyaml
`

## 配置（config.yaml）

| 字段 | 值 |
|------|----|
| 服务端口 | 8188 |
| Flux 后端地址 | http://localhost:8331 |
| Flux 输出目录 | E:/AIGC/Flux/backend/outputs |
| 本地输出目录 | outputs/ |
| 混元 Secret ID/Key | 配置在 config.yaml |

## API 接口

### POST /prompt — 提交生成任务

从 ComfyUI workflow JSON 中提取提示词和参数，异步调用 Flux 后端生成图像。

**请求体**（ComfyUI 格式）
`json
{
  "prompt": { "<node_id>": { "class_type": "CLIPTextEncode", "inputs": { "text": "a cat" } } },
  "client_id": "optional"
}
`

**响应**
`json
{ "prompt_id": "uuid", "number": 1 }
`

### GET /history/{prompt_id} — 查询任务结果

`json
{
  "uuid": {
    "status": "done",
    "outputs": { "images": [{ "filename": "20260302_abcd1234.png", "subfolder": "", "type": "output" }] },
    "seed": 12345,
    "elapsed": 3.2
  }
}
`

### GET /history — 获取所有历史任务

### GET /view?filename=xxx.png — 下载生成的图像

### POST /i2t — 图生文（Image-to-Text）

上传图片，调用混元 hunyuan-vision 模型，返回图像描述（用于生成 3D 模型提示词）。

**请求**: multipart/form-data，字段 image（图片文件）

**响应**
`json
{ "success": true, "description": "一只绿色的卡通青蛙..." }
`

### GET /system_stats — 系统/GPU 信息

### GET /queue — 队列状态

### WS /ws — WebSocket（状态推送，桩实现）

### GET /docs — Swagger 文档

## 工作流程

1. 客户端以 ComfyUI workflow JSON 格式提交 POST /prompt
2. 服务解析 workflow，提取正向提示词和采样参数（steps, width, height, seed 等）
3. 异步调用 Flux 后端 /api/generate
4. 图像生成后复制（或 HTTP 下载）到本地 outputs/ 目录
5. 客户端轮询 GET /history/{prompt_id} 获取结果，通过 GET /view 下载图像