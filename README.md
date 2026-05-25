# sysupdate

Driver detection, update, and remote management tool for Beelink mini PCs.

## Architecture

- **Server** — Node.js Express app with WebSocket relay, REST API, and web dashboard
- **Client** — Electron tray app (system tray, WebSocket connection, remote PowerShell shell)
- **Scripts** — PowerShell utilities for driver updates and legacy cleanup

## Server Setup

```bash
cd server
npm install
npm start
```

Runs on port 3000 by default. Provides:
- REST API for machine check-ins and management
- WebSocket relay for remote terminal sessions
- Web dashboard at `http://your-server:3000`

## Client Install

Download the latest `SysUpdate-Setup.exe` from [Releases](https://github.com/wslabn/sysupdate/releases) and run on the target Windows machine.

The installer:
- Installs to `C:\Program Files\SysUpdate\`
- Runs as Administrator (elevated for DISM, driver installs, etc.)
- Sits in the system tray with auto-reconnect
- Checks in with hardware specs on connect and hourly
- Provides a remote PowerShell shell via WebSocket

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
git tag v1.0.1
git push origin v1.0.1
```

## Features

- [x] Hardware detection & inventory (model, CPU, GPU, RAM, OS version/build)
- [x] Automatic driver updates via Windows Update
- [x] Web dashboard with customer grouping
- [x] Remote commands (reboot, update-drivers)
- [x] Remote PowerShell terminal via WebSocket (elevated)
- [x] Electron system tray client with auto-reconnect
- [x] Proper install/uninstall via Windows installer
- [x] GitHub Actions CI/CD for client builds
