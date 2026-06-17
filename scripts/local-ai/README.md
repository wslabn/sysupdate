# Local AI Alert Agent

Standalone system health monitoring using Edge's built-in local AI model. Analyzes system telemetry on-device and sends alerts to Discord only when problems are detected.

## How It Works

1. PowerShell gathers system data (events, disk space, services, uptime)
2. Node.js launches headless Edge and feeds data to the local AI (`window.ai`)
3. AI determines if the system is healthy or has issues
4. If issues found → sends a formatted alert to Discord
5. If healthy → does nothing (no spam)

Falls back to rule-based analysis if the local AI model isn't available.

## Requirements

- Windows 10/11 with Microsoft Edge
- Outbound HTTPS (port 443) for Discord webhooks
- Node.js (installed automatically if missing)
- Local AI model enabled in Edge (see setup below)

## Install

Run as Administrator:
```powershell
irm https://raw.githubusercontent.com/wslabn/sysupdate/main/scripts/local-ai/install.ps1 | iex
```

You'll be prompted for your Discord webhook URL during setup.

## Enable Local AI in Edge

1. Open `edge://flags/#optimization-guide-on-device-model`
2. Set to **"Enabled BypassPerfRequirement"**
3. Restart Edge
4. Wait a few minutes for the model to download (~1.7GB)

## Test

Check if the AI model is ready:
```powershell
powershell -ExecutionPolicy Bypass -File "C:\ProgramData\sysupdate-ai\test-ai.ps1"
```

Run a full analysis manually:
```powershell
powershell -ExecutionPolicy Bypass -File "C:\ProgramData\sysupdate-ai\gather.ps1"
```

## Configuration

Edit `C:\ProgramData\sysupdate-ai\config.json`:
```json
{
  "discord_webhook": "https://discord.com/api/webhooks/...",
  "interval_minutes": 60
}
```

## What Gets Monitored

- Disk space (alerts below 10% free)
- System uptime (alerts above 30 days)
- Failed automatic services
- Critical/error events in Windows System log
- Pending reboot status

## Uninstall

```powershell
Unregister-ScheduledTask -TaskName "SysUpdate AI Monitor" -Confirm:$false
Remove-Item -Path "$env:ProgramData\sysupdate-ai" -Recurse -Force
```
