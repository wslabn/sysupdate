const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(process.env.ProgramData || 'C:\\ProgramData', 'sysupdate', 'logs');
const MAX_FILES = 14; // keep 2 weeks of logs

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function getLogPath() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `${date}.log`);
}

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
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
