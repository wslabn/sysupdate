# Changelog

## v1.2.0

### New Features
- **Helpdesk Tools** — One-click maintenance tools accessible from the dashboard:
  - Full Disk Cleanup (temp files, Windows Update cache, recycle bin)
  - Clear Temp Files (user temp, Windows temp, prefetch)
  - Clear Browser Cache (Chrome and Edge)
  - Flush DNS Cache
  - SFC Scan (System File Checker)
  - DISM Repair (Windows image repair)
  - Restart Print Spooler
- **Remote Screenshot** — Capture the remote machine's screen from the dashboard, displayed in a full-size modal
- **Client Version Display** — Version shown in system tray menu and reported to dashboard
- **Customer Management** — Edit customer contacts (email, phone, address, notes) from the dashboard
- **Machine Notes** — Free-text notes per machine, saved in the Notes tab
- **Activity Log** — Automatic logging of all commands and tools run on each machine

### Improvements
- Dashboard detail panel reorganized with tabs (Overview, Storage, Network, Updates, Tools, Events, Notes, Activity)
- Disk space shown with progress bars and color-coded alerts (green/yellow/red)
- Network adapters displayed with IP and MAC address
- Tools output streams live to the terminal panel

---

## v1.1.0

### New Features
- **Auto Check-in** — Client automatically reports hardware, disk space, diagnostics, and system events on connect and hourly
- **OS Version Reporting** — Reports Windows version (e.g. 24H2) and build number
- **Disk Space Monitoring** — Reports all fixed drives with free/total space
- **System Diagnostics** — Uptime, last boot time, pending reboot status, network adapters
- **System Events** — Last 10 critical/error events from Windows System log
- **Push Client Update** — Update clients remotely from the dashboard
- **Auto-start** — Scheduled task starts client on login with elevation (no UAC prompt)

### Fixes
- Fixed PowerShell quoting issues in check-in script (uses temp file now)
- Fixed ArraySegment constructor syntax for Windows PowerShell

---

## v1.0.0

### Initial Release
- Electron system tray client with WebSocket connection and auto-reconnect
- Remote PowerShell terminal via WebSocket relay
- Web dashboard with customer grouping, machine list, and detail panel
- Hardware inventory (model, CPU, GPU, RAM, OS)
- Remote commands (reboot, update drivers)
- JWT authentication
- GitHub Actions CI/CD for automated builds
