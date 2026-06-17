import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'config.json');
const LOG_PATH = path.join(__dirname, 'system_data.txt');
const HOSTNAME = process.env.COMPUTERNAME || 'Unknown';
const OLLAMA_URL = 'http://localhost:11434/api/generate';
const FIX_HISTORY_PATH = path.join(__dirname, 'fix_history.json');

// Track what was auto-fixed to detect recurring issues
function loadFixHistory() {
  try { return JSON.parse(fs.readFileSync(FIX_HISTORY_PATH, 'utf8')); } catch { return {}; }
}
function saveFixHistory(history) {
  fs.writeFileSync(FIX_HISTORY_PATH, JSON.stringify(history));
}

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
  const diagPrompt = `Analyze this Windows system telemetry and respond ONLY with valid JSON. No other text.

If healthy, respond: {"status":"stable"}

If problems found, respond with a JSON array like these examples:
[{"issue":"WSearch service stopped","severity":"Warning","tier":"auto-fix","fix_command":"Start-Service WSearch","explanation":"Restarts Windows Search service"},
{"issue":"Shadow copy storage full on C:","severity":"Warning","tier":"auto-fix","fix_command":"vssadmin delete shadows /for=C: /all /quiet","explanation":"Deletes old shadow copies to free storage"},
{"issue":"Windows Update error 0x80073D02","severity":"Critical","tier":"manual","fix_command":"Stop-Service wuauserv; Remove-Item $env:windir\\SoftwareDistribution -Recurse -Force; Start-Service wuauserv","explanation":"Resets Windows Update cache and restarts service"},
{"issue":"TPM attestation failing","severity":"Critical","tier":"manual","fix_command":"","explanation":"TPM hardware issue - may need BIOS reset or vendor support"}]

Each item MUST have its OWN explanation that matches its own issue. Do not mix explanations between items.

RULES:
- auto-fix tier: Restarting services, clearing caches, vssadmin cleanup. fix_command must be a real PowerShell command.
- manual tier: Reboots, Windows Update, TPM, disk space decisions. fix_command can be empty or a suggested command.
- IGNORE these services: edgeupdate, GoogleUpdater, WaaSMedicSvc, MapsBroker, MicrosoftEdgeElevationService, GamingServices
- fix_command must be REAL PowerShell. Never put placeholder text.

${systemData}`;

  let issues = null;

  try {
    console.log('Querying Ollama for diagnosis...');
    const response = await askOllama(diagPrompt);

    if (response.includes('"status"') && response.includes('stable')) {
      console.log('System is stable. No action needed.');
      return;
    }

    // Parse JSON from response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      issues = JSON.parse(jsonMatch[0]);
    } else {
      // Retry with stricter prompt
      console.log('AI did not return JSON, retrying...');
      const retryPrompt = `Convert this system diagnosis into a JSON array. Reply with ONLY valid JSON, no other text.
Format: [{"issue":"desc","severity":"Critical|Warning|Info","tier":"auto-fix|manual","fix_command":"PowerShell cmd or empty","explanation":"what fix does"}]

Diagnosis:
${response}`;
      const retry = await askOllama(retryPrompt);
      const retryMatch = retry.match(/\[[\s\S]*\]/);
      if (retryMatch) {
        issues = JSON.parse(retryMatch[0]);
      } else {
        // Give up on JSON, send raw response
        console.log('Could not get JSON format. Sending raw alert.');
        await sendToDiscord('Alert', response);
        return;
      }
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

  // Step 2: Execute auto-fixes (skip recurring issues)
  const autoFixes = issues.filter(i => i.tier === 'auto-fix' && i.fix_command);
  const manualFixes = issues.filter(i => i.tier === 'manual');
  const fixResults = [];
  const fixHistory = loadFixHistory();

  for (const fix of autoFixes) {
    // Validate command is real PowerShell
    const validStarts = /^(Start-|Stop-|Restart-|Remove-|Clear-|Set-|Get-|New-|Invoke-|Reset-|vssadmin|net |ipconfig|sfc|DISM|shutdown|cleanmgr)/i;
    if (!fix.fix_command || fix.fix_command.length < 5 || !validStarts.test(fix.fix_command.trim())) {
      console.log(`Skipping invalid command for: ${fix.issue}`);
      manualFixes.push(fix);
      continue;
    }

    // Check if this same fix was applied recently (recurring issue)
    const fixKey = fix.fix_command.trim().toLowerCase();
    if (fixHistory[fixKey] && fixHistory[fixKey] >= 2) {
      console.log(`Recurring issue detected: ${fix.issue} (fixed ${fixHistory[fixKey]} times before)`);
      fix.issue += ' [RECURRING - auto-fix not resolving]';
      fix.severity = 'Critical';
      manualFixes.push(fix);
      continue;
    }

    console.log(`Auto-fixing: ${fix.issue}`);
    console.log(`  Running: ${fix.fix_command}`);
    const result = runPowerShell(fix.fix_command);
    fixResults.push({
      issue: fix.issue,
      command: fix.fix_command,
      success: result.success,
      output: result.output.slice(0, 200)
    });

    // Track this fix
    fixHistory[fixKey] = (fixHistory[fixKey] || 0) + 1;
  }

  saveFixHistory(fixHistory);

  for (const fix of autoFixes) {
    // Validate command is real PowerShell (must start with a known verb/binary)
    const validStarts = /^(Start-|Stop-|Restart-|Remove-|Clear-|Set-|Get-|New-|Invoke-|Reset-|vssadmin|net |ipconfig|sfc|DISM|shutdown|cleanmgr)/i;
    if (!fix.fix_command || fix.fix_command.length < 5 || !validStarts.test(fix.fix_command.trim())) {
      console.log(`Skipping invalid command for: ${fix.issue}`);
      manualFixes.push(fix);
      continue;
    }
    console.log(`Auto-fixing: ${fix.issue}`);
    console.log(`  Running: ${fix.fix_command}`);
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
      discordMsg += `   \`${r.command}\`\n`;
      if (!r.success) discordMsg += `   Error: ${r.output}\n`;
    }
    discordMsg += '\n';
  }

  // Manual fixes needing attention
  if (manualFixes.length > 0) {
    discordMsg += '**Requires Attention:**\n';
    for (const m of manualFixes) {
      discordMsg += `\u26a0\ufe0f **${m.severity}:** ${m.issue}\n`;
      // Show fix command if it's valid PowerShell
      const validCmd = m.fix_command && m.fix_command.length > 4 && /^(Start-|Stop-|Restart-|Remove-|Clear-|Set-|Get-|New-|Invoke-|Reset-|vssadmin|net |ipconfig|sfc|DISM|shutdown|cleanmgr)/i.test(m.fix_command.trim());
      if (validCmd) {
        discordMsg += `\`\`\`powershell\n${m.fix_command}\n\`\`\`\n`;
      }
      // Show explanation only if it's unique and relevant to this issue
      if (m.explanation && m.explanation.length > 5 && m.explanation.toLowerCase().includes(m.issue.toLowerCase().split(' ')[0])) {
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
