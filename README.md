# sysupdate

Driver detection, update, and remote management tool for Beelink mini PCs.

## Architecture

- **Server** — Node.js Express app with WebSocket relay, REST API, and web dashboard
- **Agent** — PowerShell scripts installed on client machines (hourly check-in, persistent WebSocket, daily driver updates)

## Server Setup

```bash
cd server
npm install
npm start
```

## Client Install

Run on the target Windows machine as Administrator:
```powershell
irm https://raw.githubusercontent.com/wslabn/sysupdate/main/scripts/install.ps1 | iex
```

This will:
- Download agent scripts to `C:\Program Files\SysUpdate\`
- Register scheduled tasks (hourly check-in, daily driver update, persistent WebSocket)
- Register in Add/Remove Programs for clean uninstall

## Client Uninstall

From Add/Remove Programs (Settings > Apps), or manually:
```powershell
& "$env:ProgramFiles\SysUpdate\uninstall.ps1"
```

## Features
- [x] Hardware detection & inventory
- [x] Automatic driver updates via Windows Update
- [x] Web dashboard with customer grouping
- [x] Remote commands (reboot, update-drivers)
- [x] Remote PowerShell terminal via WebSocket
- [x] Proper install/uninstall with Add/Remove Programs entry
