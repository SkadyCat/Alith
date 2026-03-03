# DocSpace Shell Tool Runner
# Reads command from stdin, executes via PowerShell, outputs JSON to stdout.
# Usage: echo "Get-Date" | powershell -NoProfile -NonInteractive -File tools\shell_runner.ps1

$ErrorActionPreference = 'Continue'
$command = $input | Out-String

if ([string]::IsNullOrWhiteSpace($command)) {
    Write-Output ('{"stdout":"","stderr":"No command provided","exitCode":1}')
    exit 0
}

$stdoutLines = [System.Collections.Generic.List[string]]::new()
$stderrLines = [System.Collections.Generic.List[string]]::new()
$exitCode = 0

try {
    $result = Invoke-Expression $command 2>&1
    foreach ($item in $result) {
        if ($item -is [System.Management.Automation.ErrorRecord]) {
            $stderrLines.Add($item.ToString())
        } else {
            $stdoutLines.Add(($item | Out-String).TrimEnd())
        }
    }
    if ($LASTEXITCODE) { $exitCode = $LASTEXITCODE }
} catch {
    $stderrLines.Add($_.Exception.Message)
    $exitCode = 1
}

$out = ($stdoutLines -join "`n").TrimEnd()
$err = ($stderrLines -join "`n").TrimEnd()

@{ stdout = $out; stderr = $err; exitCode = $exitCode } | ConvertTo-Json -Compress -Depth 2