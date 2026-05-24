# agent.ps1
# SysUpdate agent - collects hardware info and event logs, posts to server

$ServerUrl = "http://192.168.200.146:3000"  # Change to your server URL

# Generate a stable machine ID from the motherboard serial
$MachineId = (Get-CimInstance Win32_BaseBoard).SerialNumber
if (-not $MachineId -or $MachineId -match "^\s*$|To be filled") {
    # Fallback to a UUID stored locally
    $IdFile = "$env:ProgramData\sysupdate\machine-id"
    if (Test-Path $IdFile) {
        $MachineId = Get-Content $IdFile
    } else {
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
$audio    = (Get-CimInstance Win32_SoundDevice | Select-Object -First 1).Name

$hardware = @{
    model    = "$($computer.Model) / $($board.Product)"
    cpu      = $cpu
    gpu      = $gpus
    wifi     = $wifi
    ethernet = $ethernet
    audio    = $audio
    ram_gb   = [math]::Round($computer.TotalPhysicalMemory / 1GB, 1)
    os       = (Get-CimInstance Win32_OperatingSystem).Caption
}

# Last 10 critical/error events from System log
$events = Get-WinEvent -FilterHashtable @{
    LogName = 'System'
    Level   = 1, 2  # 1=Critical, 2=Error
} -MaxEvents 10 -ErrorAction SilentlyContinue | ForEach-Object {
    @{
        time    = $_.TimeCreated.ToString("yyyy-MM-dd HH:mm")
        source  = $_.ProviderName
        id      = $_.Id
        message = $_.Message -replace "`r`n", " " | Select-Object -First 1
    }
}

# Build payload
$payload = @{
    machineId = $MachineId
    hostname  = $env:COMPUTERNAME
    hardware  = $hardware
    events    = $events
} | ConvertTo-Json -Depth 5

# Post to server
try {
    Invoke-RestMethod -Uri "$ServerUrl/api/checkin" -Method Post `
        -ContentType "application/json" -Body $payload
    Write-Host "Check-in successful"
} catch {
    Write-Host "Check-in failed: $_"
}
