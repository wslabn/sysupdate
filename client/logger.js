const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(process.env.ProgramData || 'C:\\ProgramData', 'sysupdate', 'logs');
const MAX_FILES = 14; // keep 2 weeks of logs

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function getLogPath() {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  return path.join(LOG_DIR, `${date}.log`);
}

function timestamp() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
}

function write(level, msg) {
  const line = `[${timestamp()}] [${level}] ${msg}\n`;
  fs.appendFileSync(getLogPath(), line);
}

function cleanup() {
  try {
    const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.log')).sort();
    while (files.length > MAX_FILES) {
      fs.unlinkSync(path.join(LOG_DIR, files.shift()));
    }
  } catch {}
}

// Cleanup old logs on startup
cleanup();

module.exports = {
  info: (msg) => write('INFO', msg),
  warn: (msg) => write('WARN', msg),
  error: (msg) => write('ERROR', msg)
};
