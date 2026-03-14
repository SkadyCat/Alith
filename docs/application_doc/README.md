# Application 应用总览

> 路径: `E:\docs-service\application\`  
> 各应用文档详见本目录下对应文件。

## 应用列表

| 应用 | 端口 | 类型 | 说明 |
|------|------|------|------|
| [comfyui-service](./comfyui-service.md) | 8188 | Python FastAPI | ComfyUI 兼容图像生成服务，封装 Flux 后端 |
| [sdxl-service](./sdxl-service.md) | 8189 | Python FastAPI | SDXL/SD1.5 图像生成，支持 WAI 插画和游戏图标模型 |
| [hunyuan](./hunyuan.md) | 8044 | Node.js Express | 混元生3D，文字转 3D 模型，结果上传 COS |
| [MagicWorld](./magicworld.md) | 8033 | Node.js Express | AIGC 图像画廊，游戏素材字典与 COS 图标管理 |
| [jump_game](./jump_game.md) | — | 纯前端 HTML | 跳一跳网页小游戏，长按蓄力跳跃 |
| alith | — | — | 目录暂无文件 |

## 相关服务依赖

```
Flux 后端        → http://localhost:8331  (comfyui-service 依赖)
腾讯混元 API     → hunyuan.tencentcloudapi.com  (comfyui-service /i2t 使用)
腾讯混元生3D API → ai3d.tencentcloudapi.com  (hunyuan 使用)
腾讯云 COS       → magicworld-1304036735.cos.ap-guangzhou.myqcloud.com  (hunyuan/MagicWorld 使用)
```