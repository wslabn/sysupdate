# update-drivers.ps1 (run as Administrator)

$ServerUrl = "http://192.168.200.146:3000"  # Change to your server URL

# Load machine ID
$IdFile = "$env:ProgramData\sysupdate\machine-id"
$MachineId = if (Test-Path $IdFile) { Get-Content $IdFile } else { $env:COMPUTERNAME }

Write-Host "`n=== SysUpdate Driver Updater ===" -ForegroundColor Cyan

if (-not (Get-Module -ListAvailable -Name PSWindowsUpdate)) {
    Write-Host "Installing PSWindowsUpdate module..." -ForegroundColor Yellow
    Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force | Out-Null
    Install-Module -Name PSWindowsUpdate -Force -Scope CurrentUser
}

Import-Module PSWindowsUpdate

Write-Host "`nChecking for driver updates..." -ForegroundColor Yellow
$drivers = Get-WindowsUpdate -Category Drivers -NotCategory "Preview" -ErrorAction SilentlyContinue

$report = @{ machineId = $MachineId; hostname = $env:COMPUTERNAME }

if (-not $drivers) {
    Write-Host "System is up to date. No driver updates available." -ForegroundColor Green
    $report.driverUpdate = @{ timestamp = (Get-Date -Format "yyyy-MM-dd HH:mm"); status = "current"; installed = @() }
} else {
    Write-Host "`nInstalling driver updates..." -ForegroundColor Yellow
    $results = Install-WindowsUpdate -Category Drivers -NotCategory "Preview" -AcceptAll -IgnoreReboot -ErrorAction SilentlyContinue

    $succeeded = @($results | Where-Object { $_.Result -eq 'Succeeded' })

    if ($succeeded.Count -gt 0) {
        Write-Host "`nInstalled:" -ForegroundColor Green
        $succeeded | ForEach-Object { Write-Host "  [OK] $($_.Title)" -ForegroundColor Green }
    } else {
        Write-Host "All drivers are already current." -ForegroundColor Green
    }

    $report.driverUpdate = @{
        timestamp = (Get-Date -Format "yyyy-MM-dd HH:mm")
        status    = if ($succeeded.Count -gt 0) { "updated" } else { "current" }
        installed = @($succeeded | ForEach-Object { $_.Title })
    }
}

# Report back to server
try {
    Invoke-RestMethod -Uri "$ServerUrl/api/checkin" -Method Post `
        -ContentType "application/json" -Body ($report | ConvertTo-Json -Depth 5)
    Write-Host "Results reported to server." -ForegroundColor Cyan
} catch {
    Write-Host "Could not reach server: $_" -ForegroundColor Yellow
}

if (Get-WURebootStatus -Silent) {
    $choice = Read-Host "`nReboot required. Reboot now? (y/n)"
    if ($choice -eq 'y') { Restart-Computer -Force }
} else {
    Write-Host "`nDone. No reboot required." -ForegroundColor Green
}
