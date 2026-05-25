# agent.ps1
$ServerUrl = "http://192.168.200.146:3000"  # Change to your server URL

# Stable machine ID
$MachineId = (Get-CimInstance Win32_BaseBoard).SerialNumber
if (-not $MachineId -or $MachineId -match "^\s*$|To be filled") {
    $IdFile = "$env:ProgramData\sysupdate\machine-id"
    if (Test-Path $IdFile) { $MachineId = Get-Content $IdFile }
    else {
        $MachineId = [System.Guid]::NewGuid().ToString()
        New-Item -ItemType Directory -Force -Path (Split-Path $IdFile) | Out-Null
        $MachineId | Set-Content $IdFile
    }
}

# Hardware info
$board    = Get-CimInstance Win32_BaseBoard
$computer = Get-CimInstance Win32_ComputerSystem
$cpu      = Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name
$gpus     = (Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join ", "
$networks = Get-CimInstance Win32_NetworkAdapter | Where-Object { $_.PhysicalAdapter -eq $true }
$wifi     = ($networks | Where-Object { $_.Name -match "Wi-Fi|Wireless|WiFi" } | Select-Object -First 1).Name
$ethernet = ($networks | Where-Object { $_.Name -match "Ethernet|GbE|LAN" } | Select-Object -First 1).Name

$hardware = @{
    model    = "$($computer.Model) / $($board.Product)"
    cpu      = $cpu
    gpu      = $gpus
    wifi     = $wifi
    ethernet = $ethernet
    ram_gb   = [math]::Round($computer.TotalPhysicalMemory / 1GB, 1)
    os       = (Get-CimInstance Win32_OperatingSystem).Caption
}

# Last 10 critical/error events
$events = Get-WinEvent -FilterHashtable @{ LogName = 'System'; Level = 1,2 } -MaxEvents 10 -ErrorAction SilentlyContinue | ForEach-Object {
    @{ time = $_.TimeCreated.ToString("yyyy-MM-dd HH:mm"); source = $_.ProviderName; id = $_.Id; message = $_.Message -replace "`r`n"," " }
}

# Windows Update status
$wu = New-Object -ComObject Microsoft.Update.Session
$searcher = $wu.CreateUpdateSearcher()
$missing = 0
try {
    $result = $searcher.Search("IsInstalled=0 and Type='Software'")
    $missing = $result.Updates.Count
} catch {}
$lastInstall = (Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 1).InstalledOn
$windowsUpdate = @{
    missing      = $missing
    last_install = if ($lastInstall) { $lastInstall.ToString("yyyy-MM-dd") } else { "Unknown" }
}

# Post to server, get back any pending command
$payload = @{
    machineId     = $MachineId
    hostname      = $env:COMPUTERNAME
    hardware      = $hardware
    events        = $events
    windowsUpdate = $windowsUpdate
} | ConvertTo-Json -Depth 5

try {
    $response = Invoke-RestMethod -Uri "$ServerUrl/api/checkin" -Method Post -ContentType "application/json" -Body $payload
    Write-Host "Check-in successful"

    # Execute pending command if any
    if ($response.command) {
        Write-Host "Executing command: $($response.command)"
        switch ($response.command) {
            "reboot"         { shutdown /r /t 30 /c "SysUpdate: Reboot requested from dashboard" }
            "update-drivers" { Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -File `"$env:ProgramData\sysupdate\update-drivers.ps1`"" -Verb RunAs }
        }
    }
} catch {
    Write-Host "Check-in failed: $_"
}
