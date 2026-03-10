# 🎮 UE Editor MCP 工具全景报告（2026年3月）

> 整理时间：2026-03-10 | 来源：GitHub 实时检索

Model Context Protocol (MCP) 是 Anthropic 提出的开放协议标准，已于 2025 年 12 月捐赠给 Linux 基金会，并被 Claude、ChatGPT、Cursor、Windsurf 等主流 AI 工具广泛支持。在 Unreal Engine 领域，一批开发者正在利用 MCP 协议将 AI 助手直接接入 UE Editor，推动"自然语言驱动游戏开发"的变革。

---

## 🏆 热门项目速览（按 ⭐ 排序）

| 项目 | 作者 | ⭐ | 语言 | 特点 |
|------|------|---|------|------|
| [UnrealClaude](https://github.com/Natfii/UnrealClaude) | Natfii | 252 | C++ | Claude Code CLI 深度集成，UE 5.7 |
| [UnrealMCPBridge](https://github.com/appleweed/UnrealMCPBridge) | appleweed | 40 | C++ | 开放完整 UE Python API，可从 Fab 商店购买 |
| [UnrealClientProtocol](https://github.com/Italink/UnrealClientProtocol) | Italink | 15 | C++ | 反射驱动原子协议，给 AI Agent 装上"双手" |
| [ue5-mcp-bridge](https://github.com/Natfii/ue5-mcp-bridge) | Natfii | 12 | JavaScript | 独立 MCP 服务器，支持所有兼容客户端 |
| [UE-Agent-Asset-Toolkit](https://github.com/bradenleague/UE-Agent-Asset-Toolkit) | bradenleague | 10 | Python | 无需打开编辑器即可检索 .uasset 资产 |
| [UnrealEngine5-mcp](https://github.com/gimmeDG/UnrealEngine5-mcp) | gimmeDG | 3 | Python | 自然语言控制 UE 5.6+，针对大型项目 |
| [monolith](https://github.com/tumourlove/monolith) | tumourlove | 3 | C++ | 9 模块/117 个动作，替代 8 个独立 MCP 服务器 |
| [UnrealEngine_Bridge](https://github.com/JosephOIbrahim/UnrealEngine_Bridge) | JosephOIbrahim | 1 | Python | 39 个工具，涵盖场景/材质/Actor 操控 |
| [ue-mcp](https://github.com/erhansiraci/ue-mcp) | erhansiraci | 0 | TypeScript | 基于 UE Remote Control API |

---

## 📦 重点项目详解

### 1. UnrealClaude ⭐ 252（最受关注）

**定位**：将 Claude Code CLI 直接嵌入 UE 5.7 Editor

**核心特点**：
- 在编辑器内直接调用 `claude` 命令行工具
- 内置 UE 5.7 官方文档上下文（无需手动查文档）
- 支持 Win64 / Linux / macOS (Apple Silicon)
- 20+ MCP 工具，涵盖 Level、Actor、Blueprint、Animation

**支持的 AI 客户端**：Claude Code CLI、Claude Desktop、Cursor、ChatGPT Desktop、Windsurf、Replit

---

### 2. UnrealMCPBridge ⭐ 40（最成熟/可商用）

**定位**：标准 MCP 服务器插件，开放完整 UE Python API

**核心特点**：
- **可从 Fab 商店直接安装**（无需手动编译）
- 以 Socket 方式运行（默认端口 `127.0.0.1:9000`）
- 工具扩展简单：用 Python 装饰器定义新工具/Prompt
- 内置 Prompt：`create_castle`、`create_town`

**工具扩展模板**：
```python
@mcp.tool()
def my_tool() -> str:
    """描述这个工具做什么"""
    result = send_command("my_command")
    return result.get("result", "")
```

---

### 3. UnrealClientProtocol (UCP) ⭐ 15（架构最独特）

**定位**：原子级通信协议，让 AI Agent 掌握 UE 反射系统的完整能力

**核心哲学**："不替 Agent 做决策，只给它能力"

**5 种原子命令**：

| 命令 | 功能 |
|------|------|
| `find` | 查找 UObject |
| `call` | 调用 UFunction |
| `get` | 读取 UPROPERTY |
| `set` | 写入 UPROPERTY（自动注册 Undo/Redo） |
| `describe` | 内省元数据 |

**技术特点**：
- 零侵入：纯插件架构，不改引擎源码
- 批量执行：一次请求发多个命令
- 默认监听 `127.0.0.1:9876`
- 兼容 Cursor / Claude Code / OpenCode 的 Skill 描述文件

---

### 4. ue5-mcp-bridge ⭐ 12（协议最通用）

**定位**：从 UnrealClaude 独立出来的纯 MCP 服务器层

**支持客户端**（全部兼容）：Claude Code、Claude Desktop、ChatGPT Desktop、Cursor、Replit、Windsurf、Sourcegraph Cody

**工具列表（部分）**：

| 工具 | 功能 |
|------|------|
| `unreal_status` | 检查编辑器连接状态 |
| `unreal_get_ue_context` | 获取 UE API 文档 |
| `unreal_spawn_actor` | 在 Level 中 Spawn Actor |
| `unreal_move_actor` | 移动/旋转/缩放 Actor |
| `unreal_asset_search` | 按类/路径/名称搜索资产 |
| `unreal_blueprint_create` | 创建新蓝图 |
| `unreal_run_console_command` | 执行控制台命令 |

---

### 5. UE-Agent-Asset-Toolkit ⭐ 10（离线资产分析利器）

**定位**：不启动 UE Editor，直接解析 `.uasset` 二进制文件

**独特价值**：适合 CI/CD 流水线、代码审查、大型项目资产分析

**两个核心工具**：

| 工具 | 功能 |
|------|------|
| `unreal_search` | 支持精确/语义/引用/继承/GameplayTag 多种搜索 |
| `inspect_asset` | 返回 Blueprint/Widget/Material/DataTable 结构化数据 |

---

### 6. monolith ⭐ 3（All-in-One 方案）

**定位**：9 个模块、117 个动作，一个插件替代 8 个独立 MCP 服务器

---

## 🔧 技术栈对比

| 项目 | 传输方式 | UE 集成方式 | 是否需要编辑器运行 |
|------|---------|------------|------------------|
| UnrealClaude | stdio | UE Plugin (C++) | ✅ 需要 |
| UnrealMCPBridge | TCP Socket | UE Plugin (C++) | ✅ 需要 |
| UnrealClientProtocol | TCP/JSON | UE Plugin (C++) | ✅ 需要 |
| ue5-mcp-bridge | stdio | HTTP API | ✅ 需要 |
| UE-Agent-Asset-Toolkit | stdio | 直接解析 .uasset | ❌ 不需要 |
| ue-mcp | HTTP | UE Remote Control API | ✅ 需要 |

---

## 💡 选型建议

| 使用场景 | 推荐方案 |
|---------|---------|
| 快速上手，不想编译 | **UnrealMCPBridge**（Fab 商店直装） |
| 深度集成 Claude Code | **UnrealClaude** |
| 需要完整引擎反射能力 | **UnrealClientProtocol** |
| 多 AI 客户端兼容 | **ue5-mcp-bridge** |
| 离线资产分析 / CI 场景 | **UE-Agent-Asset-Toolkit** |
| 想一套替代所有 | **monolith** |

---

## 📈 趋势观察

1. **标准化加速**：MCP 协议捐赠 Linux 基金会后，各 AI 客户端纷纷跟进，UE MCP 生态迎来爆发
2. **从"会话辅助"到"编辑器控制"**：工具从问答升级为直接操作 Actor / Blueprint / Level
3. **反射驱动是核心**：UCP 的"原子协议"思路影响后来者——暴露引擎能力而非包装固定接口
4. **离线分析价值凸显**：UE-Agent-Asset-Toolkit 证明不依赖运行编辑器的 AI 资产分析同样有市场
5. **整合趋势**：monolith 这样的 All-in-One 方案出现，说明社区正在解决多服务器配置复杂性

---

*数据来源：GitHub 实时搜索，整理于 2026-03-10*