const { EventEmitter } = require('events');
const WebSocket = require('ws');
const { execSync, exec } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const log = require('./logger');

const SERVER_URL = 'ws://192.168.200.146:3000';
const DATA_DIR = path.join(process.env.ProgramData || 'C:\\ProgramData', 'sysupdate');
const ID_FILE = path.join(DATA_DIR, 'machine-id');
const CLIENT_VERSION = require('./package.json').version;

class Agent extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.machineId = this._getMachineId();
    this.reconnectTimer = null;
  }

  _getMachineId() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(ID_FILE)) return fs.readFileSync(ID_FILE, 'utf8').trim();

    let id;
    try {
      id = execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_BaseBoard).SerialNumber"', { encoding: 'utf8' }).trim();
      if (!id || /^\s*$|To be filled/i.test(id)) throw new Error();
    } catch {
      id = require('crypto').randomUUID();
    }
    fs.writeFileSync(ID_FILE, id);
    return id;
  }

  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    const url = `${SERVER_URL}/ws/agent?id=${this.machineId}`;
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      log.info('WebSocket connected');
      this.emit('connected');
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
      this.checkIn();
      this._startCheckinInterval();
    });

    this.ws.on('message', (data) => {
      this.emit('shell-input', data.toString());
    });

    this.ws.on('close', () => {
      log.warn('WebSocket disconnected');
      this.emit('disconnected');
      this._stopCheckinInterval();
      this._reconnect();
    });

    this.ws.on('error', (err) => {
      log.error(`WebSocket error: ${err.message}`);
      this.emit('disconnected');
      this._stopCheckinInterval();
      this._reconnect();
    });
  }

  _reconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 10000);
  }

  _startCheckinInterval() {
    this.checkinInterval = setInterval(() => this.checkIn(), 3600000);
  }

  _stopCheckinInterval() {
    if (this.checkinInterval) { clearInterval(this.checkinInterval); this.checkinInterval = null; }
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.ws) this.ws.close();
  }

  checkIn() {
    const script = path.join(DATA_DIR, 'checkin.ps1');
    const ps = `
$hw = @{
  model = (Get-CimInstance Win32_ComputerSystem).Model
  cpu = (Get-CimInstance Win32_Processor | Select -First 1).Name
  gpu = ((Get-CimInstance Win32_VideoController).Name -join ', ')
  ram_gb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
  os = (Get-CimInstance Win32_OperatingSystem).Caption
  os_version = (Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion').DisplayVersion
  os_build = (Get-CimInstance Win32_OperatingSystem).BuildNumber
}

$disks = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
  @{ drive = $_.DeviceID; size_gb = [math]::Round($_.Size / 1GB, 1); free_gb = [math]::Round($_.FreeSpace / 1GB, 1); percent_free = [math]::Round(($_.FreeSpace / $_.Size) * 100, 1) }
}

$uptime = (Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
$diag = @{
  uptime_hours = [math]::Round($uptime.TotalHours, 1)
  cpu_temp = $null
  last_boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToString('yyyy-MM-dd HH:mm')
  pending_reboot = (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending')
  network_adapters = @(Get-CimInstance Win32_NetworkAdapterConfiguration -Filter "IPEnabled=True" | ForEach-Object {
    @{ name = $_.Description; ip = ($_.IPAddress | Select -First 1); mac = $_.MACAddress }
  })
}

$events = Get-WinEvent -FilterHashtable @{ LogName = 'System'; Level = 1,2 } -MaxEvents 10 -ErrorAction SilentlyContinue | ForEach-Object {
  @{ time = $_.TimeCreated.ToString('yyyy-MM-dd HH:mm'); source = $_.ProviderName; id = $_.Id; message = ($_.Message -replace "\r\n"," ") }
}

@{ hardware = $hw; disks = @($disks); diagnostics = $diag; events = @($events) } | ConvertTo-Json -Depth 5
`;
    fs.writeFileSync(script, ps);
    exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${script}"`, (err, stdout) => {
      let hardware = {}, events = [], disks = [], diagnostics = {};
      try {
        const result = JSON.parse(stdout);
        hardware = result.hardware || {};
        events = result.events || [];
        disks = result.disks || [];
        diagnostics = result.diagnostics || {};
      } catch {}

      const payload = JSON.stringify({
        machineId: this.machineId,
        hostname: os.hostname(),
        hardware,
        events,
        disks,
        diagnostics,
        clientVersion: CLIENT_VERSION
      });

      const http = require('http');
      const req = http.request('http://192.168.200.146:3000/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      req.on('error', (e) => log.error(`Check-in failed: ${e.message}`));
      req.write(payload);
      req.end();
      log.info('Check-in sent');
    });
  }

  updateDrivers() {
    log.info('Running driver update');
    this.emit('command', 'update-drivers');
    exec('powershell -ExecutionPolicy Bypass -File "' +
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'SysUpdate', 'update-drivers.ps1') + '"');
  }
}

module.exports = Agent;
