# MagicWorld

> **端口**: `8033`  
> **类型**: Node.js Express 服务  
> **路径**: `application/MagicWorld/`  
> **启动**: `node server.js` 或 `npm start`

## 简介

AIGC 图像画廊与游戏素材管理平台。提供技能/装备/道具字典 API，图标资源托管在腾讯云 COS。

## 环境变量（`.env`）

| 变量 | 说明 |
|------|------|
| `SECRET_ID` | 腾讯云 COS 密钥 ID |
| `SECRET_KEY` | 腾讯云 COS 密钥 Key |
| `PUBLIC_URL` | MagicWorld 公网访问地址（可选），填写后 DocSpace 顶部菜单按钮将使用该地址 |

> **配置公网访问**：在 `.env` 中填写 `PUBLIC_URL`，例如 `PUBLIC_URL=http://1.2.3.4:8033`。  
> 配置后 DocSpace 的 MagicWorld 按钮将自动切换为公网地址，方便外网访问。

COS 桶：`magicworld-1304036735`，区域：`ap-guangzhou`

## 依赖

express, dotenv, cos-nodejs-sdk-v5

## API 接口

### `GET /api/dict/skills` — 技能字典

### `GET /api/dict/equipment` — 装备字典

### `GET /api/dict/items` — 道具字典

读取 `docs/application_doc/magicworld/design/{skills|equipment|items}.json`，若配置 COS 凭证，自动将图标路径（`/icons/xxx.png`）替换为 COS 公网 URL。

### `GET /api/cos/status` — 检查 COS 凭证状态

```json
{ "configured": true, "bucket": "magicworld-1304036735", "region": "ap-guangzhou" }
```

### `POST /api/cos/upload-test` — 测试上传（前 N 张图标）

```json
{ "limit": 5, "prefix": "gameicons/" }
```

### `POST /api/cos/upload-all` — 批量上传全部图标

将 `public/icons/` 目录下所有 PNG 上传到 COS `gameicons/` 路径。

## 文件结构

```
MagicWorld/
  server.js              — 主服务
  public/
    index.html           — 前端页面
    icons/               — 本地图标（PNG）
  .env                   — COS 凭证
docs/application_doc/magicworld/design/
  skills.json            — 技能数据
  equipment.json         — 装备数据
  items.json             — 道具数据
```

## COS 图标 URL 格式

```
https://magicworld-1304036735.cos.ap-guangzhou.myqcloud.com/gameicons/{filename}.png
```