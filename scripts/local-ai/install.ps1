# install.ps1 - Install local AI alerting agent (run as Administrator)
#Requires -RunAsAdministrator

$InstallDir = "$env:ProgramData\sysupdate-ai"
$LogFile = "$InstallDir\install.log"
$NodeUrl = "https://nodejs.org/dist/v22.12.0/node-v22.12.0-x64.msi"
$OllamaUrl = "https://ollama.com/download/OllamaSetup.exe"

# Create install directory
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    $line | Add-Content $LogFile
}

# Install Node.js if not present
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Log "Installing Node.js..."
    $msiPath = "$env:TEMP\node-install.msi"
    Invoke-WebRequest -Uri $NodeUrl -OutFile $msiPath -UseBasicParsing
    Start-Process msiexec -ArgumentList "/i `"$msiPath`" /qn" -Wait
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    Remove-Item $msiPath -Force
    Log "Node.js installed."
} else {
    Log "Node.js already installed: $(node --version)"
}

# Install Ollama if not present
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Log "Installing Ollama..."
    $ollamaPath = "$env:TEMP\OllamaSetup.exe"
    Invoke-WebRequest -Uri $OllamaUrl -OutFile $ollamaPath -UseBasicParsing
    Log "Ollama downloaded, running installer..."
    Start-Process $ollamaPath -Wait
    Start-Sleep -Seconds 5
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    Remove-Item $ollamaPath -Force -ErrorAction SilentlyContinue
    Stop-Process -Name "Ollama" -ErrorAction SilentlyContinue
    Log "Ollama installed."
} else {
    Log "Ollama already installed: $(ollama --version)"
}

# Pull the AI model
Log "Pulling AI model (phi3:mini)..."
Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden
Start-Sleep -Seconds 3
ollama pull phi3:mini 2>&1 | ForEach-Object { Log $_ }
Log "Model ready."

# Copy scripts
Log "Downloading scripts..."
$scriptFiles = @("analyze.js", "gather.ps1", "update.ps1", "package.json")
$baseUrl = "https://raw.githubusercontent.com/wslabn/sysupdate/main/scripts/local-ai"
foreach ($f in $scriptFiles) {
    Invoke-WebRequest -Uri "$baseUrl/$f" -OutFile "$InstallDir\$f" -UseBasicParsing
    Log "  Downloaded $f"
}

# Create config file if not exists
$configPath = "$InstallDir\config.json"
if (-not (Test-Path $configPath)) {
    $webhook = Read-Host "Enter your Discord webhook URL"
    @{
        discord_webhook = $webhook
        model = "phi3:mini"
        interval_minutes = 60
    } | ConvertTo-Json | Set-Content $configPath
    Log "Config saved."
} else {
    Log "config.json already exists, skipping."
}

# Register scheduled task
$psExe = "powershell.exe"
$action = New-ScheduledTaskAction -Execute $psExe -Argument "-ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File `"$InstallDir\update.ps1`""
$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 60) -Once -At (Get-Date)
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -StartWhenAvailable
Register-ScheduledTask -TaskName "SysUpdate AI Monitor" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force | Out-Null
Log "Scheduled task registered."

Log "Install complete. Test with: powershell -ExecutionPolicy Bypass -File `"$InstallDir\update.ps1`""
