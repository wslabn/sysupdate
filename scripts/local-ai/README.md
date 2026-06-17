# Local AI Alert Agent

Standalone system health monitoring using a local AI model (Ollama). Analyzes system telemetry on-device and sends alerts to Discord only when problems are detected.

## How It Works

1. PowerShell gathers system data (events, disk space, services, uptime)
2. Sends data to Ollama (local AI running on the machine)
3. AI determines if the system is healthy or has issues
4. If issues found → sends a formatted alert to Discord
5. If healthy → does nothing (no spam)

Falls back to rule-based analysis if Ollama isn't running.

## Requirements

- Windows 10/11
- ~4GB RAM available for the AI model
- ~3GB disk space for Ollama + model
- Outbound HTTPS (port 443) for Discord webhooks

## Install

Run as Administrator:
```powershell
irm https://raw.githubusercontent.com/wslabn/sysupdate/main/scripts/local-ai/install.ps1 | iex
```

This installs:
- Node.js (if not present)
- Ollama (local AI runtime)
- phi3:mini model (~2.3GB download)
- Scheduled task (runs hourly)

## Test

```powershell
powershell -ExecutionPolicy Bypass -File "C:\ProgramData\sysupdate-ai\update.ps1"
```

## Configuration

Edit `C:\ProgramData\sysupdate-ai\config.json`:
```json
{
  "discord_webhook": "https://discord.com/api/webhooks/...",
  "model": "phi3:mini",
  "interval_minutes": 60
}
```

Available models (smaller = faster, larger = smarter):
- `phi3:mini` — 2.3GB, fast, good for diagnostics (default)
- `llama3.2:1b` — 1.3GB, fastest, basic analysis
- `llama3.2:3b` — 2GB, good balance
- `mistral` — 4GB, more detailed analysis

Change model: `ollama pull <model>` then update config.json.

## What Gets Monitored

- Disk space (alerts below 10% free)
- System uptime (alerts above 30 days)
- Failed automatic services (filters out known safe ones)
- Critical/error events in Windows System log
- Pending reboot status
- AI correlates issues (e.g. pending reboot + failed services = one alert)

## Uninstall

```powershell
Unregister-ScheduledTask -TaskName "SysUpdate AI Monitor" -Confirm:$false
Remove-Item -Path "$env:ProgramData\sysupdate-ai" -Recurse -Force
winget uninstall Ollama.Ollama
```
