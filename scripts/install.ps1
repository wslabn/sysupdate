# install.ps1 (run as Administrator)
#Requires -RunAsAdministrator

$AppName    = "SysUpdate Agent"
$AppVersion = "1.0.0"
$Publisher  = "SysUpdate"
$BaseUrl    = "https://raw.githubusercontent.com/wslabn/sysupdate/main/scripts"
$InstallDir = "$env:ProgramFiles\SysUpdate"
$DataDir    = "$env:ProgramData\sysupdate"
$UninstKey  = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\SysUpdate"

Write-Host "`n=== Installing $AppName v$AppVersion ===" -ForegroundColor Cyan

# Create directories
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

# Download scripts
$scripts = @("agent.ps1", "agent-ws.ps1", "update-drivers.ps1")
foreach ($s in $scripts) {
    Write-Host "  Downloading $s..."
    Invoke-WebRequest -Uri "$BaseUrl/$s" -OutFile "$InstallDir\$s" -UseBasicParsing
}

# Copy uninstaller
Invoke-WebRequest -Uri "$BaseUrl/uninstall.ps1" -OutFile "$InstallDir\uninstall.ps1" -UseBasicParsing

# Generate machine ID if needed
$IdFile = "$DataDir\machine-id"
if (-not (Test-Path $IdFile)) {
    $board = (Get-CimInstance Win32_BaseBoard).SerialNumber
    if (-not $board -or $board -match "^\s*$|To be filled") {
        $board = [System.Guid]::NewGuid().ToString()
    }
    $board | Set-Content $IdFile
}

# Register scheduled tasks
$psExe = "powershell.exe"
$flags = "-ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File"

# Hourly check-in
$action   = New-ScheduledTaskAction -Execute $psExe -Argument "$flags `"$InstallDir\agent.ps1`""
$trigger  = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Hours 1) -Once -At (Get-Date)
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -StartWhenAvailable
Register-ScheduledTask -TaskName "SysUpdate Agent" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force | Out-Null

# Daily driver update at 2am
$action2   = New-ScheduledTaskAction -Execute $psExe -Argument "$flags `"$InstallDir\update-drivers.ps1`""
$trigger2  = New-ScheduledTaskTrigger -Daily -At "2:00AM"
$settings2 = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -StartWhenAvailable
Register-ScheduledTask -TaskName "SysUpdate Drivers" -Action $action2 -Trigger $trigger2 -Settings $settings2 -RunLevel Highest -Force | Out-Null

# Persistent WebSocket agent
$action3   = New-ScheduledTaskAction -Execute $psExe -Argument "$flags `"$InstallDir\agent-ws.ps1`""
$trigger3  = New-ScheduledTaskTrigger -AtStartup
$settings3 = New-ScheduledTaskSettingsSet -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 999 -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName "SysUpdate WS Agent" -Action $action3 -Trigger $trigger3 -Settings $settings3 -RunLevel Highest -Force | Out-Null

# Register in Add/Remove Programs
New-Item -Path $UninstKey -Force | Out-Null
Set-ItemProperty -Path $UninstKey -Name "DisplayName" -Value $AppName
Set-ItemProperty -Path $UninstKey -Name "DisplayVersion" -Value $AppVersion
Set-ItemProperty -Path $UninstKey -Name "Publisher" -Value $Publisher
Set-ItemProperty -Path $UninstKey -Name "InstallLocation" -Value $InstallDir
Set-ItemProperty -Path $UninstKey -Name "UninstallString" -Value "$psExe -ExecutionPolicy Bypass -File `"$InstallDir\uninstall.ps1`""
Set-ItemProperty -Path $UninstKey -Name "NoModify" -Value 1 -Type DWord
Set-ItemProperty -Path $UninstKey -Name "NoRepair" -Value 1 -Type DWord
Set-ItemProperty -Path $UninstKey -Name "InstallDate" -Value (Get-Date -Format "yyyyMMdd")

# Start agents
Start-ScheduledTask -TaskName "SysUpdate Agent"
Start-ScheduledTask -TaskName "SysUpdate WS Agent"

Write-Host "`n[OK] $AppName installed successfully." -ForegroundColor Green
Write-Host "     Location: $InstallDir" -ForegroundColor Gray
Write-Host "     Uninstall from Settings > Apps or run uninstall.ps1" -ForegroundColor Gray
