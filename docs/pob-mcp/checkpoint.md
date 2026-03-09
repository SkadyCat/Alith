# PoB MCP Server 进度检查点
最后更新: 2026-03-07 12:45
上下文进度: ~18%

## 已完成
- Phase 1: 环境探索 + PoB XML 格式分析 ✅
- Phase 2: HTTP REST API 服务器创建 ✅
- Phase 3: load_build + pob_status 端点，通过 shell 控制 PoB ✅
- Phase 4: 成功加载 冬潮烙印 build ✅

## MCP 服务器
- 端口: **7892**
- 文件: `G:\GameExPro3\Alith\application\pob-mcp\pob_http_server.py`
- Python: `E:\python\python.exe`

## 启动命令
`
E:\python\python.exe -u -c "import sys, importlib.util, uvicorn; sys.argv=['p','7892']; spec=importlib.util.spec_from_file_location('m', r'G:\GameExPro3\Alith\application\pob-mcp\pob_http_server.py'); mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); uvicorn.run(mod.app, host='0.0.0.0', port=7892, log_level='warning')"
`

## API 端点
| 端点 | 方法 | 说明 |
|------|------|------|
| GET /builds | GET | 列出所有构建文件 |
| GET /pob_status | GET | PoB 进程状态 + 当前 build |
| POST /load_build | POST | 加载 build（解码→保存→重启 PoB） |
| POST /decode | POST | 解码 PoB base64 code |
| POST /summary | POST | 构建摘要 |
| POST /skills | POST | 技能列表 |
| POST /items | POST | 装备列表 |
| POST /stats | POST | 全部属性 |
| POST /analyze | POST | 完整分析 |

## /load_build 请求格式
`json
{
  "doc_path": "poe/pob_list/冬潮烙印.md",  // docs 服务路径
  "save_as": "dongchao-yinluo",             // ASCII 文件名
  "launch_pob": true                        // 是否重启 PoB
}
`

## PoB 路径
- 程序: `G:\poegj\PoeCharm3[20251103]-Release-3.5.0\PathOfBuildingCommunity-Portable\Path of Building.exe`
- Builds: `...\Builds\`
- Settings.xml: 在同目录（便携模式）

## 验证结果
- 冬潮烙印: Witch/Elementalist Lv73
- PoB 窗口标题: `dongchao-yinluo (Elementalist) - Path of Building`
- 通过 shell（文件写入+进程控制），完全无键盘操作

## 已知问题（已解决）
- PowerShell 需要全路径: `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`
- 中文 URL 需要 urllib.parse.quote 编码
- PoB 文件名不能用中文（Lua io.open 问题），改用 ASCII