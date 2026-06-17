# gather.ps1 — Collect system telemetry and run local AI analysis
$InstallDir = "$env:ProgramData\sysupdate-ai"
$LogFile = "$InstallDir\system_data.txt"

# Gather system info
$hostname = $env:COMPUTERNAME
$uptime = (Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
$pendingReboot = Test-Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending"

# Disk space
$disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
    "$($_.DeviceID) $([math]::Round($_.FreeSpace/1GB,1))GB free / $([math]::Round($_.Size/1GB,1))GB total ($([math]::Round(($_.FreeSpace/$_.Size)*100,1))% free)"
}

# Failed services
$failedServices = Get-Service | Where-Object { $_.StartType -eq 'Automatic' -and $_.Status -ne 'Running' } | Select-Object -First 10 | ForEach-Object {
    "$($_.Name) ($($_.DisplayName)) - $($_.Status)"
}

# Critical/Error events (last 20)
$events = Get-WinEvent -FilterHashtable @{ LogName = 'System'; Level = 1,2 } -MaxEvents 20 -ErrorAction SilentlyContinue | ForEach-Object {
    "[$($_.TimeCreated.ToString('yyyy-MM-dd HH:mm'))] [$($_.ProviderName)] ID:$($_.Id) $($_.Message -replace '\r\n',' ' -replace '\s+',' ')"
}

# Build report
$report = @"
=== SYSTEM TELEMETRY: $hostname ===
Time: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
Uptime: $([math]::Round($uptime.TotalHours,1)) hours
Pending Reboot: $pendingReboot

=== DISK SPACE ===
$($disks -join "`n")

=== FAILED AUTOMATIC SERVICES ===
$(if ($failedServices) { $failedServices -join "`n" } else { "None" })

=== RECENT CRITICAL/ERROR EVENTS ===
$(if ($events) { $events -join "`n" } else { "No critical events" })
"@

# Write to file for Node to read
$report | Set-Content $LogFile -Encoding UTF8

# Run the AI analysis
Push-Location $InstallDir
node analyze.js 2>&1 | ForEach-Object { Write-Host $_ }
Pop-Location
