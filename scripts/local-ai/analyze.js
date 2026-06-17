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
const GROQ_API_KEY = config.groq_api_key;
const GROQ_MODEL = config.model || 'llama-3.1-8b-instant';

if (!DISCORD_WEBHOOK || DISCORD_WEBHOOK.includes('PASTE_YOUR')) {
  console.error('ERROR: Set discord_webhook in config.json');
  process.exit(1);
}
if (!GROQ_API_KEY) {
  console.error('ERROR: Set groq_api_key in config.json');
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
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 4096
    })
  });

  if (!res.ok) throw new Error(`Groq error: ${res.status} ${res.statusText}`);
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
[{"issue":"WSearch service stopped","severity":"Warning","tier":"auto-fix","fix_command":"Start-Service WSearch","explanation":"Restarts Windows Search service"},
{"issue":"Shadow copy storage full on C:","severity":"Warning","tier":"auto-fix","fix_command":"vssadmin delete shadows /for=C: /all /quiet","explanation":"Deletes old shadow copies to free storage"},
{"issue":"Low disk space on C:","severity":"Critical","tier":"auto-fix","fix_command":"Remove-Item $env:TEMP/* -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item C:/Windows/Temp/* -Recurse -Force -ErrorAction SilentlyContinue; Clear-RecycleBin -Force -ErrorAction SilentlyContinue","explanation":"Clears temp files and recycle bin to free disk space"},
{"issue":"Windows Update error 0x80073D02","severity":"Critical","tier":"manual","fix_command":"Stop-Service wuauserv; Remove-Item $env:windir/SoftwareDistribution -Recurse -Force; Start-Service wuauserv","explanation":"Resets Windows Update cache and restarts service"},
{"issue":"TPM attestation failing","severity":"Critical","tier":"manual","fix_command":"","explanation":"TPM hardware issue - may need BIOS reset or vendor support"}]

Each item MUST have its OWN correct explanation matching its own issue.

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
    console.log('Querying Groq AI...');
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
      console.log(`Recurring issue: ${fix.issue} - requesting deeper analysis...`);
      await new Promise(r => setTimeout(r, 5000)); // Rate limit delay
      try {
        const deepPrompt = `A Windows service keeps failing after being restarted multiple times. Investigate the root cause and provide an advanced fix.

Issue: ${fix.issue}
Simple fix that keeps failing: ${fix.fix_command}
System telemetry:
${systemData}

Respond with ONLY valid JSON (no markdown):
{"diagnosis":"root cause explanation","fix_commands":["cmd1","cmd2"],"explanation":"what these commands do"}

RULES:
- fix_commands must be real PowerShell commands
- NEVER use backslashes, use forward slashes or $env: variables
- Focus on WHY the service keeps stopping, not just restarting it
- Consider: corrupted index, dependency issues, disk space, permissions`;
        const deepResponse = await askAI(deepPrompt);
        const deepMatch = deepResponse.match(/\{[\s\S]*\}/);
        if (deepMatch) {
          const deep = JSON.parse(deepMatch[0].replace(/[\r\n]+\s*/g, ' '));
          // Run the advanced fix commands
          let deepResults = [];
          for (const cmd of (deep.fix_commands || [])) {
            if (validStarts.test(cmd.trim())) {
              console.log(`  Deep fix: ${cmd}`);
              const r = runPowerShell(cmd);
              deepResults.push(`${r.success ? '\u2705' : '\u274c'} \`${cmd}\``);
            }
          }
          fixResults.push({
            issue: `${fix.issue} [DEEP FIX]`,
            command: deep.fix_commands?.join('; ') || fix.fix_command,
            success: true,
            output: `Diagnosis: ${deep.diagnosis || 'N/A'}\n${deepResults.join('\n')}`
          });
          fixHistory[fixKey] = 0; // Reset counter after deep fix
          continue;
        }
      } catch (e) {
        console.log(`Deep analysis failed: ${e.message}`);
      }
      // If deep analysis failed, escalate to manual
      fix.issue += ' [RECURRING]';
      fix.severity = 'Critical';
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

  // Step 3: Report to Discord
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
