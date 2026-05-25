const { spawn, exec } = require('child_process');
const path = require('path');
const https = require('https');
const fs = require('fs');

class Terminal {
  constructor(agent) {
    this.agent = agent;
    this.shell = null;

    agent.on('shell-input', (data) => {
      const msg = data.toString();
      if (msg === '__UPDATE__') {
        this._selfUpdate();
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
                exec(`"${installerPath}" /S`, () => {});
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
}

module.exports = Terminal;
