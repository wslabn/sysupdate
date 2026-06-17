import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'config.json');
const LOG_PATH = path.join(__dirname, 'system_data.txt');
const HOSTNAME = process.env.COMPUTERNAME || 'Unknown';
const OLLAMA_URL = 'http://localhost:11434/api/generate';

// Load config
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const DISCORD_WEBHOOK = config.discord_webhook;

if (!DISCORD_WEBHOOK || DISCORD_WEBHOOK.includes('PASTE_YOUR')) {
  console.error('ERROR: Set your Discord webhook URL in config.json');
  process.exit(1);
}

// Load system data
if (!fs.existsSync(LOG_PATH)) {
  console.error('ERROR: No system_data.txt found. Run gather.ps1 first.');
  process.exit(1);
}
const systemData = fs.readFileSync(LOG_PATH, 'utf8');

async function sendToDiscord(report) {
  const payload = {
    embeds: [{
      title: `Alert: ${HOSTNAME}`,
      color: 16731136,
      description: report.slice(0, 4000),
      timestamp: new Date().toISOString(),
      footer: { text: 'SysUpdate Local AI Monitor' }
    }]
  };

  const res = await fetch(DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
    console.log('Alert sent to Discord.');
  } else {
    console.error(`Discord error: ${res.status} ${res.statusText}`);
  }
}

async function askOllama(prompt) {
  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model || 'phi3:mini',
      prompt,
      stream: false
    })
  });

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = await res.json();
  return data.response;
}

async function runAnalysis() {
  const prompt = `You are an automated system health monitor for an MSP. Analyze the following Windows system telemetry.

If everything looks healthy and normal, reply EXACTLY with: SYSTEM IS STABLE

If there are problems that need attention, provide:
1. A brief summary of each issue
2. Severity (Critical/Warning/Info)
3. One-sentence recommended action

Ignore routine stopped services like Windows Update medic, Google updaters, Edge updaters. Only flag services that matter.
Be concise. Do not repeat the raw data back.

TELEMETRY:
${systemData}`;

  try {
    console.log('Querying Ollama...');
    const response = await askOllama(prompt);
    console.log(`AI response: ${response.slice(0, 200)}...`);

    if (response.includes('SYSTEM IS STABLE')) {
      console.log('System is stable. No alert sent.');
    } else {
      await sendToDiscord(response);
    }
  } catch (e) {
    console.log(`Ollama not available: ${e.message}`);
    console.log('Falling back to rule-based analysis...');
    const fallback = runFallbackAnalysis();
    if (fallback) await sendToDiscord(fallback);
  }
}

// Fallback: smart rule-based analysis when Ollama is unavailable
function runFallbackAnalysis() {
  const issues = [];
  const pendingReboot = systemData.includes('Pending Reboot: True');

  const ignoredServices = ['WaaSMedicSvc', 'MapsBroker', 'wlidsvc', 'SCardSvr',
    'SCPolicySvc', 'sppsvc', 'TieringEngineService', 'WbioSrvc', 'perceptionsimulation',
    'edgeupdate', 'GoogleUpdater', 'MicrosoftEdgeElevationService'];

  // Check disk space
  const diskMatches = systemData.match(/\w: [\d.]+GB free \/ [\d.]+GB total \([\d.]+% free\)/g);
  if (diskMatches) {
    for (const m of diskMatches) {
      const pct = parseFloat(m.match(/([\d.]+)% free/)[1]);
      if (pct < 5) issues.push({ severity: 'Critical', msg: `${m.split(' ')[0]} only ${pct}% free disk space` });
      else if (pct < 10) issues.push({ severity: 'Warning', msg: `${m.split(' ')[0]} low disk space (${pct}% free)` });
    }
  }

  // Check uptime
  const uptimeMatch = systemData.match(/Uptime: ([\d.]+) hours/);
  const uptimeHours = uptimeMatch ? parseFloat(uptimeMatch[1]) : 0;

  // Check failed services
  let failedServiceCount = 0;
  let failedServiceNames = [];
  const svcSection = systemData.split('=== FAILED AUTOMATIC SERVICES ===')[1]?.split('===')[0]?.trim();
  if (svcSection && svcSection !== 'None') {
    const lines = svcSection.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const svcName = line.split(' ')[0];
      if (!ignoredServices.some(s => line.toLowerCase().includes(s.toLowerCase()))) {
        failedServiceCount++;
        failedServiceNames.push(svcName);
      }
    }
  }

  // Check critical events
  const eventSection = systemData.split('=== RECENT CRITICAL/ERROR EVENTS ===')[1];
  let eventCount = 0;
  let eventSources = new Set();
  if (eventSection && !eventSection.includes('No critical events')) {
    const eventLines = eventSection.trim().split('\n').filter(l => l.trim());
    eventCount = eventLines.length;
    for (const line of eventLines) {
      const srcMatch = line.match(/\[([^\]]+)\] ID:/);
      if (srcMatch) eventSources.add(srcMatch[1]);
    }
  }

  // Correlate
  if (pendingReboot) {
    let msg = 'Pending reboot detected';
    if (uptimeHours > 72) msg += ` (uptime: ${Math.round(uptimeHours / 24)} days)`;
    if (failedServiceCount > 0) msg += `. ${failedServiceCount} service(s) may be waiting on reboot: ${failedServiceNames.slice(0, 3).join(', ')}`;
    if (eventCount >= 10) msg += `. High error event volume (${eventCount}) likely related.`;
    issues.push({ severity: 'Warning', msg });
  } else {
    if (uptimeHours > 720) {
      issues.push({ severity: 'Warning', msg: `System uptime is ${Math.round(uptimeHours / 24)} days - consider scheduling a reboot` });
    }
    if (failedServiceCount > 0) {
      issues.push({ severity: 'Warning', msg: `${failedServiceCount} automatic service(s) not running: ${failedServiceNames.slice(0, 5).join(', ')}` });
    }
    if (eventCount >= 15) {
      issues.push({ severity: 'Warning', msg: `${eventCount} critical/error events from: ${[...eventSources].slice(0, 4).join(', ')}` });
    }
  }

  if (issues.length === 0) {
    console.log('Rule-based check: System appears stable.');
    return null;
  }

  const formatted = issues.map(i => `**${i.severity}:** ${i.msg}`).join('\n');
  return `**Rule-based analysis** (AI unavailable)\n\n${formatted}`;
}

runAnalysis().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
