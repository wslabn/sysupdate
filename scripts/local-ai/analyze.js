import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'config.json');
const LOG_PATH = path.join(__dirname, 'system_data.txt');
const FIX_HISTORY_PATH = path.join(__dirname, 'fix_history.json');
const HOSTNAME = process.env.COMPUTERNAME || 'Unknown';

// Load config
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const DISCORD_WEBHOOK = config.discord_webhook;
const AZURE_ENDPOINT = config.azure_endpoint?.endsWith('/') ? config.azure_endpoint : config.azure_endpoint + '/';
const AZURE_KEY = config.azure_key;
const AZURE_DEPLOYMENT = config.azure_deployment || 'gpt-4.1-mini';

if (!DISCORD_WEBHOOK || DISCORD_WEBHOOK.includes('PASTE_YOUR')) {
  console.error('ERROR: Set discord_webhook in config.json');
  process.exit(1);
}
if (!AZURE_KEY || !AZURE_ENDPOINT) {
  console.error('ERROR: Set azure_endpoint and azure_key in config.json');
  process.exit(1);
}

// Load system data (truncate to 3000 chars for API limits)
if (!fs.existsSync(LOG_PATH)) {
  console.error('ERROR: No system_data.txt found. Run gather.ps1 first.');
  process.exit(1);
}
const systemData = fs.readFileSync(LOG_PATH, 'utf8').slice(0, 3000);

// Fix history tracking
function loadFixHistory() {
  try { return JSON.parse(fs.readFileSync(FIX_HISTORY_PATH, 'utf8')); } catch { return {}; }
}
function saveFixHistory(history) {
  fs.writeFileSync(FIX_HISTORY_PATH, JSON.stringify(history));
}

async function sendToDiscord(title, description, color = 16731136) {
  const payload = {
    embeds: [{
      title: `${title}: ${HOSTNAME}`,
      color,
      description: description.slice(0, 4000),
      timestamp: new Date().toISOString(),
      footer: { text: 'SysUpdate AI Monitor' }
    }]
  };

  const res = await fetch(DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (res.ok) console.log('Discord message sent.');
  else console.error(`Discord error: ${res.status} ${res.statusText}`);
}

async function askAI(prompt) {
  const url = `${AZURE_ENDPOINT}openai/deployments/${AZURE_DEPLOYMENT}/chat/completions?api-version=2024-10-21`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': AZURE_KEY
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 4096
    })
  });

  if (!res.ok) throw new Error(`Azure OpenAI error: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

function runPowerShell(cmd) {
  try {
    // Write command to temp script to avoid quoting/length issues
    const scriptPath = path.join(__dirname, 'temp_cmd.ps1');
    fs.writeFileSync(scriptPath, cmd);
    const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, {
      encoding: 'utf8', timeout: 60000, windowsHide: true
    });
    return { success: true, output: result.trim() };
  } catch (e) {
    return { success: false, output: e.stderr || e.message };
  }
}

async function runAnalysis() {
  const diagPrompt = `Analyze this Windows system telemetry and respond ONLY with valid JSON. No other text, no markdown fences.

If healthy, respond: {"status":"stable"}

If problems found, respond with a JSON array like these examples:
[{"issue":"WSearch service stopped","severity":"Warning","tier":"auto-fix","fix_command":"Start-Service WSearch","explanation":"Restarts Windows Search service","requires_reboot":false},
{"issue":"Shadow copy storage full on C:","severity":"Warning","tier":"auto-fix","fix_command":"vssadmin delete shadows /for=C: /all /quiet","explanation":"Deletes old shadow copies to free storage","requires_reboot":false},
{"issue":"Low disk space on C:","severity":"Critical","tier":"auto-fix","fix_command":"Remove-Item $env:TEMP/* -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item C:/Windows/Temp/* -Recurse -Force -ErrorAction SilentlyContinue; Clear-RecycleBin -Force -ErrorAction SilentlyContinue","explanation":"Clears temp files and recycle bin to free disk space","requires_reboot":false},
{"issue":"Windows Update error 0x80073D02","severity":"Critical","tier":"manual","fix_command":"Stop-Service wuauserv; Remove-Item $env:windir/SoftwareDistribution -Recurse -Force; Start-Service wuauserv","explanation":"Resets Windows Update cache and restarts service","requires_reboot":true},
{"issue":"TPM attestation failing","severity":"Critical","tier":"manual","fix_command":"","explanation":"TPM hardware issue - may need BIOS reset or vendor support","requires_reboot":false}]

Each item MUST have its OWN correct explanation matching its own issue.
Each item MUST include "requires_reboot": true or false indicating if a reboot is needed after the fix.

RULES:
- auto-fix tier: Restarting services, clearing caches, vssadmin cleanup. fix_command must be a real PowerShell command.
- manual tier: Reboots, Windows Update, TPM, disk space decisions. fix_command can be empty or a suggested command.
- IGNORE these services: edgeupdate, GoogleUpdater, WaaSMedicSvc, MapsBroker, MicrosoftEdgeElevationService, GamingServices, gpsvc, sppsvc, TrustedInstaller, AppXSvc, BITS, dosvc, Intel, SgrmBroker, UsoSvc, wuauserv, cryptsvc
- fix_command must be REAL PowerShell. Never put placeholder text.
- NEVER use backslashes in fix_command. Use forward slashes for paths (e.g. C:/Windows/Temp) or use environment variables (e.g. $env:windir).
- Only flag disk space as an issue if it is BELOW 10% free. 74% free is healthy, do NOT report it.

TELEMETRY:
${systemData}`;

  let issues = null;

  try {
    console.log('Querying Azure OpenAI...');
    const response = await askAI(diagPrompt);
    console.log(`AI response: ${response.slice(0, 200)}...`);

    if (response.includes('"status"') && response.includes('stable')) {
      console.log('System is stable. No action needed.');
      return;
    }

    // Parse JSON from response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      let jsonStr = jsonMatch[0].replace(/[\r\n]+\s*/g, ' ').replace(/,\s*]/g, ']');
      try {
        issues = JSON.parse(jsonStr);
      } catch (e1) {
        // Fix Windows paths: replace backslashes with forward slashes
        jsonStr = jsonStr.replace(/\\(?!["\\nrtbfu/])/g, '/');
        try {
          issues = JSON.parse(jsonStr);
        } catch (e2) {
          // Strip all backslashes as last resort
          jsonStr = jsonMatch[0].replace(/\\/g, '/').replace(/[\r\n]+\s*/g, ' ').replace(/,\s*]/g, ']');
          try {
            issues = JSON.parse(jsonStr);
          } catch (e3) {
            console.log(`JSON parse failed: ${e3.message}`);
            console.log(`Raw response (first 500): ${response.slice(0, 500)}`);
            await sendToDiscord('Alert', response.slice(0, 4000));
            return;
          }
        }
      }
    } else {
      console.log(`No JSON array found. Response starts with: ${response.slice(0, 100)}`);
      await sendToDiscord('Alert', response.slice(0, 4000));
      return;
    }
  } catch (e) {
    console.log(`AI error: ${e.message}`);
    console.log('Falling back to rule-based analysis...');
    const fallback = runFallbackAnalysis();
    if (fallback) { try { await sendToDiscord('Alert', fallback); } catch {} }
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
  const fixHistory = loadFixHistory();
  const validStarts = /^(Start-|Stop-|Restart-|Remove-|Clear-|Set-|Get-|New-|Invoke-|Reset-|vssadmin|net |ipconfig|sfc|DISM|shutdown|cleanmgr)/i;
  const ignoredServices = ['edgeupdate', 'googleupdater', 'waasmedicsvc', 'mapsbroker',
    'microsoftedgeelevationservice', 'gamingservices', 'gpsvc', 'sppsvc',
    'trustedinstaller', 'appxsvc', 'bits', 'dosvc', 'intel', 'sgrmbroker',
    'usosvc', 'wuauserv', 'cryptsvc', 'scard', 'scpolicysvc',
    'tieringengineservice', 'wbiosrvc', 'energy server', 'dcom', 'dcomlaunch'];

  for (const fix of autoFixes) {
    // Skip ignored services
    if (ignoredServices.some(s => fix.issue.toLowerCase().includes(s))) {
      console.log(`Skipping ignored service: ${fix.issue}`);
      continue;
    }
    if (!fix.fix_command || fix.fix_command.length < 5 || !validStarts.test(fix.fix_command.trim())) {
      console.log(`Skipping invalid command for: ${fix.issue}`);
      manualFixes.push(fix);
      continue;
    }

    const fixKey = fix.fix_command.trim().toLowerCase();
    if (fixHistory[fixKey] && fixHistory[fixKey] >= 2) {
      fix.issue += ' [RECURRING]';
      fix.severity = 'Critical';
      fix._recurring = true;
      manualFixes.push(fix);
      continue;
    }

    console.log(`Auto-fixing: ${fix.issue}`);
    console.log(`  Running: ${fix.fix_command}`);
    // Validate service exists if it's a Start/Restart-Service command
    const svcMatch = fix.fix_command.match(/^(Start|Restart)-Service\s+(.+)$/i);
    if (svcMatch) {
      const check = runPowerShell(`Get-Service '${svcMatch[2]}' -ErrorAction SilentlyContinue`);
      if (!check.success || !check.output) {
        console.log(`  Service '${svcMatch[2]}' not found, skipping.`);
        continue;
      }
    }
    const result = runPowerShell(fix.fix_command);
    // "already been started" means service is running - that's fine
    const effectiveSuccess = result.success || result.output.includes('already been started');
    fixResults.push({ issue: fix.issue, command: fix.fix_command, success: effectiveSuccess, output: result.output.slice(0, 200) });
    fixHistory[fixKey] = (fixHistory[fixKey] || 0) + 1;
  }

  saveFixHistory(fixHistory);

  // Step 2b: Deep analysis for recurring issues (single API call)
  const recurringIssues = manualFixes.filter(m => m._recurring);
  if (recurringIssues.length > 0) {
    console.log(`Requesting deep analysis for ${recurringIssues.length} recurring issue(s)...`);
    await new Promise(r => setTimeout(r, 3000));
    try {
      const issueList = recurringIssues.map(r => `- ${r.issue}: simple fix "${r.fix_command}" keeps failing`).join('\n');
      const deepPrompt = `These Windows issues keep recurring after simple fixes. For EACH issue, explain the root cause and provide an advanced PowerShell fix command.

Recurring issues:
${issueList}

Respond with ONLY a JSON array (no markdown):
[{"issue":"issue name","diagnosis":"root cause","fix_command":"advanced PowerShell fix"}]

RULES:
- fix_command must be real PowerShell
- NEVER use backslashes, use forward slashes or $env: variables
- Focus on WHY it keeps failing, not just restarting`;

      const deepResponse = await askAI(deepPrompt);
      const deepMatch = deepResponse.match(/\[[\s\S]*\]/);
      if (deepMatch) {
        const deepFixes = JSON.parse(deepMatch[0].replace(/[\r\n]+\s*/g, ' '));
        for (const df of deepFixes) {
          if (df.fix_command && validStarts.test(df.fix_command.trim())) {
            console.log(`  Deep fix for ${df.issue}: ${df.fix_command}`);
            const r = runPowerShell(df.fix_command);
            fixResults.push({
              issue: `${df.issue} [DEEP FIX]`,
              command: df.fix_command,
              success: r.success || r.output?.includes('already been started'),
              output: `Diagnosis: ${df.diagnosis || 'N/A'}`
            });
            // Remove from manual since we handled it
            const idx = manualFixes.findIndex(m => m.issue.includes(df.issue.replace(' [RECURRING]', '')));
            if (idx >= 0) manualFixes.splice(idx, 1);
          }
        }
      }
    } catch (e) {
      console.log(`Deep analysis failed: ${e.message}`);
    }
  }

  // Step 3: Schedule reboot if any fix requires it
  const needsReboot = issues.some(i => i.requires_reboot) || fixResults.some(r => r.success && issues.find(i => i.fix_command === r.command)?.requires_reboot);
  let rebootMsg = '';
  if (needsReboot) {
    // Calculate seconds until 2am
    const now = new Date();
    const rebootTime = new Date(now);
    rebootTime.setHours(2, 0, 0, 0);
    if (rebootTime <= now) rebootTime.setDate(rebootTime.getDate() + 1);
    const secondsUntil = Math.round((rebootTime - now) / 1000);
    
    console.log(`Scheduling reboot for 2:00 AM (${secondsUntil} seconds)...`);
    runPowerShell(`shutdown /r /t ${secondsUntil} /c "SysUpdate: Scheduled maintenance reboot at 2:00 AM"`);
    rebootMsg = `\n\n🔄 **Reboot scheduled for 2:00 AM** (fixes require restart)`;
  }

  // Step 4: Report to Discord
  let discordMsg = '';

  if (fixResults.length > 0) {
    discordMsg += '**Auto-Remediated:**\n';
    for (const r of fixResults) {
      discordMsg += `${r.success ? '\u2705' : '\u274c'} ${r.issue}\n`;
      discordMsg += `   \`${r.command}\`\n`;
      if (!r.success) discordMsg += `   Error: ${r.output}\n`;
    }
    discordMsg += '\n';
  }

  if (manualFixes.length > 0) {
    discordMsg += '**Requires Attention:**\n';
    for (const m of manualFixes) {
      // Skip ignored services in manual section too
      if (ignoredServices.some(s => m.issue.toLowerCase().includes(s))) continue;
      discordMsg += `\u26a0\ufe0f **${m.severity}:** ${m.issue}\n`;
      if (m.fix_command && m.fix_command.length > 4 && validStarts.test(m.fix_command.trim())) {
        discordMsg += `\`\`\`powershell\n${m.fix_command}\n\`\`\`\n`;
      }
      if (m.explanation && m.explanation.length > 5) {
        discordMsg += `   _${m.explanation}_\n`;
      }
    }
  }

  if (discordMsg) {
    discordMsg += rebootMsg;
    const color = manualFixes.some(m => m.severity === 'Critical') ? 16711680 : 16751360;
    try { await sendToDiscord(fixResults.length > 0 ? 'Auto-Fix Report' : 'Alert', discordMsg, color); }
    catch (e) { console.error(`Failed to send to Discord: ${e.message}`); }
  }
}

// Fallback rule-based analysis
function runFallbackAnalysis() {
  const issues = [];
  const pendingReboot = systemData.includes('Pending Reboot: True');
  const ignoredServices = ['WaaSMedicSvc', 'MapsBroker', 'wlidsvc', 'SCardSvr',
    'SCPolicySvc', 'sppsvc', 'TieringEngineService', 'WbioSrvc', 'perceptionsimulation',
    'edgeupdate', 'GoogleUpdater', 'MicrosoftEdgeElevationService', 'gpsvc',
    'TrustedInstaller', 'AppXSvc', 'BITS', 'dosvc', 'Intel', 'SgrmBroker', 'UsoSvc'];

  const diskMatches = systemData.match(/\w: [\d.]+GB free \/ [\d.]+GB total \([\d.]+% free\)/g);
  if (diskMatches) {
    for (const m of diskMatches) {
      const pct = parseFloat(m.match(/([\d.]+)% free/)[1]);
      if (pct < 5) issues.push({ severity: 'Critical', msg: `${m.split(' ')[0]} only ${pct}% free\n   **Fix:** \`cleanmgr /d C\`` });
      else if (pct < 10) issues.push({ severity: 'Warning', msg: `${m.split(' ')[0]} low disk (${pct}% free)\n   **Fix:** \`cleanmgr /d C\`` });
    }
  }

  const uptimeMatch = systemData.match(/Uptime: ([\d.]+) hours/);
  const uptimeHours = uptimeMatch ? parseFloat(uptimeMatch[1]) : 0;

  let failedServiceNames = [];
  const svcSection = systemData.split('=== FAILED AUTOMATIC SERVICES ===')[1]?.split('===')[0]?.trim();
  if (svcSection && svcSection !== 'None') {
    for (const line of svcSection.split('\n').filter(l => l.trim())) {
      const svcName = line.split(' ')[0];
      if (!ignoredServices.some(s => line.toLowerCase().includes(s.toLowerCase()))) {
        failedServiceNames.push(svcName);
      }
    }
  }

  const eventSection = systemData.split('=== RECENT CRITICAL/ERROR EVENTS ===')[1];
  let eventCount = 0, eventSources = new Set();
  if (eventSection && !eventSection.includes('No critical events')) {
    const lines = eventSection.trim().split('\n').filter(l => l.trim());
    eventCount = lines.length;
    for (const line of lines) {
      const m = line.match(/\[([^\]]+)\] ID:/);
      if (m) eventSources.add(m[1]);
    }
  }

  if (pendingReboot) {
    let msg = `Pending reboot detected`;
    if (uptimeHours > 72) msg += ` (${Math.round(uptimeHours / 24)} days)`;
    if (failedServiceNames.length > 0) msg += `. Services waiting: ${failedServiceNames.slice(0, 3).join(', ')}`;
    msg += '\n   **Fix:** `shutdown /r /t 60 /c "Scheduled reboot"`';
    issues.push({ severity: 'Warning', msg });
  } else {
    if (uptimeHours > 720) issues.push({ severity: 'Warning', msg: `Uptime: ${Math.round(uptimeHours/24)} days\n   **Fix:** \`shutdown /r /t 60\`` });
    if (failedServiceNames.length > 0) {
      const cmds = failedServiceNames.slice(0, 3).map(s => `Start-Service ${s}`).join('; ');
      issues.push({ severity: 'Warning', msg: `${failedServiceNames.length} service(s) stopped: ${failedServiceNames.slice(0, 5).join(', ')}\n   **Fix:** \`${cmds}\`` });
    }
    if (eventCount >= 15) {
      let fixes = '';
      if ([...eventSources].some(s => s.includes('Volsnap'))) fixes += '\n   **Fix:** `vssadmin delete shadows /for=C: /all /quiet`';
      if ([...eventSources].some(s => s.includes('WindowsUpdateClient'))) fixes += '\n   **Fix:** `Stop-Service wuauserv; Remove-Item $env:windir\\SoftwareDistribution -Recurse -Force; Start-Service wuauserv`';
      issues.push({ severity: 'Warning', msg: `${eventCount} errors from: ${[...eventSources].slice(0, 4).join(', ')}${fixes}` });
    }
  }

  if (issues.length === 0) { console.log('System stable.'); return null; }
  return issues.map(i => `**${i.severity}:** ${i.msg}`).join('\n');
}

runAnalysis().catch(err => { console.error('Fatal:', err); process.exit(1); });
