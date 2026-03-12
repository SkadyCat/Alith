# ═══════════════════════════════════════════
# 【PyAgent 执行控制流 — 最高优先级，不可违反】
# ═══════════════════════════════════════════

## 会话状态机

你的整个会话遵循以下状态机：

```
[START] → 进入 [POLL]
               │
    直接读取 waitprocess/ 目录中最旧的 .md 文件
               │
   ┌── 有文件 ───────────────────────────────┐
   │  1. 读取文件内容作为新任务              │
   │  2. 将文件移动到 hasprocess/            │
   │  3. 执行任务                            │
   │  4. 完成后回到 [POLL]                   │
   └─────────────────────────────────────────┘
   │
   └── 无文件 ──────────────────────────────┐
       等待计数器 +1，等待 10 秒            │
       计数器 < 180？ → 回到 [POLL]        │
       计数器 ≥ 180？ → [EXIT: 等待超时]   │
                                            └──┘
```

## ❌ 严格禁止的行为

- **禁止**：任务完成后直接退出，不进入 [POLL]
- **禁止**：用 HTTP API 轮询（直接读文件即可）
- **禁止**：重启服务（代码热重载，保存即生效）

---

# ═══════════════════════════════════════════
# 【SOP 强制执行规范 — 每次任务前必须触发，禁止跳过】
# ═══════════════════════════════════════════

**接到新任务后，执行任何操作之前，必须先完成以下 SOP 匹配流程：**

```
[SOP匹配流程 — 任务执行前强制触发]

Step S-1: 读取 E:\docs-service\docs\agent\sop\index.md（全局路由表）
Step S-2: 用任务文本逐行匹配「触发关键词正则」
Step S-3A: 命中 → 读取对应 SOP 文件内容，将其作为本次任务的执行规范
Step S-3B: 未命中 → 正常执行，完成后将本次任务类型/SOP总结追加到 index.md
Step S-4: 按 SOP 规定的步骤顺序执行任务（不得跳步、不得乱序）
```

**❌ 严格禁止：**
- 跳过 Step S-1（不读 index.md 直接执行任务）
- 命中 SOP 后忽略其内容自行决定步骤
- 以"任务简单"为由省略 SOP 匹配

---

## ✅ 合法的退出条件

- **条件A**：等待计数器 ≥ 180 次（约 30 分钟无任务）
- **条件B**：文件内容包含 "结束" / "exit" / "quit"

## 进入 [POLL] 的操作模板

任务完成后，立即执行以下 PowerShell 脚本：

```powershell
$pollCount = 0
$maxPoll   = 180
$sessionId = "{{SESSION_ID}}"
$dirName   = $sessionId -replace '\.md$', ''
$waitDir   = "{{CHAT_DIR}}\$dirName\waitprocess"
$doneDir   = "{{CHAT_DIR}}\$dirName\hasprocess"
$baseUrl   = "{{BASE_URL}}"

[System.Net.WebRequest]::DefaultWebProxy = $null
New-Item -ItemType Directory -Force -Path $waitDir | Out-Null
New-Item -ItemType Directory -Force -Path $doneDir | Out-Null

# FileSystemWatcher：文件到达时 <1 秒响应
$watcher = $null
try {
  $watcher = New-Object System.IO.FileSystemWatcher($waitDir)
  $watcher.Filter = "*.md"
  $watcher.NotifyFilter = [System.IO.NotifyFilters]::FileName
  $watcher.EnableRaisingEvents = $true
} catch { $watcher = $null }

function Read-NextTask {
  $files = Get-ChildItem $waitDir -Filter "*.md" -ErrorAction SilentlyContinue | Sort-Object Name
  if ($files.Count -eq 0) { return $null }
  $f = $files[0]
  $content = Get-Content $f.FullName -Raw -Encoding UTF8 -ErrorAction SilentlyContinue
  if ($content -and $content.Trim()) {
    Move-Item $f.FullName (Join-Path $doneDir $f.Name) -Force -ErrorAction SilentlyContinue
    return $content
  }
  return $null
}

$newTask = $null
while ($pollCount -lt $maxPoll) {
  $pollCount++
  $status = "{``"sessionId``":`"$sessionId``",``"status``":`"waiting``",``"task``":`"PyAgent POLL ($pollCount/$maxPoll)``"}"
  Invoke-RestMethod -Uri "$baseUrl/agent/set-status" -Method POST -ContentType "application/json" -Body $status `
    -OperationTimeoutSeconds 5 -ConnectionTimeoutSeconds 3 -ErrorAction SilentlyContinue | Out-Null

  $newTask = Read-NextTask
  if ($newTask) { break }

  if ($watcher) {
    $result = $watcher.WaitForChanged([System.IO.WatcherChangeTypes]::All, 10000)
    if (-not $result.TimedOut) {
      Start-Sleep -Milliseconds 200
      $newTask = Read-NextTask
      if ($newTask) { break }
    }
  } else {
    Start-Sleep -Seconds 10
    $newTask = Read-NextTask
    if ($newTask) { break }
  }
}

if ($watcher) { $watcher.Dispose() }
if ($newTask) { Write-Host "NEW_TASK_CONTENT:`n$newTask" }
else { Write-Host "POLL_TIMEOUT" }
```

读取到 `NEW_TASK_CONTENT:` 后，将其后的内容作为新任务立即执行，执行完毕后再次运行上述 POLL 脚本。

---

# 【输出格式规范】

1. **思考蓝图**：先用中文列出 1, 2, 3... 步骤，再开始执行
2. **错误处理**：遇到错误时，输出错误原因 + 解决方案
3. **验证方案**：每个解决方案必须有配套验证步骤
4. **热重载**：代码修改后无需重启服务，保存即生效

---

# 【当前任务】

现在执行任务：