const { spawn, exec } = require('child_process');
const path = require('path');
const https = require('https');
const fs = require('fs');
const log = require('./logger');

class Terminal {
  constructor(agent) {
    this.agent = agent;
    this.shell = null;

    agent.on('shell-input', (data) => {
      const msg = data.toString();
      if (msg === '__UPDATE__') {
        log.info('Received update command');
        this._selfUpdate();
      } else if (msg === '__SCREENSHOT__') {
        log.info('Received screenshot command');
        this._takeScreenshot();
      } else if (msg.startsWith('__TOOL__')) {
        const tool = msg.replace('__TOOL__', '');
        log.info(`Received tool command: ${tool}`);
        this._runTool(tool);
      } else {
        this._ensureShell();
        this.shell.stdin.write(msg + '\n');
      }
    });

    agent.on('disconnected', () => this._killShell());
  }

  _ensureShell() {
    if (this.shell && !this.shell.killed) return;

    this.shell = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    this.shell.stdout.on('data', (data) => {
      this.agent.send(data.toString());
    });

    this.shell.stderr.on('data', (data) => {
      this.agent.send(data.toString());
    });

    this.shell.on('exit', () => { this.shell = null; });
  }

  _killShell() {
    if (this.shell && !this.shell.killed) {
      this.shell.kill();
      this.shell = null;
    }
  }

  _takeScreenshot() {
    this.agent.send('[Taking screenshot...]\r\n');
    const scriptPath = path.join(process.env.TEMP || 'C:\\Temp', 'sysupdate-screenshot.ps1');
    const outPath = path.join(process.env.TEMP || 'C:\\Temp', 'sysupdate-screenshot.png');
    const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save('${outPath.replace(/\\/g, '\\\\')}')
$gfx.Dispose()
$bmp.Dispose()
Write-Output "__SCREENSHOT_READY__"
`;
    fs.writeFileSync(scriptPath, ps);

    const proc = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      windowsHide: true
    });

    proc.stdout.on('data', (data) => {
      if (data.toString().includes('__SCREENSHOT_READY__')) {
        try {
          const imgData = fs.readFileSync(outPath);
          const base64 = imgData.toString('base64');
          this.agent.send(`__SCREENSHOT_DATA__${base64}`);
        } catch (e) {
          this.agent.send(`Screenshot error: ${e.message}\r\n`);
        }
      }
    });
    proc.stderr.on('data', (data) => this.agent.send(data.toString()));
    proc.on('exit', () => {
      try { fs.unlinkSync(outPath); } catch {}
      try { fs.unlinkSync(scriptPath); } catch {}
    });
  }

  _selfUpdate() {
    this.agent.send('Checking for update...\r\n');
    const apiUrl = 'https://api.github.com/repos/wslabn/sysupdate/releases/latest';

    https.get(apiUrl, { headers: { 'User-Agent': 'SysUpdate' } }, (res) => {
      let body = '';
      res.on('data', (d) => body += d);
      res.on('end', () => {
        try {
          const release = JSON.parse(body);
          const asset = release.assets.find(a => a.name.endsWith('.exe'));
          if (!asset) { this.agent.send('No installer found in latest release.\r\n'); return; }

          const installerPath = path.join(process.env.TEMP || 'C:\\Temp', 'SysUpdate-Setup.exe');
          this.agent.send(`Downloading ${asset.name}...\r\n`);

          const file = fs.createWriteStream(installerPath);
          const download = (url) => {
            https.get(url, { headers: { 'User-Agent': 'SysUpdate' } }, (resp) => {
              if (resp.statusCode === 302 || resp.statusCode === 301) {
                download(resp.headers.location);
                return;
              }
              resp.pipe(file);
              file.on('finish', () => {
                file.close();
                this.agent.send('Installing update (app will restart)...\r\n');
                log.info('Installing update...');
                const appPath = process.execPath;
                exec(`"${installerPath}" /S`, () => {
                  log.info('Update installed, restarting...');
                  spawn(appPath, [], { detached: true, stdio: 'ignore' }).unref();
                  process.exit(0);
                });
              });
            });
          };
          download(asset.browser_download_url);
        } catch (e) {
          this.agent.send(`Update failed: ${e.message}\r\n`);
        }
      });
    }).on('error', (e) => {
      this.agent.send(`Update check failed: ${e.message}\r\n`);
    });
  }

  _runTool(tool) {
    const tools = {
      'disk-cleanup': `
Write-Output "Running Disk Cleanup..."
Remove-Item -Path "$env:TEMP\\*" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "C:\\Windows\\Temp\\*" -Recurse -Force -ErrorAction SilentlyContinue
Clear-RecycleBin -Force -ErrorAction SilentlyContinue
Remove-Item -Path "C:\\Windows\\SoftwareDistribution\\Download\\*" -Recurse -Force -ErrorAction SilentlyContinue
$before = (Get-PSDrive C).Free
Write-Output "Disk cleanup complete. Free space: $([math]::Round($before/1GB,2)) GB"
`,
      'flush-dns': `
Write-Output "Flushing DNS cache..."
Clear-DnsClientCache
Write-Output "DNS cache flushed."
`,
      'clear-browser-cache': `
Write-Output "Clearing browser caches..."
$paths = @(
  "$env:LOCALAPPDATA\\Google\\Chrome\\User Data\\Default\\Cache",
  "$env:LOCALAPPDATA\\Google\\Chrome\\User Data\\Default\\Code Cache",
  "$env:LOCALAPPDATA\\Microsoft\\Edge\\User Data\\Default\\Cache",
  "$env:LOCALAPPDATA\\Microsoft\\Edge\\User Data\\Default\\Code Cache"
)
foreach ($p in $paths) {
  if (Test-Path $p) { Remove-Item "$p\\*" -Recurse -Force -ErrorAction SilentlyContinue; Write-Output "  Cleared: $p" }
}
Write-Output "Browser cache cleanup complete."
`,
      'sfc-scan': `
Write-Output "Running System File Checker (this may take several minutes)..."
sfc /scannow
Write-Output "SFC scan complete."
`,
      'dism-repair': `
Write-Output "Running DISM repair (this may take several minutes)..."
DISM /Online /Cleanup-Image /RestoreHealth
Write-Output "DISM repair complete."
`,
      'restart-spooler': `
Write-Output "Restarting Print Spooler..."
Stop-Service -Name Spooler -Force
Remove-Item -Path "C:\\Windows\\System32\\spool\\PRINTERS\\*" -Force -ErrorAction SilentlyContinue
Start-Service -Name Spooler
Write-Output "Print Spooler restarted."
`,
      'clear-temp': `
Write-Output "Clearing temp files..."
$userTemp = Remove-Item -Path "$env:TEMP\\*" -Recurse -Force -ErrorAction SilentlyContinue
$winTemp = Remove-Item -Path "C:\\Windows\\Temp\\*" -Recurse -Force -ErrorAction SilentlyContinue
$prefetch = Remove-Item -Path "C:\\Windows\\Prefetch\\*" -Force -ErrorAction SilentlyContinue
Write-Output "Temp files cleared."
`
    };

    const script = tools[tool];
    if (!script) { this.agent.send(`Unknown tool: ${tool}\r\n`); return; }

    this.agent.send(`[Running: ${tool}]\r\n`);
    const scriptPath = path.join(process.env.TEMP || 'C:\\Temp', `sysupdate-tool-${tool}.ps1`);
    fs.writeFileSync(scriptPath, script);

    const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      windowsHide: true
    });

    ps.stdout.on('data', (data) => this.agent.send(data.toString()));
    ps.stderr.on('data', (data) => this.agent.send(data.toString()));
    ps.on('exit', (code) => {
      this.agent.send(`\r\n[${tool} finished with code ${code}]\r\n`);
    });
  }
}

module.exports = Terminal;
