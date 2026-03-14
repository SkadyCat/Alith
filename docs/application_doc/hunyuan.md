# 混元生3D (Hunyuan 3D)

> **端口**: 8044  
> **类型**: Node.js Express 服务  
> **路径**: pplication/hunyuan/  
> **启动**: 
ode server.js 或 
pm start

## 简介

调用腾讯混元生3D API（i3d.tencentcloudapi.com），根据文本 prompt 生成 3D 模型（GLB 格式），并自动上传到腾讯云 COS 存储。

## 环境变量（.env）

| 变量 | 说明 |
|------|------|
| SECRET_ID | 腾讯云 API 密钥 ID |
| SECRET_KEY | 腾讯云 API 密钥 Key |
| COS_BUCKET | COS 桶名，默认 magicworld-1304036735 |
| COS_REGION | COS 区域，默认 p-guangzhou |

## 依赖

`
express, dotenv, cos-nodejs-sdk-v5, tencentcloud-sdk-nodejs-ai3d
`

## API 接口

### POST /api/generate — 提交 3D 生成任务

**请求体**
`json
{
  "prompt": "一只可爱的青蛙，Q版卡通风格，绿色皮肤，大眼睛",
  "model": "3.0"
}
`

**响应**
`json
{ "success": true, "jobId": "abc123" }
`

调用腾讯云 SubmitHunyuanTo3DProJob 接口提交任务，返回 jobId。

### GET /api/job/:jobId — 查询任务状态

轮询任务状态，调用 QueryHunyuanTo3DProJob。

**响应**
`json
{
  "success": true,
  "jobId": "abc123",
  "status": "WAIT | RUNNING | DONE | FAIL",
  "files": [{ "Type": "glb", "Url": "https://..." }]
}
`

状态说明：
- WAIT — 排队中
- RUNNING — 生成中
- DONE — 完成
- FAIL — 失败

### POST /api/job/:jobId/upload — 下载并上传到 COS

任务完成后，下载 GLB 模型文件和预览图，上传至 COS。

**响应**
`json
{
  "success": true,
  "jobId": "abc123",
  "results": [
    { "type": "glb", "cosUrl": "https://magicworld-xxx.cos.ap-guangzhou.myqcloud.com/hunyuan3d/xxx.glb", "cosKey": "hunyuan3d/xxx.glb" },
    { "type": "preview", "cosUrl": "https://...", "cosKey": "hunyuan3d/xxx_preview.png" }
  ]
}
`

### GET /api/models — 列出已生成的本地模型

列出 models/ 目录下的文件列表。

## 工作流程

1. POST /api/generate 提交任务，得到 jobId
2. 轮询 GET /api/job/:jobId，等待 status === "DONE"
3. POST /api/job/:jobId/upload 下载模型到 models/ 并上传 COS
4. 获取 COS URL，供前端 3D 渲染使用

## COS 存储路径

`
hunyuan3d/{jobId}_frog.glb       — 3D 模型
hunyuan3d/{jobId}_preview.png    — 预览图
`

## 认证

使用腾讯云 TC3-HMAC-SHA256 签名，由 uildHeaders() 自动处理，API 版本 2025-05-13。