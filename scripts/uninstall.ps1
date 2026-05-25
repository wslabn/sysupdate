# uninstall.ps1 (run as Administrator)
#Requires -RunAsAdministrator

$AppName    = "SysUpdate Agent"
$InstallDir = "$env:ProgramFiles\SysUpdate"
$DataDir    = "$env:ProgramData\sysupdate"
$UninstKey  = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\SysUpdate"

Write-Host "`n=== Uninstalling $AppName ===" -ForegroundColor Cyan

# Stop and remove scheduled tasks
$tasks = @("SysUpdate Agent", "SysUpdate Drivers", "SysUpdate WS Agent")
foreach ($t in $tasks) {
    if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $t -Confirm:$false
        Write-Host "  Removed task: $t"
    }
}

# Kill any running agent processes
Get-Process powershell -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -match "SysUpdate|agent-ws|agent\.ps1"
} | Stop-Process -Force -ErrorAction SilentlyContinue

# Remove files
if (Test-Path $InstallDir) {
    Remove-Item -Path $InstallDir -Recurse -Force
    Write-Host "  Removed: $InstallDir"
}

# Ask about data directory
$keep = Read-Host "  Keep machine data in $DataDir? (y/n)"
if ($keep -ne 'y') {
    Remove-Item -Path $DataDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  Removed: $DataDir"
} else {
    Write-Host "  Kept: $DataDir"
}

# Remove registry entry
if (Test-Path $UninstKey) {
    Remove-Item -Path $UninstKey -Force
    Write-Host "  Removed registry entry"
}

Write-Host "`n[OK] $AppName uninstalled." -ForegroundColor Green
