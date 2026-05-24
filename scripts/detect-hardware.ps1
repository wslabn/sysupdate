# detect-hardware.ps1

Write-Host "`n=== Beelink Hardware Detection ===" -ForegroundColor Cyan

# Machine model
$board = Get-CimInstance Win32_BaseBoard | Select-Object -ExpandProperty Product
$model = Get-CimInstance Win32_ComputerSystem | Select-Object -ExpandProperty Model
Write-Host "Model:     $model / $board"

# CPU
$cpu = Get-CimInstance Win32_Processor | Select-Object -ExpandProperty Name
Write-Host "CPU:       $cpu"

# GPU
Get-CimInstance Win32_VideoController | ForEach-Object {
    Write-Host "GPU:       $($_.Name)"
}

# Network adapters (WiFi + Ethernet)
Get-CimInstance Win32_NetworkAdapter | Where-Object { $_.PhysicalAdapter -eq $true } | ForEach-Object {
    Write-Host "Network:   $($_.Name)"
}

# Audio
Get-CimInstance Win32_SoundDevice | ForEach-Object {
    Write-Host "Audio:     $($_.Name)"
}

Write-Host ""
