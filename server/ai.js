import crypto from 'crypto';
import { getState, saveState, saveAnalysis, getRecentAnalysis, createAlert, markAlertDiscordSent } from './db.js';

const AZURE_ENDPOINT = process.env.AZURE_ENDPOINT;
const AZURE_KEY = process.env.AZURE_KEY;
const AZURE_DEPLOYMENT = process.env.AZURE_DEPLOYMENT || 'gpt-4.1-mini';
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

const IGNORED_SERVICES = ['edgeupdate', 'googleupdater', 'waasmedicsvc', 'mapsbroker',
  'microsoftedgeelevationservice', 'gamingservices', 'gpsvc', 'sppsvc',
  'trustedinstaller', 'appxsvc', 'bits', 'dosvc', 'intel', 'sgrmbroker',
  'usosvc', 'wuauserv', 'cryptsvc', 'scard', 'scpolicysvc',
  'tieringengineservice', 'wbiosrvc', 'energy server', 'dcom', 'dcomlaunch'];

export async function analyzeCheckin(machine, agents, force = false) {
  if (!AZURE_ENDPOINT || !AZURE_KEY) { console.log(`[AI] Skipped ${machine.hostname}: no API key configured`); return; }

  const changes = await detectChanges(machine);
  if (!changes && !force) { console.log(`[AI] Skipped ${machine.hostname}: no changes detected`); return; }

  // Check if we already analyzed recently
  if (!force) {
    const recent = await getRecentAnalysis(machine.id, 24);
    if (recent && changes?.severity !== 'critical') { console.log(`[AI] Skipped ${machine.hostname}: already analyzed today`); return; }
  }

  const reason = force ? 'manual-trigger' : (changes?.reason || 'unknown');
  console.log(`[AI] Analyzing ${machine.hostname} (reason: ${reason}, ${changes?.newEvents || 0} new events)...`);

  // Run AI analysis
  const result = await runAIAnalysis(machine, changes || { reason: 'manual-trigger', newEvents: 0, newDiskAlerts: [], newCrashDumps: [] });
  if (!result) { console.log(`[AI] ${machine.hostname}: no result from AI`); return; }

  console.log(`[AI] ${machine.hostname}: ${result.status === 'stable' ? 'STABLE' : (result.issues?.length || 0) + ' issues found'}`);

  // Process results
  await processAIResult(machine, result, changes, agents);
}

async function detectChanges(machine) {
  const prevState = await getState(machine.id);
  const events = machine.events || [];
  const disks = machine.disks || [];
  const diagnostics = machine.diagnostics || {};

  // Hash current events
  const eventHashes = events.map(e => crypto.createHash('md5').update(`${e.source}${e.id}${e.time}`).digest('hex'));

  // Current stopped services (filtered)
  const stoppedServices = []; // Will come from diagnostics if we add it

  // Disk alerts (below 10%)
  const diskAlerts = disks.filter(d => d.percent_free < 10).map(d => d.drive);

  // Crash dumps (from events mentioning BugCheck or WER)
  const crashDumps = events.filter(e => e.source?.includes('WER') || e.message?.includes('BugCheck')).map(e => e.time);

  // Save current state
  const currentState = { eventHashes, stoppedServices, diskAlerts, crashDumps };
  await saveState(machine.id, currentState);

  if (!prevState) return { reason: 'first-checkin', severity: 'normal', ...currentState };

  // Compare
  const newEvents = eventHashes.filter(h => !prevState.event_hashes?.includes(h));
  const newDiskAlerts = diskAlerts.filter(d => !prevState.disk_alerts?.includes(d));
  const newCrashDumps = crashDumps.filter(d => !prevState.crash_dumps?.includes(d));

  if (newEvents.length === 0 && newDiskAlerts.length === 0 && newCrashDumps.length === 0) {
    return null; // No changes
  }

  const severity = newCrashDumps.length > 0 || newDiskAlerts.length > 0 ? 'critical' : 'normal';
  return { reason: 'changes-detected', severity, newEvents: newEvents.length, newDiskAlerts, newCrashDumps };
}

async function runAIAnalysis(machine, changes) {
  const telemetry = buildTelemetrySummary(machine);

  const prompt = `Analyze this Windows system telemetry. Respond ONLY with valid JSON, no markdown.

If healthy: {"status":"stable"}

If problems: respond with a JSON array:
[{"issue":"description","severity":"Critical|Warning|Info","tier":"auto-fix|manual","fix_command":"PowerShell command or empty","explanation":"what fix does","requires_reboot":false}]

RULES:
- auto-fix: Restart services, clear temp/cache, vssadmin cleanup. Must be real PowerShell.
- manual: Reboots, Windows Update, TPM, disk decisions.
- IGNORE these services: ${IGNORED_SERVICES.join(', ')}
- NEVER use backslashes. Use forward slashes or $env: variables.
- Only flag disk space below 10% free.
- fix_command must be REAL PowerShell or empty string.

CHANGE CONTEXT: ${changes.reason} (${changes.newEvents || 0} new events, ${changes.newDiskAlerts?.length || 0} new disk alerts, ${changes.newCrashDumps?.length || 0} new crashes)

TELEMETRY:
${telemetry}`;

  try {
    const endpoint = AZURE_ENDPOINT.endsWith('/') ? AZURE_ENDPOINT : AZURE_ENDPOINT + '/';
    const url = `${endpoint}openai/deployments/${AZURE_DEPLOYMENT}/chat/completions?api-version=2024-10-21`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': AZURE_KEY },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_tokens: 4096 })
    });

    if (!res.ok) { console.error(`AI error: ${res.status}`); return null; }
    const data = await res.json();
    const response = data.choices[0].message.content;

    if (response.includes('"status"') && response.includes('stable')) return { status: 'stable' };

    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      let jsonStr = jsonMatch[0].replace(/[\r\n]+\s*/g, ' ').replace(/,\s*]/g, ']');
      try { return { issues: JSON.parse(jsonStr) }; }
      catch { jsonStr = jsonStr.replace(/\\/g, '/'); return { issues: JSON.parse(jsonStr) }; }
    }
    return null;
  } catch (e) {
    console.error(`AI analysis error: ${e.message}`);
    return null;
  }
}

async function processAIResult(machine, result, changes, agents) {
  if (result.status === 'stable') {
    await saveAnalysis(machine.id, changes.reason, 'System stable', result, []);
    return;
  }

  const issues = result.issues || [];
  const actionsTaken = [];
  const agentWs = agents.get(machine.id);

  for (const issue of issues) {
    // Skip ignored
    if (IGNORED_SERVICES.some(s => issue.issue?.toLowerCase().includes(s))) continue;

    if (issue.tier === 'auto-fix' && issue.fix_command && agentWs?.readyState === 1) {
      // Send auto-fix via WebSocket
      const validStarts = /^(Start-|Stop-|Restart-|Remove-|Clear-|Set-|Get-|New-|Invoke-|Reset-|vssadmin|net |ipconfig|sfc|DISM|shutdown|cleanmgr)/i;
      if (validStarts.test(issue.fix_command.trim())) {
        agentWs.send(`__TOOL_EXEC__${issue.fix_command}`);
        actionsTaken.push({ action: 'auto-fix', issue: issue.issue, command: issue.fix_command });
      }
    }

    if (issue.tier === 'manual' || issue.severity === 'Critical') {
      // Create alert
      const alert = await createAlert(machine.id, issue.issue, issue.severity, issue.fix_command);

      // Discord notification for new critical alerts
      if (alert && !alert.discord_sent && DISCORD_WEBHOOK && issue.severity === 'Critical') {
        await sendDiscord(machine.hostname, issue);
        await markAlertDiscordSent(alert.id);
      }
    }
  }

  await saveAnalysis(machine.id, changes.reason, buildTelemetrySummary(machine).slice(0, 500), result, actionsTaken);
}

function buildTelemetrySummary(machine) {
  const parts = [];
  parts.push(`Host: ${machine.hostname}`);
  if (machine.diagnostics?.uptime_hours) parts.push(`Uptime: ${machine.diagnostics.uptime_hours}h`);
  if (machine.diagnostics?.pending_reboot) parts.push('Pending reboot: Yes');
  if (machine.disks?.length) {
    parts.push('Disks: ' + machine.disks.map(d => `${d.drive} ${d.percent_free}% free`).join(', '));
  }
  if (machine.events?.length) {
    parts.push('Events:\n' + machine.events.slice(0, 10).map(e => {
      const msg = (e.message || '').slice(0, 100);
      return `[${e.time}] [${e.source}] ID:${e.id} ${msg}`;
    }).join('\n'));
  }
  return parts.join('\n').slice(0, 3000);
}

async function sendDiscord(hostname, issue) {
  if (!DISCORD_WEBHOOK) return;
  const payload = {
    embeds: [{
      title: `Alert: ${hostname}`,
      color: 16711680,
      description: `**${issue.severity}:** ${issue.issue}\n${issue.fix_command ? `\`\`\`powershell\n${issue.fix_command}\n\`\`\`` : ''}\n${issue.explanation || ''}`,
      timestamp: new Date().toISOString(),
      footer: { text: 'SysUpdate AI Monitor' }
    }]
  };
  try {
    await fetch(DISCORD_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  } catch {}
}
