const { EventEmitter } = require('events');
const WebSocket = require('ws');
const { execSync, exec } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

const SERVER_URL = 'ws://192.168.200.146:3000';
const DATA_DIR = path.join(process.env.ProgramData || 'C:\\ProgramData', 'sysupdate');
const ID_FILE = path.join(DATA_DIR, 'machine-id');

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
      this.emit('connected');
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
      this.checkIn();
      this._startCheckinInterval();
    });

    this.ws.on('message', (data) => {
      this.emit('shell-input', data.toString());
    });

    this.ws.on('close', () => {
      this.emit('disconnected');
      this._stopCheckinInterval();
      this._reconnect();
    });

    this.ws.on('error', () => {
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
    const ps = `
      $hw = @{
        model = (Get-CimInstance Win32_ComputerSystem).Model
        cpu = (Get-CimInstance Win32_Processor | Select -First 1).Name
        gpu = ((Get-CimInstance Win32_VideoController).Name -join ', ')
        ram_gb = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
        os = (Get-CimInstance Win32_OperatingSystem).Caption
      }
      $hw | ConvertTo-Json
    `;
    exec(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, (err, stdout) => {
      let hardware = {};
      try { hardware = JSON.parse(stdout); } catch {}

      const payload = JSON.stringify({
        machineId: this.machineId,
        hostname: os.hostname(),
        hardware
      });

      const http = require('http');
      const req = http.request('http://192.168.200.146:3000/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      req.write(payload);
      req.end();
    });
  }

  updateDrivers() {
    this.emit('command', 'update-drivers');
    exec('powershell -ExecutionPolicy Bypass -File "' +
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'SysUpdate', 'update-drivers.ps1') + '"');
  }
}

module.exports = Agent;
