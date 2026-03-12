# SOP：文件操作

> 版本：v1.0 | 最后更新：2026-03-12

## 步骤

1. 优先使用 PowerShell 原生命令（Get-Content, Set-Content, Copy-Item 等）
2. 路径使用 Windows 风格反斜杠
3. 写文件时指定 UTF-8 编码：`[System.Text.Encoding]::UTF8`
4. 操作前确认路径存在，用 `New-Item -ItemType Directory -Force` 创建目录
