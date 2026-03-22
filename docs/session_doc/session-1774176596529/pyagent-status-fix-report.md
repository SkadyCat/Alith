# pyagentStatusText 修复 + 退出码:1 分析报告

## 一、退出码:1 根因分析

**原因：Claude API 服务端错误，导致 agent 框架终止 shell 进程**

- 现象：POLL 脚本运行中出现多次 `Response was interrupted due to a server error. Retrying...`
- 根因：不是 POLL 脚本本身的 bug，而是 GitHub Copilot/Claude API 返回了服务端错误
- agent 框架检测到持续错误后，终止当前 shell 进程，返回退出码 1
- PowerShell 版本为 7.5.4，`-OperationTimeoutSeconds` 等参数完全支持，排除 PS 兼容性问题

**结论**：此问题属于 API 基础设施层，POLL 脚本本身无需修改。

## 二、pyagentStatusText 修复（public/app.js）

### 问题根因（双重）

| 原因 | 说明 |
|------|------|
| **通道隔离** | POLL 调用 `/agent/set-status` → 广播到 `/agent/stream`；pyagentStatusText 只监听 `/pyagent/stream`，两通道完全隔离 |
| **状态映射缺失** | `/pyagent/stream` 的 status 处理器只映射 `running/done/error`，`waiting/working` 均 fallthrough → `'空闲'` |

### 修复方案（已实施）

#### 修复 1：session-status SSE 处理器跨通道补丁（第 2026 行附近）

```javascript
// 同步 PyAgent 面板状态栏（跨 SSE 通道补丁）
const _pyTxtEl = document.getElementById('pyagentStatusText');
const _pyDotEl = document.getElementById('pyagentStatusDot');
if (_pyTxtEl) {
  const _pyTextMap = { running: '运行中', waiting: 'POLL等待', working: '执行中', done: '已完成', error: '出错' };
  const _pyMapped = _pyTextMap[status];
  if (_pyMapped) _pyTxtEl.textContent = _pyMapped;
  else if (status === 'idle') _pyTxtEl.textContent = '空闲';
}
if (_pyDotEl) {
  const _pyDotRunning = status === 'running' || status === 'waiting' || status === 'working';
  _pyDotEl.className = 'agent-status-dot' +
    (_pyDotRunning ? ' running' : status === 'error' ? ' error' : status === 'done' ? ' done' : '');
}
```

#### 修复 2：500ms tick 保底机制（第 4659 行附近）

当 pyagent 本身没在运行时（`!pyagentRunning`），每 500ms 从 `/agent/status` 读取 `agentStatus` 同步到 pyagentStatusText：

```javascript
if (!pyagentRunning) {
  const agSt = d.status || 'idle';
  // 更新 pyagentStatusText & pyagentStatusDot
  // waiting → 'POLL等待'，working → '执行中'，running → '运行中'
  // idle 时重置为 '空闲'
}
```

### 状态映射（更新后）

| agentStatus | pyagentStatusText |
|-------------|-------------------|
| running     | 运行中             |
| waiting     | POLL等待           |
| working     | 执行中             |
| done        | 已完成             |
| error       | 出错               |
| idle        | 空闲               |