# install.ps1 — Install local AI alerting agent (run as Administrator)
#Requires -RunAsAdministrator

$InstallDir = "$env:ProgramData\sysupdate-ai"
$NodeUrl = "https://nodejs.org/dist/v22.12.0/node-v22.12.0-x64.msi"

Write-Host "`n=== Installing Local AI Alert Agent ===" -ForegroundColor Cyan

# Create install directory
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# Install Node.js if not present
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "  Installing Node.js..." -ForegroundColor Yellow
    $msiPath = "$env:TEMP\node-install.msi"
    Invoke-WebRequest -Uri $NodeUrl -OutFile $msiPath -UseBasicParsing
    Start-Process msiexec -ArgumentList "/i `"$msiPath`" /qn" -Wait
    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    Remove-Item $msiPath -Force
    Write-Host "  Node.js installed." -ForegroundColor Green
} else {
    Write-Host "  Node.js already installed: $(node --version)" -ForegroundColor Green
}

# Copy scripts
$scriptFiles = @("analyze.js", "gather.ps1", "update.ps1", "package.json")
$baseUrl = "https://raw.githubusercontent.com/wslabn/sysupdate/main/scripts/local-ai"
foreach ($f in $scriptFiles) {
    Write-Host "  Downloading $f..."
    Invoke-WebRequest -Uri "$baseUrl/$f" -OutFile "$InstallDir\$f" -UseBasicParsing
}

# Install npm dependencies
Write-Host "  Installing dependencies..." -ForegroundColor Yellow
Push-Location $InstallDir
npm install --production 2>&1 | Out-Null
Pop-Location
Write-Host "  Dependencies installed." -ForegroundColor Green

# Create config file if not exists
$configPath = "$InstallDir\config.json"
if (-not (Test-Path $configPath)) {
    $webhook = Read-Host "Enter your Discord webhook URL"
    @{
        discord_webhook = $webhook
        interval_minutes = 60
    } | ConvertTo-Json | Set-Content $configPath
    Write-Host "  Config saved." -ForegroundColor Green
} else {
    Write-Host "  config.json already exists, skipping." -ForegroundColor Green
}

# Register scheduled task
$psExe = "powershell.exe"
$action = New-ScheduledTaskAction -Execute $psExe -Argument "-ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File `"$InstallDir\gather.ps1`""
$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 60) -Once -At (Get-Date)
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -StartWhenAvailable
Register-ScheduledTask -TaskName "SysUpdate AI Monitor" -Action $action -Trigger $trigger -Settings $settings -RunLevel Highest -Force | Out-Null

Write-Host "`n[OK] Local AI Alert Agent installed." -ForegroundColor Green
Write-Host "     Location: $InstallDir" -ForegroundColor Gray
Write-Host "     Edit $configPath to set your Discord webhook URL." -ForegroundColor Gray
Write-Host "     Run gather.ps1 manually to test." -ForegroundColor Gray
