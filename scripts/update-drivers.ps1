# update-drivers.ps1 (run as Administrator)

Write-Host "`n=== SysUpdate Driver Updater ===" -ForegroundColor Cyan

if (-not (Get-Module -ListAvailable -Name PSWindowsUpdate)) {
    Write-Host "Installing PSWindowsUpdate module..." -ForegroundColor Yellow
    Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force | Out-Null
    Install-Module -Name PSWindowsUpdate -Force -Scope CurrentUser
}

Import-Module PSWindowsUpdate

Write-Host "`nChecking for driver updates..." -ForegroundColor Yellow
$drivers = Get-WindowsUpdate -Category Drivers -NotCategory "Preview" -ErrorAction SilentlyContinue

if (-not $drivers) {
    Write-Host "System is up to date. No driver updates available." -ForegroundColor Green
    exit
}

Write-Host "`nAvailable driver updates:" -ForegroundColor Cyan
$drivers | ForEach-Object { Write-Host "  - $($_.Title)" }

Write-Host "`nDownloading and installing..." -ForegroundColor Yellow
$results = Install-WindowsUpdate -Category Drivers -NotCategory "Preview" -AcceptAll -IgnoreReboot -ErrorAction SilentlyContinue

$succeeded = @($results | Where-Object { $_.Result -eq 'Succeeded' })
$failed    = @($results | Where-Object { $_.Result -ne 'Succeeded' })

if ($succeeded.Count -gt 0) {
    Write-Host "`nInstalled:" -ForegroundColor Green
    $succeeded | ForEach-Object { Write-Host "  [OK] $($_.Title)" -ForegroundColor Green }
}

if ($succeeded.Count -eq 0 -and $failed.Count -gt 0) {
    Write-Host "`nAll drivers are already current." -ForegroundColor Green
}

if (Get-WURebootStatus -Silent) {
    $choice = Read-Host "`nReboot required to complete installation. Reboot now? (y/n)"
    if ($choice -eq 'y') { Restart-Computer -Force }
} else {
    Write-Host "`nDone. No reboot required." -ForegroundColor Green
}
