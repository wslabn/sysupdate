import 'dotenv/config';
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { createServer } from 'https';
import { createServer as createHttpServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { WebSocketServer } from 'ws';
import { initDB, upsertMachine, getMachines, getMachine, getCustomers, createCustomer, updateCustomer, deleteCustomer, assignMachine, updateMachineNotes, addActivity, deleteMachine, queueCommand, popCommand } from './db.js';
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
    'restart-spooler', 'clear-temp'];
  if (!validCommands.includes(command))
    return res.status(400).json({ error: 'Invalid command' });

  const wsCommands = ['update-client', 'screenshot', 'reboot', 'update-drivers',
    'disk-cleanup', 'flush-dns', 'clear-browser-cache', 'sfc-scan', 'dism-repair',
    'restart-spooler', 'clear-temp'];

  if (wsCommands.includes(command)) {
    const agentWs = agents.get(req.params.id);
    if (!agentWs || agentWs.readyState !== 1)
      return res.status(404).json({ error: 'Agent offline' });
    const msg = command === 'update-client' ? '__UPDATE__'
      : command === 'screenshot' ? '__SCREENSHOT__'
      : command === 'reboot' ? '__REBOOT__'
      : command === 'update-drivers' ? '__UPDATE_DRIVERS__'
      : `__TOOL__${command}`;
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
      if (ws.dashboardWs && ws.dashboardWs.readyState === 1) {
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
