const { app, Tray, Menu, Notification, nativeImage } = require('electron');
const path = require('path');
const Agent = require('./agent');
const Terminal = require('./terminal');

// Single instance lock
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(); }

let tray = null;
let agent = null;
let terminal = null;

// Hide from taskbar (tray only)
app.on('window-all-closed', (e) => e.preventDefault());

app.whenReady().then(() => {
  // Create tray
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('SysUpdate - Connecting...');

  // Start agent
  agent = new Agent();
  terminal = new Terminal(agent);

  agent.on('connected', () => {
    tray.setToolTip('SysUpdate - Connected');
    updateMenu('connected');
  });

  agent.on('disconnected', () => {
    tray.setToolTip('SysUpdate - Disconnected');
    updateMenu('disconnected');
  });

  agent.on('command', (cmd) => {
    new Notification({ title: 'SysUpdate', body: `Executing: ${cmd}` }).show();
  });

  agent.connect();
  updateMenu('connecting');
});

function updateMenu(status) {
  const statusLabel = {
    connected: '● Connected',
    disconnected: '○ Disconnected',
    connecting: '◌ Connecting...'
  }[status] || status;

  const menu = Menu.buildFromTemplate([
    { label: `SysUpdate - ${statusLabel}`, enabled: false },
    { type: 'separator' },
    { label: 'Check In Now', click: () => agent.checkIn() },
    { label: 'Update Drivers', click: () => agent.updateDrivers() },
    { type: 'separator' },
    { label: 'Quit', click: () => { agent.disconnect(); app.quit(); } }
  ]);
  tray.setContextMenu(menu);
}
