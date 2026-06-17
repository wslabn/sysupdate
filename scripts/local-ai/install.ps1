# install.ps1 - Install local AI alerting agent (run as Administrator)
#Requires -RunAsAdministrator

$InstallDir = "$env:ProgramData\sysupdate-ai"
$NodeUrl = "https://nodejs.org/dist/v22.12.0/node-v22.12.0-x64.msi"
$OllamaUrl = "https://ollama.com/download/OllamaSetup.exe"

Write-Host "`n=== Installing Local AI Alert Agent ===" -ForegroundColor Cyan

# Create install directory
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# Install Node.js if not present
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "  Installing Node.js..." -ForegroundColor Yellow
    $msiPath = "$env:TEMP\node-install.msi"
    Invoke-WebRequest -Uri $NodeUrl -OutFile $msiPath -UseBasicParsing
    Start-Process msiexec -ArgumentList "/i `"$msiPath`" /qn" -Wait
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    Remove-Item $msiPath -Force
    Write-Host "  Node.js installed." -ForegroundColor Green
} else {
    Write-Host "  Node.js already installed: $(node --version)" -ForegroundColor Green
}

# Install Ollama if not present
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Write-Host "  Installing Ollama..." -ForegroundColor Yellow
    $ollamaPath = "$env:TEMP\OllamaSetup.exe"
    Invoke-WebRequest -Uri $OllamaUrl -OutFile $ollamaPath -UseBasicParsing
    Start-Process $ollamaPath -Wait
    Start-Sleep -Seconds 5
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    Remove-Item $ollamaPath -Force -ErrorAction SilentlyContinue
    # Kill the Ollama app window that opens after install
    Stop-Process -Name "Ollama" -ErrorAction SilentlyContinue
    Write-Host "  Ollama installed." -ForegroundColor Green
} else {
    Write-Host "  Ollama already installed." -ForegroundColor Green
}

# Pull the AI model
Write-Host "  Downloading AI model (phi3:mini ~2.3GB)..." -ForegroundColor Yellow
Start-Process "ollama" -ArgumentList "serve" -WindowStyle Hidden
Start-Sleep -Seconds 3
ollama pull phi3:mini
Write-Host "  Model ready." -ForegroundColor Green

# Copy scripts
$scriptFiles = @("analyze.js", "gather.ps1", "update.ps1", "package.json")
$baseUrl = "https://raw.githubusercontent.com/wslabn/sysupdate/main/scripts/local-ai"
foreach ($f in $scriptFiles) {
    Write-Host "  Downloading $f..."
    Invoke-WebRequest -Uri "$baseUrl/$f" -OutFile "$InstallDir\$f" -UseBasicParsing
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
    Write-Host "  Config saved." -ForegroundColor Green
} else {
    Write-Host "  config.json already exists, skipping." -ForegroundColor Green
}

# Register scheduled task
$psExe = "powershell.exe"
$action = New-ScheduledTaskAction -Execute $psExe -Argument "-ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File `"$InstallDir\update.ps1`""
$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 60) -Once -At (Get-Date)
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -StartWhenAvailable
Register-ScheduledTask -TaskName "SysUpdate AI Monitor" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force | Out-Null

Write-Host "`n[OK] Local AI Alert Agent installed." -ForegroundColor Green
Write-Host "     Location: $InstallDir" -ForegroundColor Gray
Write-Host "     Model: phi3:mini (runs locally via Ollama)" -ForegroundColor Gray
Write-Host "     Test with: powershell -ExecutionPolicy Bypass -File `"$InstallDir\update.ps1`"" -ForegroundColor Gray
