## What's New in v1.2.0

### Helpdesk Tools
One-click maintenance tools from the dashboard Tools tab:
- Full Disk Cleanup (temp files, Windows Update cache, recycle bin)
- Clear Temp Files (user temp, Windows temp, prefetch)
- Clear Browser Cache (Chrome and Edge)
- Flush DNS Cache
- SFC Scan (System File Checker)
- DISM Repair (Windows image repair)
- Restart Print Spooler

### Remote Screenshot
Capture the remote machine's screen from the dashboard — displayed in a full-size modal.

### Client Version Display
Version shown in system tray menu and reported to dashboard for tracking.

### Customer Management
- Edit customer contacts (email, phone, address, notes)
- Machine notes (free-text per machine)
- Activity log (automatic logging of all commands and tools)

### Client Logging
- Daily log files at `C:\ProgramData\sysupdate\logs\`
- 14-day retention with auto-cleanup
- Logs connections, check-ins, commands, and errors
- "View Logs" option in tray menu

### Dashboard Improvements
- Tabbed detail panel (Overview, Storage, Network, Updates, Tools, Events, Notes, Activity)
- Disk space progress bars with color-coded alerts
- Network adapters with IP and MAC
- Tool output streams live to terminal panel

### Fixes
- Client now restarts automatically after push update
