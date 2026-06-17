import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
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

async function sendToDiscord(title, description, color = 16731136) {
  const payload = {
    embeds: [{
      title: `${title}: ${HOSTNAME}`,
      color,
      description: description.slice(0, 4000),
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
    console.log('Discord message sent.');
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

function runPowerShell(cmd) {
  try {
    const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${cmd.replace(/"/g, '\\"')}"`, {
      encoding: 'utf8',
      timeout: 60000,
      windowsHide: true
    });
    return { success: true, output: result.trim() };
  } catch (e) {
    return { success: false, output: e.message };
  }
}

async function runAnalysis() {
  // Step 1: Diagnose
  const diagPrompt = `You are an automated system health monitor for an MSP. Analyze this Windows telemetry.

If everything is healthy, reply EXACTLY: SYSTEM IS STABLE

If there are problems, respond in this EXACT JSON format (no markdown, no code fences):
[
  {
    "issue": "brief description",
    "severity": "Critical|Warning|Info",
    "tier": "auto-fix|manual",
    "fix_command": "PowerShell command to fix (or empty string if manual)",
    "explanation": "what the fix does"
  }
]

TIER RULES:
- "auto-fix": Safe, reversible, no-downtime fixes like restarting services, clearing temp files, flushing DNS, clearing shadow copies, restarting spooler
- "manual": Anything requiring reboot, Windows Update fixes, TPM/BitLocker, disk space requiring user decisions, unknown issues

Ignore these stopped services (they're normal): edgeupdate, GoogleUpdater, WaaSMedicSvc, MapsBroker, MicrosoftEdgeElevationService

TELEMETRY:
${systemData}`;

  let issues = null;

  try {
    console.log('Querying Ollama for diagnosis...');
    const response = await askOllama(diagPrompt);

    if (response.includes('SYSTEM IS STABLE')) {
      console.log('System is stable. No action needed.');
      return;
    }

    // Parse JSON from response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      issues = JSON.parse(jsonMatch[0]);
    } else {
      // AI didn't return JSON, send raw response as alert
      console.log('AI returned non-JSON response, sending as alert.');
      await sendToDiscord('Alert', response);
      return;
    }
  } catch (e) {
    console.log(`Ollama error: ${e.message}`);
    console.log('Falling back to rule-based analysis...');
    const fallback = runFallbackAnalysis();
    if (fallback) {
      try { await sendToDiscord('Alert', fallback); } catch {}
    }
    return;
  }

  if (!issues || issues.length === 0) {
    console.log('No issues found.');
    return;
  }

  // Step 2: Execute auto-fixes
  const autoFixes = issues.filter(i => i.tier === 'auto-fix' && i.fix_command);
  const manualFixes = issues.filter(i => i.tier === 'manual');
  const fixResults = [];

  for (const fix of autoFixes) {
    console.log(`Auto-fixing: ${fix.issue}`);
    const result = runPowerShell(fix.fix_command);
    fixResults.push({
      issue: fix.issue,
      command: fix.fix_command,
      success: result.success,
      output: result.output.slice(0, 200)
    });
  }

  // Step 3: Report to Discord
  let discordMsg = '';

  // Auto-fix results
  if (fixResults.length > 0) {
    discordMsg += '**Auto-Remediated:**\n';
    for (const r of fixResults) {
      const icon = r.success ? '\u2705' : '\u274c';
      discordMsg += `${icon} ${r.issue}\n`;
      if (!r.success) discordMsg += `   Error: ${r.output}\n`;
    }
    discordMsg += '\n';
  }

  // Manual fixes needing attention
  if (manualFixes.length > 0) {
    discordMsg += '**Requires Attention:**\n';
    for (const m of manualFixes) {
      discordMsg += `\u26a0\ufe0f **${m.severity}:** ${m.issue}\n`;
      if (m.fix_command) {
        discordMsg += `\`\`\`powershell\n${m.fix_command}\n\`\`\`\n`;
      }
      if (m.explanation) {
        discordMsg += `   _${m.explanation}_\n`;
      }
    }
  }

  if (discordMsg) {
    const color = manualFixes.some(m => m.severity === 'Critical') ? 16711680 : 16751360;
    try {
      await sendToDiscord(fixResults.length > 0 ? 'Auto-Fix Report' : 'Alert', discordMsg, color);
    } catch (e) {
      console.error(`Failed to send to Discord: ${e.message}`);
    }
  }
}

// Fallback rule-based analysis
function runFallbackAnalysis() {
  const issues = [];
  const pendingReboot = systemData.includes('Pending Reboot: True');

  const ignoredServices = ['WaaSMedicSvc', 'MapsBroker', 'wlidsvc', 'SCardSvr',
    'SCPolicySvc', 'sppsvc', 'TieringEngineService', 'WbioSrvc', 'perceptionsimulation',
    'edgeupdate', 'GoogleUpdater', 'MicrosoftEdgeElevationService'];

  const diskMatches = systemData.match(/\w: [\d.]+GB free \/ [\d.]+GB total \([\d.]+% free\)/g);
  if (diskMatches) {
    for (const m of diskMatches) {
      const pct = parseFloat(m.match(/([\d.]+)% free/)[1]);
      if (pct < 5) issues.push({ severity: 'Critical', msg: `${m.split(' ')[0]} only ${pct}% free disk space` });
      else if (pct < 10) issues.push({ severity: 'Warning', msg: `${m.split(' ')[0]} low disk space (${pct}% free)` });
    }
  }

  const uptimeMatch = systemData.match(/Uptime: ([\d.]+) hours/);
  const uptimeHours = uptimeMatch ? parseFloat(uptimeMatch[1]) : 0;

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

  if (pendingReboot) {
    let msg = 'Pending reboot detected';
    if (uptimeHours > 72) msg += ` (uptime: ${Math.round(uptimeHours / 24)} days)`;
    if (failedServiceCount > 0) msg += `. ${failedServiceCount} service(s) may be waiting on reboot: ${failedServiceNames.slice(0, 3).join(', ')}`;
    if (eventCount >= 10) msg += `. High error event volume (${eventCount}) likely related.`;
    issues.push({ severity: 'Warning', msg });
  } else {
    if (uptimeHours > 720) issues.push({ severity: 'Warning', msg: `System uptime is ${Math.round(uptimeHours / 24)} days - consider scheduling a reboot` });
    if (failedServiceCount > 0) issues.push({ severity: 'Warning', msg: `${failedServiceCount} automatic service(s) not running: ${failedServiceNames.slice(0, 5).join(', ')}` });
    if (eventCount >= 15) issues.push({ severity: 'Warning', msg: `${eventCount} critical/error events from: ${[...eventSources].slice(0, 4).join(', ')}` });
  }

  if (issues.length === 0) {
    console.log('Rule-based check: System appears stable.');
    return null;
  }

  return issues.map(i => `**${i.severity}:** ${i.msg}`).join('\n');
}

runAnalysis().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
