import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'config.json');
const LOG_PATH = path.join(__dirname, 'system_data.txt');
const HOSTNAME = process.env.COMPUTERNAME || 'Unknown';

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

// Find Edge executable
function findEdge() {
  const paths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

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

async function runAnalysis() {
  const edgePath = findEdge();
  if (!edgePath) {
    console.error('ERROR: Microsoft Edge not found.');
    process.exit(1);
  }

  console.log('Launching headless Edge...');
  const browser = await puppeteer.launch({
    executablePath: edgePath,
    headless: true,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--enable-features=OptimizationGuideModelExecution,OptimizationGuideOnDeviceModel',
      '--optimization-guide-on-device-model-execution-override=BypassPerfRequirement'
    ]
  });

  const page = await browser.newPage();
  await page.goto('about:blank');

  console.log('Checking local AI availability...');
  const aiResult = await page.evaluate(async (logs) => {
    // Check for window.ai availability (multiple API shapes)
    const ai = window.ai || window.model || null;
    if (!ai) {
      // Try the newer Prompt API namespace
      if (window.ai?.languageModel) {
        try {
          const caps = await window.ai.languageModel.capabilities();
          if (caps.available === 'no') return { status: 'unavailable', message: 'Model not available' };
          const session = await window.ai.languageModel.create();
          const prompt = `You are an automated system health monitor. Analyze this telemetry.\nIf healthy, reply EXACTLY: SYSTEM IS STABLE\nIf problems found, summarize issues with severity and recommended actions.\n\n${logs}`;
          const response = await session.prompt(prompt);
          session.destroy();
          return { status: 'ok', message: response };
        } catch (e) {
          return { status: 'error', message: e.message };
        }
      }
      return { status: 'unavailable', message: 'window.ai not available (no API found)' };
    }

    try {
      // Try legacy createTextSession API
      if (ai.canCreateTextSession) {
        const canCreate = await ai.canCreateTextSession();
        if (canCreate !== 'readily') {
          return { status: 'not-ready', message: `Model status: ${canCreate}` };
        }
        const session = await ai.createTextSession();
        const prompt = `You are an automated system health monitor. Analyze this telemetry.\nIf healthy, reply EXACTLY: SYSTEM IS STABLE\nIf problems found, summarize issues with severity and recommended actions.\n\n${logs}`;
        const response = await session.prompt(prompt);
        return { status: 'ok', message: response };
      }

      // Try createGenericSession
      if (ai.createGenericSession) {
        const session = await ai.createGenericSession();
        const prompt = `You are an automated system health monitor. Analyze this telemetry.\nIf healthy, reply EXACTLY: SYSTEM IS STABLE\nIf problems found, summarize issues with severity and recommended actions.\n\n${logs}`;
        const response = await session.prompt(prompt);
        return { status: 'ok', message: response };
      }

      return { status: 'unavailable', message: 'window.ai exists but no known session API found' };
    } catch (e) {
      return { status: 'error', message: e.message };
    }
  }, systemData);

  await browser.close();

  // Handle result
  console.log(`AI status: ${aiResult.status}`);

  if (aiResult.status === 'unavailable' || aiResult.status === 'not-ready') {
    console.log(`Local AI not available: ${aiResult.message}`);
    console.log('Falling back to rule-based analysis...');
    const fallbackResult = runFallbackAnalysis();
    if (fallbackResult) await sendToDiscord(fallbackResult);
    return;
  }

  if (aiResult.status === 'error') {
    console.error(`AI error: ${aiResult.message}`);
    return;
  }

  // AI responded
  const response = aiResult.message;
  console.log(`AI response: ${response.slice(0, 200)}...`);

  if (response.includes('SYSTEM IS STABLE')) {
    console.log('System is stable. No alert sent.');
  } else {
    console.log('Issues detected. Sending alert...');
    await sendToDiscord(response);
  }
}

// Fallback: smart rule-based analysis when AI is unavailable
function runFallbackAnalysis() {
  const issues = [];
  const pendingReboot = systemData.includes('Pending Reboot: True');

  // Known safe-to-ignore stopped services
  const ignoredServices = ['WaaSMedicSvc', 'MapsBroker', 'wlidsvc', 'SCardSvr',
    'SCPolicySvc', 'sppsvc', 'TieringEngineService', 'WbioSrvc', 'perceptionsimulation'];

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

  // Check failed services (filter ignored ones)
  let failedServiceCount = 0;
  let failedServiceNames = [];
  const svcSection = systemData.split('=== FAILED AUTOMATIC SERVICES ===')[1]?.split('===')[0]?.trim();
  if (svcSection && svcSection !== 'None') {
    const lines = svcSection.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const svcName = line.split(' ')[0];
      if (!ignoredServices.some(s => line.includes(s))) {
        failedServiceCount++;
        failedServiceNames.push(svcName);
      }
    }
  }

  // Check critical events (only count unique sources)
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

  // Correlate: pending reboot is likely the root cause
  if (pendingReboot) {
    let rebootMsg = 'Pending reboot detected';
    if (uptimeHours > 72) rebootMsg += ` (uptime: ${Math.round(uptimeHours / 24)} days)`;
    if (failedServiceCount > 0) rebootMsg += `. ${failedServiceCount} service(s) may be waiting on reboot: ${failedServiceNames.slice(0, 3).join(', ')}`;
    if (eventCount >= 10) rebootMsg += `. High error event volume (${eventCount}) likely related.`;
    issues.push({ severity: 'Warning', msg: rebootMsg });
  } else {
    // No pending reboot — report issues individually
    if (uptimeHours > 720) {
      issues.push({ severity: 'Warning', msg: `System uptime is ${Math.round(uptimeHours / 24)} days — consider scheduling a reboot` });
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
  return `**Rule-based analysis** (local AI unavailable)\n\n${formatted}`;
}

runAnalysis().then(() => selfUpdate()).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

// Update both scripts from GitHub after analysis completes
async function selfUpdate() {
  const baseUrl = 'https://raw.githubusercontent.com/wslabn/sysupdate/main/scripts/local-ai';
  const files = ['analyze.js', 'gather.ps1'];
  for (const file of files) {
    try {
      const res = await fetch(`${baseUrl}/${file}`);
      if (res.ok) {
        const content = await res.text();
        fs.writeFileSync(path.join(__dirname, file), content);
      }
    } catch {}
  }
}
