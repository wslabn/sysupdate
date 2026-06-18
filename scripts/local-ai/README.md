# AI Alert Agent

Automated system health monitoring with AI-powered diagnostics. Collects telemetry, analyzes with Azure OpenAI (gpt-4.1-mini), auto-fixes safe issues, and sends alerts to Discord.

## How It Works

1. PowerShell gathers system data (events, disk space, services, uptime, crash dumps)
2. Sends data to Azure OpenAI for intelligent analysis
3. AI categorizes issues into **auto-fix** (safe) or **manual** (needs human)
4. Auto-fixes execute immediately (restart services, clear temp, cleanup shadow copies)
5. Recurring issues trigger **deep analysis** — AI investigates root cause and applies advanced fixes
6. Manual issues alert Discord with suggested PowerShell commands
7. If a fix requires reboot, it's scheduled for 2:00 AM automatically
8. Falls back to rule-based analysis if AI is unavailable

## Requirements

- Windows 10/11
- Node.js (installed automatically)
- Azure OpenAI resource with gpt-4.1-mini deployed
- Outbound HTTPS (port 443) for Azure and Discord

## Install

Run as Administrator:
```powershell
irm https://raw.githubusercontent.com/wslabn/sysupdate/main/scripts/local-ai/install.ps1 | iex
```

You'll be prompted for:
- Discord webhook URL
- Azure OpenAI endpoint (e.g. `https://your-resource.openai.azure.com/`)
- Azure OpenAI API key
- Deployment name (e.g. `gpt-4.1-mini`)

## Test

```powershell
powershell -ExecutionPolicy Bypass -File "C:\ProgramData\sysupdate-ai\update.ps1"
```

## Configuration

Edit `C:\ProgramData\sysupdate-ai\config.json`:
```json
{
  "discord_webhook": "https://discord.com/api/webhooks/...",
  "azure_endpoint": "https://your-resource.openai.azure.com/",
  "azure_key": "your-api-key",
  "azure_deployment": "gpt-4.1-mini"
}
```

## What Gets Monitored

- **Disk space** — alerts below 10% free, auto-cleans temp/recycle bin
- **Services** — detects stopped automatic services, restarts safe ones
- **Windows Update** — detects failed updates, suggests fixes
- **System events** — critical/error events from System and Application logs
- **Crash dumps** — detects BSODs, extracts stop codes, reports faulting info
- **Uptime** — alerts if uptime exceeds 30 days
- **Pending reboot** — correlates with other issues
- **TPM/hardware** — flags hardware issues for manual attention

## Auto-Fix Tiers

| Tier | Action | Examples |
|------|--------|----------|
| **auto-fix** | Runs immediately | Restart services, clear temp, delete shadow copies, flush DNS |
| **manual** | Alerts Discord with commands | Windows Update reset, BIOS issues, disk space decisions |
| **deep fix** | AI investigates recurring issues | Rebuilds indexes, resets components, fixes permissions |

## Recurring Issue Detection

If the same auto-fix runs 2+ times without resolving, the AI performs a deeper investigation:
- Asks "WHY does this keep failing?"
- Generates advanced fix commands targeting the root cause
- Executes them and reports results

## Scheduled Reboots

When a fix requires a reboot:
- Reboot is scheduled for **2:00 AM** (off-hours)
- Discord is notified: "🔄 Reboot scheduled for 2:00 AM"
- Users see a Windows notification about the pending restart

## Auto-Updates

Scripts update automatically from GitHub on every run. The scheduled task calls `update.ps1` which:
1. Downloads latest `analyze.js` and `gather.ps1`
2. Runs the analysis with fresh code

## Files

| File | Purpose |
|------|---------|
| `update.ps1` | Entry point — updates scripts, runs gather |
| `gather.ps1` | Collects system telemetry |
| `analyze.js` | AI analysis, auto-fix, Discord alerts |
| `config.json` | API keys and webhook URL |
| `fix_history.json` | Tracks recurring fixes |
| `reports/` | Timestamped telemetry reports (14-day retention) |

## Uninstall

```powershell
Unregister-ScheduledTask -TaskName "SysUpdate AI Monitor" -Confirm:$false
Remove-Item -Path "$env:ProgramData\sysupdate-ai" -Recurse -Force
```
