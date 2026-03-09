# PoB Web Viewer

**地址**: http://localhost:7893  
**端口**: 7893  
**路径**: G:\GameExPro3\Alith\application\pob-web\

## 功能

- 📋 **构筑代码解析** — 粘贴 PoB base64 代码，自动解析
- 📂 **文档库加载** — 从 poe/pob_list/ 选择构筑
- 🈶 **中文界面** — 加载 PoeCharm3 zh-rCN 翻译 CSV
- 📊 **属性面板** — 生命/ES/魔力/护甲/DPS/抗性等
- 💎 **技能配置** — 插槽+宝石链接（中文宝石名）
- 🗡️ **装备展示** — 17个插槽，稀有度颜色
- 🌳 **被动天赋** — 已分配节点统计

## 启动

```bat
cd G:\GameExPro3\Alith\application\pob-web
E:\python\python.exe server.py
```

## API

| 接口 | 说明 |
|------|------|
| `GET /` | Web 界面 |
| `POST /api/analyze/code` | `{"code":"eNrt..."}` 解析构筑代码 |
| `POST /api/analyze/doc` | `{"doc_path":"poe/pob_list/xxx.md"}` 从文档解析 |
| `GET /api/pob-list` | 列出 poe/pob_list/ 中的构筑 |
| `GET /api/open-in-pob/{name}` | 在桌面 PoB 中打开构筑 |

## 架构

- 后端: FastAPI + Python (port 7893)
- 翻译: 加载 `G:\poegj\PoeCharm3...\Data\Translate\zh-rCN\` CSV 文件
- 前端: 纯 HTML/CSS/JS，PoE 暗色主题
- 数据: 直接解析 PoB XML（无需 PoB 进程）