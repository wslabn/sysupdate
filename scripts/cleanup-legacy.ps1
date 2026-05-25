# cleanup-legacy.ps1 — Remove old PowerShell agent (run as Administrator)
#Requires -RunAsAdministrator

Write-Host "`n=== Removing legacy SysUpdate agent ===" -ForegroundColor Cyan

# Remove scheduled tasks
@("SysUpdate Agent", "SysUpdate Drivers", "SysUpdate WS Agent") | ForEach-Object {
    if (Get-ScheduledTask -TaskName $_ -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $_ -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $_ -Confirm:$false
        Write-Host "  Removed task: $_"
    }
}

# Kill running agent processes
Get-Process powershell -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -match "agent-ws|agent\.ps1|update-drivers"
} | Stop-Process -Force -ErrorAction SilentlyContinue

# Remove installed files
@("$env:ProgramFiles\SysUpdate", "C:\temp\agent-ws.ps1") | ForEach-Object {
    if (Test-Path $_) { Remove-Item $_ -Recurse -Force; Write-Host "  Removed: $_" }
}

# Remove registry entry
$key = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\SysUpdate"
if (Test-Path $key) { Remove-Item $key -Force; Write-Host "  Removed registry entry" }

# Keep machine-id so Electron app inherits identity
Write-Host "`n[OK] Legacy agent removed. Machine ID preserved in $env:ProgramData\sysupdate\" -ForegroundColor Green
