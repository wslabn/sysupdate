# update-drivers.ps1 (run as Administrator)

Write-Host "`n=== SysUpdate Driver Updater ===" -ForegroundColor Cyan

# Install PSWindowsUpdate module if not present
if (-not (Get-Module -ListAvailable -Name PSWindowsUpdate)) {
    Write-Host "Installing PSWindowsUpdate module..." -ForegroundColor Yellow
    Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force | Out-Null
    Install-Module -Name PSWindowsUpdate -Force -Scope CurrentUser
}

Import-Module PSWindowsUpdate

# Show available driver updates
Write-Host "`nChecking for driver updates..." -ForegroundColor Yellow
$drivers = Get-WindowsUpdate -Category Drivers -NotCategory "Preview" -ErrorAction SilentlyContinue

if (-not $drivers) {
    Write-Host "No driver updates available. System is up to date." -ForegroundColor Green
    exit
}

Write-Host "`nAvailable driver updates:" -ForegroundColor Cyan
$drivers | ForEach-Object { Write-Host "  - $($_.Title)" }

Write-Host "`nDownloading and installing..." -ForegroundColor Yellow
$results = Install-WindowsUpdate -Category Drivers -NotCategory "Preview" -AcceptAll -IgnoreReboot -ErrorAction SilentlyContinue

Write-Host "`nResults:" -ForegroundColor Cyan
$results | ForEach-Object {
    $status = if ($_.Result -eq 'Succeeded') { "✓" } else { "✗" }
    Write-Host "  $status $($_.Title)" -ForegroundColor $(if ($_.Result -eq 'Succeeded') { 'Green' } else { 'Red' })
}

$needsReboot = Get-WURebootStatus -Silent
if ($needsReboot) {
    Write-Host "`nA reboot is required to complete installation." -ForegroundColor Yellow
    $choice = Read-Host "Reboot now? (y/n)"
    if ($choice -eq 'y') { Restart-Computer -Force }
} else {
    Write-Host "`nAll drivers installed successfully. No reboot required." -ForegroundColor Green
}
