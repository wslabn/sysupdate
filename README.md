# sysupdate

Remote management, monitoring, and AI-powered diagnostics tool for Windows PCs.

## Architecture

- **Server** — Node.js Express app with WebSocket relay, REST API, PostgreSQL, AI diagnostics, and web dashboard
- **Client** — Electron tray app (system tray, WebSocket connection, remote shell, remote desktop, maintenance tools)
- **AI Agent** — Standalone monitoring script (Azure OpenAI + Discord alerts)

## Server Setup

```bash
cd server
cp .env.example .env   # fill in your values
npm install
npm start
```

Requires PostgreSQL. See [Azure Deployment Guide](docs/AZURE_DEPLOYMENT.md) for production setup.

## Client Install

Download the latest `SysUpdate-Setup.exe` from [Releases](https://github.com/wslabn/sysupdate/releases) and run on the target Windows machine.

The installer:
- Installs to `C:\Program Files\SysUpdate\`
- Runs as Administrator (elevated for DISM, driver installs, etc.)
- Sits in the system tray with version display and auto-reconnect
- Checks in with hardware specs, disk space, diagnostics, and events on connect and hourly
- Provides remote PowerShell shell and remote desktop via WebSocket
- Supports remote maintenance tools and screenshot capture
- Auto-starts on boot via scheduled task (no UAC prompt)

### Building the client locally

```bash
cd client
npm install
npm start          # dev mode
npm run build      # produces installer in dist/
```

## CI/CD

GitHub Actions builds the Electron client automatically:
- **Manual** — Actions > "Build Client" > Run workflow
- **Tagged release** — push a `v*` tag to build and publish to GitHub Releases

```bash
git tag v1.4.0
git push origin v1.4.0
```

## Features

### Remote Management
- [x] Remote PowerShell terminal via WebSocket (elevated)
- [x] Remote desktop (screen streaming with mouse/keyboard control)
- [x] Remote screenshot capture
- [x] Remote commands (reboot, update-drivers)
- [x] Push client updates from dashboard
- [x] Switch client between dev/prod environments remotely

### Monitoring & Diagnostics
- [x] Hardware detection & inventory (model, CPU, GPU, RAM, OS version/build)
- [x] Disk space monitoring with color-coded alerts
- [x] System diagnostics (uptime, last boot, pending reboot, network adapters)
- [x] System and Application event log collection
- [x] BSOD crash dump detection with stop codes
- [x] AI-powered diagnostics on check-in (only when changes detected)
- [x] Click any event for AI explanation and fix steps
- [x] Discord notifications for critical alerts (no spam)

### Auto-Remediation
- [x] AI categorizes issues into auto-fix (safe) and manual tiers
- [x] Safe fixes execute immediately (restart services, clear temp, cleanup)
- [x] Recurring issues trigger deep AI analysis for root cause
- [x] Scheduled reboots at 2:00 AM when fixes require restart
- [x] Fix history tracking to detect recurring problems

### Helpdesk Tools
- [x] Full disk cleanup (temp, Windows Update cache, recycle bin)
- [x] Clear browser cache (Chrome and Edge)
- [x] Flush DNS
- [x] SFC scan / DISM repair
- [x] Restart Print Spooler

### Dashboard
- [x] Sidebar navigation with customer list
- [x] Home dashboard with stats and active alerts
- [x] Customer management (contacts, email, phone, address, notes)
- [x] Machine notes and activity log
- [x] Tabbed machine detail (Overview, Storage, Network, Updates, Tools, Events, Notes, Activity, Diagnostics, Alerts)
- [x] Web-based remote desktop viewer with quality/FPS controls

### Infrastructure
- [x] PostgreSQL database (production-ready)
- [x] HTTPS with self-signed cert (or Azure managed cert)
- [x] Agent authentication (shared secret)
- [x] JWT-based dashboard auth
- [x] Environment variables for all secrets
- [x] GitHub Actions CI/CD for client builds
- [x] Auto-start on boot (elevated, no UAC prompt)
- [x] Client auto-update via dashboard push

## Standalone AI Agent

For machines without the full client, a standalone monitoring script sends alerts to Discord:
- See [scripts/local-ai/README.md](scripts/local-ai/README.md)
