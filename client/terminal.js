const { spawn } = require('child_process');

class Terminal {
  constructor(agent) {
    this.agent = agent;
    this.shell = null;

    agent.on('shell-input', (data) => {
      this._ensureShell();
      this.shell.stdin.write(data + '\n');
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
}

module.exports = Terminal;
