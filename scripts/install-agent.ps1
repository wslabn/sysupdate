# install-agent.ps1 (run as Administrator)

$BaseUrl  = "https://raw.githubusercontent.com/wslabn/sysupdate/main/scripts"
$DataDir  = "$env:ProgramData\sysupdate"

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

# Download scripts
Invoke-WebRequest -Uri "$BaseUrl/agent.ps1"          -OutFile "$DataDir\agent.ps1"
Invoke-WebRequest -Uri "$BaseUrl/agent-ws.ps1"       -OutFile "$DataDir\agent-ws.ps1"
Invoke-WebRequest -Uri "$BaseUrl/update-drivers.ps1" -OutFile "$DataDir\update-drivers.ps1"

$psExe = "powershell.exe"
$flags = "-ExecutionPolicy Bypass -NonInteractive -File"

# Hourly agent check-in
$action   = New-ScheduledTaskAction -Execute $psExe -Argument "$flags `"$DataDir\agent.ps1`""
$trigger  = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Hours 1) -Once -At (Get-Date)
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -StartWhenAvailable
Register-ScheduledTask -TaskName "SysUpdate Agent" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force

# Daily driver update at 2am
$action2   = New-ScheduledTaskAction -Execute $psExe -Argument "$flags `"$DataDir\update-drivers.ps1`""
$trigger2  = New-ScheduledTaskTrigger -Daily -At "2:00AM"
$settings2 = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -StartWhenAvailable
Register-ScheduledTask -TaskName "SysUpdate Drivers" -Action $action2 -Trigger $trigger2 -Settings $settings2 -RunLevel Highest -Force

# Persistent WebSocket agent (runs at startup, restarts on failure)
$action3   = New-ScheduledTaskAction -Execute $psExe -Argument "$flags `"$DataDir\agent-ws.ps1`""
$trigger3  = New-ScheduledTaskTrigger -AtStartup
$settings3 = New-ScheduledTaskSettingsSet -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 999 -StartWhenAvailable
Register-ScheduledTask -TaskName "SysUpdate WS Agent" -Action $action3 -Trigger $trigger3 -Settings $settings3 -RunLevel Highest -Force

# Run both agents immediately
Start-ScheduledTask -TaskName "SysUpdate Agent"
Start-ScheduledTask -TaskName "SysUpdate WS Agent"

Write-Host "Agent (hourly), WS agent (persistent), and driver updater (daily 2am) installed." -ForegroundColor Green
