import 'dotenv/config';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { createServer } from 'https';
import { createServer as createHttpServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { WebSocketServer } from 'ws';
import { initDB, upsertMachine, getMachines, getMachine, getCustomers, createCustomer, updateCustomer, deleteCustomer, assignMachine, updateMachineNotes, addActivity, deleteMachine, queueCommand, popCommand, getAnalyses, getActiveAlerts, getAllActiveAlerts, resolveAlert } from './db.js';
import { analyzeCheckin } from './ai.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const ADMIN_HASH = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin', 10);
const AGENT_SECRET = process.env.AGENT_SECRET || 'change-me';

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

function agentAuth(req, res, next) {
  const secret = req.headers['x-agent-secret'] || req.query.secret;
  if (secret !== AGENT_SECRET) return res.status(401).json({ error: 'Invalid agent secret' });
  next();
}

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (!bcrypt.compareSync(password, ADMIN_HASH))
    return res.status(401).json({ error: 'Invalid password' });
  res.json({ token: jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '8h' }) });
});

// Agent check-in
app.post('/api/checkin', agentAuth, async (req, res) => {
  const { machineId, hostname, hardware, events, customerId, driverUpdate, windowsUpdate, disks, diagnostics, clientVersion } = req.body;
  if (!machineId || !hostname) return res.status(400).json({ error: 'Missing fields' });
  await upsertMachine(machineId, hostname, hardware, events, customerId, driverUpdate, windowsUpdate, disks, diagnostics, clientVersion);
  const command = await popCommand(machineId);

  // Trigger AI analysis in background (don't block check-in response)
  const machine = await getMachine(machineId);
  if (machine) analyzeCheckin(machine, agents).catch(e => console.error(`AI analysis error for ${machineId}:`, e.message));

  res.json({ ok: true, command });
});

// Machines
app.get('/api/machines', auth, async (req, res) => res.json(await getMachines()));
app.get('/api/machines/:id', auth, async (req, res) => {
  const m = await getMachine(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.json(m);
});
app.patch('/api/machines/:id', auth, async (req, res) => {
  const { customer_id, notes } = req.body;
  if (notes !== undefined) {
    const m = await updateMachineNotes(req.params.id, notes);
    if (!m) return res.status(404).json({ error: 'Not found' });
    return res.json(m);
  }
  const m = await assignMachine(req.params.id, customer_id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.json(m);
});
app.delete('/api/machines/:id', auth, async (req, res) => {
  await deleteMachine(req.params.id);
  res.json({ ok: true });
});

// Commands
app.post('/api/machines/:id/command', auth, async (req, res) => {
  const { command } = req.body;
  const validCommands = ['reboot', 'update-drivers', 'update-client', 'screenshot',
    'disk-cleanup', 'flush-dns', 'clear-browser-cache', 'sfc-scan', 'dism-repair',
    'restart-spooler', 'clear-temp', 'switch-env'];
  if (!validCommands.includes(command))
    return res.status(400).json({ error: 'Invalid command' });

  const wsCommands = ['update-client', 'screenshot', 'reboot', 'update-drivers',
    'disk-cleanup', 'flush-dns', 'clear-browser-cache', 'sfc-scan', 'dism-repair',
    'restart-spooler', 'clear-temp', 'switch-env'];

  if (wsCommands.includes(command)) {
    const agentWs = agents.get(req.params.id);
    if (!agentWs || agentWs.readyState !== 1)
      return res.status(404).json({ error: 'Agent offline' });
    let msg;
    if (command === 'switch-env') {
      const { server, secret } = req.body;
      msg = `__SWITCH_ENV__${JSON.stringify({ server, secret })}`;
    } else {
      msg = command === 'update-client' ? '__UPDATE__'
        : command === 'screenshot' ? '__SCREENSHOT__'
        : command === 'reboot' ? '__REBOOT__'
        : command === 'update-drivers' ? '__UPDATE_DRIVERS__'
        : `__TOOL__${command}`;
    }
    agentWs.send(msg);
    await addActivity(req.params.id, `Command: ${command}`);
    return res.json({ ok: true, command });
  }

  const result = await queueCommand(req.params.id, command);
  if (!result) return res.status(404).json({ error: 'Not found' });
  await addActivity(req.params.id, `Command: ${command}`);
  res.json({ ok: true, command });
});

// Customers
app.get('/api/customers', auth, async (req, res) => res.json(await getCustomers()));

// AI Analyses & Alerts
app.get('/api/machines/:id/analyses', auth, async (req, res) => res.json(await getAnalyses(req.params.id)));
app.get('/api/machines/:id/alerts', auth, async (req, res) => res.json(await getActiveAlerts(req.params.id)));
app.get('/api/alerts', auth, async (req, res) => res.json(await getAllActiveAlerts()));
app.post('/api/alerts/:id/resolve', auth, async (req, res) => { await resolveAlert(req.params.id); res.json({ ok: true }); });

app.post('/api/explain-event', auth, async (req, res) => {
  const { event, hostname } = req.body;
  if (!event) return res.status(400).json({ error: 'No event provided' });
  if (!process.env.AZURE_ENDPOINT || !process.env.AZURE_KEY) return res.status(500).json({ error: 'AI not configured' });

  try {
    const endpoint = process.env.AZURE_ENDPOINT.endsWith('/') ? process.env.AZURE_ENDPOINT : process.env.AZURE_ENDPOINT + '/';
    const deployment = process.env.AZURE_DEPLOYMENT || 'gpt-4.1-mini';
    const url = `${endpoint}openai/deployments/${deployment}/chat/completions?api-version=2024-10-21`;
    const prompt = `You are an MSP technician's assistant. A Windows machine (${hostname}) has this event log entry:

Source: ${event.source}
Event ID: ${event.id}
Time: ${event.time}
Message: ${event.message}

Provide:
1. A brief plain-English explanation of what this means
2. Whether it's concerning or can be ignored
3. If concerning, the recommended fix (with PowerShell commands if applicable)

Be concise and practical.`;

    const aiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': process.env.AZURE_KEY },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], temperature: 0.3, max_tokens: 1000 })
    });
    if (!aiRes.ok) return res.status(500).json({ error: 'AI request failed' });
    const data = await aiRes.json();
    res.json({ explanation: data.choices[0].message.content });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/machines/:id/diagnose', auth, async (req, res) => {
  const machine = await getMachine(req.params.id);
  if (!machine) return res.status(404).json({ error: 'Not found' });
  try {
    await analyzeCheckin(machine, agents, true);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/customers', auth, async (req, res) => {
  const { name, contact } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  res.status(201).json(await createCustomer(randomUUID(), name, contact));
});
app.patch('/api/customers/:id', auth, async (req, res) => {
  const c = await updateCustomer(req.params.id, req.body);
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json(c);
});
app.delete('/api/customers/:id', auth, async (req, res) => {
  await deleteCustomer(req.params.id);
  res.json({ ok: true });
});

// --- WebSocket ---
const certPath = join(__dirname, 'certs', 'cert.pem');
const keyPath = join(__dirname, 'certs', 'key.pem');
const useSSL = existsSync(certPath) && existsSync(keyPath);

const server = useSSL
  ? createServer({ cert: readFileSync(certPath), key: readFileSync(keyPath) }, app)
  : createHttpServer(app);

const wss = new WebSocketServer({ server });
const agents = new Map();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/ws/agent') {
    const machineId = url.searchParams.get('id');
    const secret = url.searchParams.get('secret');
    if (!machineId) return ws.close(4000, 'Missing id');
    if (secret !== AGENT_SECRET) return ws.close(4001, 'Invalid agent secret');
    agents.set(machineId, ws);
    ws.machineId = machineId;
    ws.on('close', () => agents.delete(machineId));
    ws.on('message', (data) => {
      if (ws.remoteWs && ws.remoteWs.readyState === 1) {
        ws.remoteWs.send(data);
      }
      if (ws.dashboardWs && ws.dashboardWs.readyState === 1 && !Buffer.isBuffer(data)) {
        ws.dashboardWs.send(data.toString());
      }
    });
  } else if (url.pathname === '/ws/terminal') {
    const tokenParam = url.searchParams.get('token');
    const machineId = url.searchParams.get('id');
    try { jwt.verify(tokenParam, JWT_SECRET); } catch { return ws.close(4001, 'Unauthorized'); }
    const agentWs = agents.get(machineId);
    if (!agentWs || agentWs.readyState !== 1) return ws.close(4002, 'Agent offline');
    agentWs.dashboardWs = ws;
    ws.on('message', (data) => {
      if (agentWs.readyState === 1) agentWs.send(data.toString());
    });
    ws.on('close', () => { agentWs.dashboardWs = null; });
    ws.send('\r\nConnected to ' + machineId + '\r\n');
  } else if (url.pathname === '/ws/remote') {
    const tokenParam = url.searchParams.get('token');
    const machineId = url.searchParams.get('id');
    try { jwt.verify(tokenParam, JWT_SECRET); } catch { return ws.close(4001, 'Unauthorized'); }
    const agentWs = agents.get(machineId);
    if (!agentWs || agentWs.readyState !== 1) return ws.close(4002, 'Agent offline');
    agentWs.remoteWs = ws;
    agentWs.send('__REMOTE_START__');
    ws.on('message', (data) => {
      if (agentWs.readyState === 1) agentWs.send(data);
    });
    ws.on('close', () => {
      agentWs.remoteWs = null;
      if (agentWs.readyState === 1) agentWs.send('__REMOTE_STOP__');
    });
  } else {
    ws.close(4003, 'Unknown path');
  }
});

// Start
const PORT = process.env.PORT || 3000;
initDB().then(() => {
  server.listen(PORT, () => console.log(`Server running on port ${PORT} (${useSSL ? 'HTTPS' : 'HTTP'})`));
}).catch(err => {
  console.error('Database init failed:', err);
  process.exit(1);
});
