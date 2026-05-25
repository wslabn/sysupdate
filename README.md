# sysupdate

Driver detection, update, and remote management tool for Beelink mini PCs.

## Architecture

- **Server** — Node.js Express app with WebSocket relay, REST API, and web dashboard
- **Client** — Electron tray app (system tray, WebSocket connection, remote PowerShell shell, maintenance tools)
- **Scripts** — PowerShell utilities for driver updates and legacy cleanup

## Server Setup

```bash
cd server
npm install
npm start
```

Runs on port 3000 by default. Provides:
- REST API for machine check-ins and management
- WebSocket relay for remote terminal sessions and tools
- Web dashboard at `http://your-server:3000`

## Client Install

Download the latest `SysUpdate-Setup.exe` from [Releases](https://github.com/wslabn/sysupdate/releases) and run on the target Windows machine.

The installer:
- Installs to `C:\Program Files\SysUpdate\`
- Runs as Administrator (elevated for DISM, driver installs, etc.)
- Sits in the system tray with version display and auto-reconnect
- Checks in with hardware specs, disk space, diagnostics, and events on connect and hourly
- Provides a remote PowerShell shell via WebSocket
- Supports remote maintenance tools and screenshot capture
- Auto-starts on login via scheduled task (no UAC prompt)

### Building the client locally

```bash
cd client
npm install
npm start          # dev mode
npm run build      # produces installer in dist/
```

## Legacy PowerShell Agent

If migrating from the old PowerShell-only agent, run the cleanup script as Administrator:
```powershell
irm https://raw.githubusercontent.com/wslabn/sysupdate/main/scripts/cleanup-legacy.ps1 | iex
```

## CI/CD

GitHub Actions builds the Electron client automatically:
- **Manual** — Actions > "Build Client" > Run workflow
- **Tagged release** — push a `v*` tag to build and publish to GitHub Releases

```bash
git tag v1.2.0
git push origin v1.2.0
```

## Features

- [x] Hardware detection & inventory (model, CPU, GPU, RAM, OS version/build)
- [x] Disk space monitoring with color-coded alerts
- [x] System diagnostics (uptime, last boot, pending reboot, network adapters)
- [x] Automatic driver updates via Windows Update
- [x] Web dashboard with customer grouping and tabbed detail panel
- [x] Customer management (contacts, email, phone, address, notes)
- [x] Machine notes and activity log
- [x] Remote commands (reboot, update-drivers)
- [x] Remote PowerShell terminal via WebSocket (elevated)
- [x] Remote screenshot capture
- [x] Helpdesk tools (disk cleanup, clear temp, clear browser cache, flush DNS, SFC, DISM, restart spooler)
- [x] Push client updates from dashboard
- [x] Client version tracking
- [x] Electron system tray client with auto-reconnect and version display
- [x] Proper install/uninstall via Windows installer
- [x] Auto-start on login (elevated, no UAC prompt)
- [x] GitHub Actions CI/CD for client builds
