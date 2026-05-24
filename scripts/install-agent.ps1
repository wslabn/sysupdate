# install-agent.ps1 (run as Administrator)

$AgentUrl = "https://raw.githubusercontent.com/wslabn/sysupdate/main/scripts/agent.ps1"
$AgentPath = "$env:ProgramData\sysupdate\agent.ps1"

# Download agent
New-Item -ItemType Directory -Force -Path "$env:ProgramData\sysupdate" | Out-Null
Invoke-WebRequest -Uri $AgentUrl -OutFile $AgentPath

# Register scheduled task - runs every hour
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-ExecutionPolicy Bypass -NonInteractive -File `"$AgentPath`""
$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Hours 1) -Once -At (Get-Date)
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -StartWhenAvailable

Register-ScheduledTask -TaskName "SysUpdate Agent" -Action $action `
    -Trigger $trigger -Settings $settings -RunLevel Highest -Force

# Run immediately
Start-ScheduledTask -TaskName "SysUpdate Agent"
Write-Host "Agent installed and running"
