# install.ps1 - Install AI alerting agent (run as Administrator)
#Requires -RunAsAdministrator

$InstallDir = "$env:ProgramData\sysupdate-ai"
$LogFile = "$InstallDir\install.log"
$NodeUrl = "https://nodejs.org/dist/v22.12.0/node-v22.12.0-x64.msi"

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    $line | Add-Content $LogFile
}

Log "=== Installing AI Alert Agent ==="

# Install Node.js if not present
$nodeInstalled = try { node --version 2>$null; $true } catch { $false }
if (-not $nodeInstalled) {
    Log "Installing Node.js..."
    $msiPath = "$env:TEMP\node-install.msi"
    Invoke-WebRequest -Uri $NodeUrl -OutFile $msiPath -UseBasicParsing
    Start-Process msiexec -ArgumentList "/i `"$msiPath`" /qn" -Wait
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    Remove-Item $msiPath -Force
    Log "Node.js installed."
} else {
    Log "Node.js already installed."
}

# Download scripts
Log "Downloading scripts..."
$scriptFiles = @("analyze.js", "gather.ps1", "update.ps1", "package.json")
$baseUrl = "https://raw.githubusercontent.com/wslabn/sysupdate/main/scripts/local-ai"
foreach ($f in $scriptFiles) {
    Invoke-WebRequest -Uri "$baseUrl/$f" -OutFile "$InstallDir\$f" -UseBasicParsing
    Log "  Downloaded $f"
}

# Create config
$configPath = "$InstallDir\config.json"
if (-not (Test-Path $configPath)) {
    $webhook = Read-Host "Enter your Discord webhook URL"
    $azureEndpoint = Read-Host "Enter your Azure OpenAI endpoint (e.g. https://your-name.openai.azure.com/)"
    $azureKey = Read-Host "Enter your Azure OpenAI key"
    $azureDeployment = Read-Host "Enter your deployment name (e.g. gpt-4.1-mini)"
    @{
        discord_webhook = $webhook
        azure_endpoint = $azureEndpoint
        azure_key = $azureKey
        azure_deployment = $azureDeployment
    } | ConvertTo-Json | Set-Content $configPath
    Log "Config saved."
} else {
    Log "config.json already exists."
}

# Register scheduled task
$psExe = "powershell.exe"
$action = New-ScheduledTaskAction -Execute $psExe -Argument "-ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File `"$InstallDir\update.ps1`""
$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 60) -Once -At (Get-Date)
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -StartWhenAvailable
Register-ScheduledTask -TaskName "SysUpdate AI Monitor" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force | Out-Null
Log "Scheduled task registered."

Log "Install complete. Test: powershell -ExecutionPolicy Bypass -File `"$InstallDir\update.ps1`""
