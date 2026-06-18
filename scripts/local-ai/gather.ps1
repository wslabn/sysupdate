# gather.ps1 - Collect system telemetry and run AI analysis
$InstallDir = "$env:ProgramData\sysupdate-ai"
$LogFile = "$InstallDir\system_data.txt"
$ReportDir = "$InstallDir\reports"

# Create reports directory
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null

# Gather system info
$hostname = $env:COMPUTERNAME
$uptime = (Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
$pendingReboot = Test-Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending"

# Disk space
$disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
    "$($_.DeviceID) $([math]::Round($_.FreeSpace/1GB,1))GB free / $([math]::Round($_.Size/1GB,1))GB total ($([math]::Round(($_.FreeSpace/$_.Size)*100,1))% free)"
}

# Failed services
$failedServices = Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.StartType -eq 'Automatic' -and $_.Status -ne 'Running' } | Select-Object -First 10 | ForEach-Object {
    "$($_.Name) ($($_.DisplayName)) - $($_.Status)"
}

# Critical/Error events (last 10 System + last 10 Application)
$sysEvents = Get-WinEvent -FilterHashtable @{ LogName = 'System'; Level = 1,2 } -MaxEvents 10 -ErrorAction SilentlyContinue | ForEach-Object {
    $msg = ($_.Message -replace '\r\n',' ' -replace '\s+',' ')
    if ($msg.Length -gt 150) { $msg = $msg.Substring(0,150) }
    "[SYS][$($_.TimeCreated.ToString('yyyy-MM-dd HH:mm'))] [$($_.ProviderName)] ID:$($_.Id) $msg"
}
$appEvents = Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Level = 1,2 } -MaxEvents 10 -ErrorAction SilentlyContinue | ForEach-Object {
    $msg = ($_.Message -replace '\r\n',' ' -replace '\s+',' ')
    if ($msg.Length -gt 150) { $msg = $msg.Substring(0,150) }
    "[APP][$($_.TimeCreated.ToString('yyyy-MM-dd HH:mm'))] [$($_.ProviderName)] ID:$($_.Id) $msg"
}
$events = @($sysEvents) + @($appEvents)

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

# Save timestamped report
$timestamp = Get-Date -Format 'yyyy-MM-dd_HH-mm'
$report | Set-Content "$ReportDir\$timestamp.txt" -Encoding UTF8

# Cleanup reports older than 14 days
Get-ChildItem $ReportDir -Filter "*.txt" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item -Force

# Run the AI analysis
Push-Location $InstallDir
node analyze.js 2>&1 | ForEach-Object { Write-Host $_ }
Pop-Location
