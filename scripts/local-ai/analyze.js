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
    args: ['--no-first-run', '--no-default-browser-check', '--disable-gpu']
  });

  const page = await browser.newPage();
  await page.goto('about:blank');

  console.log('Checking local AI availability...');
  const aiResult = await page.evaluate(async (logs) => {
    // Check for window.ai availability
    if (!window.ai) return { status: 'unavailable', message: 'window.ai not available' };

    try {
      const canCreate = await window.ai.canCreateTextSession();
      if (canCreate !== 'readily') {
        return { status: 'not-ready', message: `Model status: ${canCreate}` };
      }

      const session = await window.ai.createTextSession();
      const prompt = `You are an automated system health monitor for an MSP. Analyze the following Windows system telemetry data.

If everything looks healthy and normal, reply EXACTLY with: SYSTEM IS STABLE

If there are problems that need attention (disk space critical, services crashed, repeated errors, very high uptime without reboot, etc.), provide:
1. A brief summary of each issue found
2. Severity (Critical/Warning/Info)
3. Recommended action

Be concise. Only flag genuine problems, not routine informational events.

TELEMETRY DATA:
${logs}`;

      const response = await session.prompt(prompt);
      return { status: 'ok', message: response };
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

// Fallback: simple rule-based analysis when AI is unavailable
function runFallbackAnalysis() {
  const issues = [];

  // Check disk space
  const diskMatches = systemData.match(/(\w:) ([\d.]+)GB free \/ ([\d.]+)GB total \(([\d.]+)% free\)/g);
  if (diskMatches) {
    for (const m of diskMatches) {
      const pct = parseFloat(m.match(/([\d.]+)% free/)[1]);
      if (pct < 10) issues.push(`**Critical:** ${m.split(' ')[0]} only ${pct}% free disk space`);
    }
  }

  // Check pending reboot
  if (systemData.includes('Pending Reboot: True')) {
    issues.push('**Warning:** Pending reboot detected');
  }

  // Check uptime
  const uptimeMatch = systemData.match(/Uptime: ([\d.]+) hours/);
  if (uptimeMatch && parseFloat(uptimeMatch[1]) > 720) {
    issues.push(`**Warning:** System uptime is ${uptimeMatch[1]} hours (30+ days)`);
  }

  // Check failed services
  if (systemData.includes('=== FAILED AUTOMATIC SERVICES ===')) {
    const svcSection = systemData.split('=== FAILED AUTOMATIC SERVICES ===')[1].split('===')[0].trim();
    if (svcSection && svcSection !== 'None') {
      const count = svcSection.split('\n').filter(l => l.trim()).length;
      issues.push(`**Warning:** ${count} automatic service(s) not running`);
    }
  }

  // Check critical events
  const eventSection = systemData.split('=== RECENT CRITICAL/ERROR EVENTS ===')[1];
  if (eventSection && !eventSection.includes('No critical events')) {
    const eventCount = eventSection.trim().split('\n').filter(l => l.trim()).length;
    if (eventCount >= 10) {
      issues.push(`**Warning:** ${eventCount} critical/error events found in system log`);
    }
  }

  if (issues.length === 0) {
    console.log('Rule-based check: System appears stable.');
    return null;
  }

  return `**Rule-based analysis** (local AI unavailable)\n\n${issues.join('\n')}`;
}

runAnalysis().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
