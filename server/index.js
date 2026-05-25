import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { upsertMachine, getMachines, getMachine, getCustomers, createCustomer, updateCustomer, deleteCustomer, assignMachine, updateMachineNotes, addActivity, deleteMachine, queueCommand, popCommand } from './db.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const ADMIN_HASH = process.env.ADMIN_HASH || bcrypt.hashSync('admin', 10);

function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (!bcrypt.compareSync(password, ADMIN_HASH))
    return res.status(401).json({ error: 'Invalid password' });
  res.json({ token: jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '8h' }) });
});

// Agent check-in — also returns pending command
app.post('/api/checkin', (req, res) => {
  const { machineId, hostname, hardware, events, customerId, driverUpdate, windowsUpdate, disks, diagnostics, clientVersion } = req.body;
  if (!machineId || !hostname) return res.status(400).json({ error: 'Missing fields' });
  upsertMachine(machineId, hostname, hardware, events, customerId, driverUpdate, windowsUpdate, disks, diagnostics, clientVersion);
  const command = popCommand(machineId);
  res.json({ ok: true, command });
});

// Machines
app.get('/api/machines', auth, (req, res) => res.json(getMachines()));
app.get('/api/machines/:id', auth, (req, res) => {
  const m = getMachine(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.json(m);
});
app.patch('/api/machines/:id', auth, (req, res) => {
  const { customer_id, notes } = req.body;
  if (notes !== undefined) {
    const m = updateMachineNotes(req.params.id, notes);
    if (!m) return res.status(404).json({ error: 'Not found' });
    return res.json(m);
  }
  const m = assignMachine(req.params.id, customer_id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.json(m);
});
app.delete('/api/machines/:id', auth, (req, res) => {
  deleteMachine(req.params.id);
  res.json({ ok: true });
});

// Queue a command for a machine
app.post('/api/machines/:id/command', auth, (req, res) => {
  const { command } = req.body;
  if (!['reboot', 'update-drivers', 'update-client'].includes(command))
    return res.status(400).json({ error: 'Invalid command' });

  // update-client is sent directly via WebSocket
  if (command === 'update-client') {
    const agentWs = agents.get(req.params.id);
    if (!agentWs || agentWs.readyState !== 1)
      return res.status(404).json({ error: 'Agent offline' });
    agentWs.send('__UPDATE__');
    addActivity(req.params.id, 'Pushed client update');
    return res.json({ ok: true, command });
  }

  const result = queueCommand(req.params.id, command);
  if (!result) return res.status(404).json({ error: 'Not found' });
  addActivity(req.params.id, `Command: ${command}`);
  res.json({ ok: true, command });
});

// Customers
app.get('/api/customers', auth, (req, res) => res.json(getCustomers()));
app.post('/api/customers', auth, (req, res) => {
  const { name, contact } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  res.status(201).json(createCustomer(randomUUID(), name, contact));
});
app.patch('/api/customers/:id', auth, (req, res) => {
  const c = updateCustomer(req.params.id, req.body);
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json(c);
});
app.delete('/api/customers/:id', auth, (req, res) => {
  deleteCustomer(req.params.id);
  res.json({ ok: true });
});

// --- WebSocket remote shell relay ---
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Connected agents keyed by machineId
const agents = new Map();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/ws/agent') {
    // Agent identifies itself with ?id=machineId
    const machineId = url.searchParams.get('id');
    if (!machineId) return ws.close(4000, 'Missing id');
    agents.set(machineId, ws);
    ws.machineId = machineId;
    ws.on('close', () => agents.delete(machineId));
    ws.on('message', (data) => {
      // Forward agent output to any linked dashboard session
      if (ws.dashboardWs && ws.dashboardWs.readyState === 1) {
        ws.dashboardWs.send(data.toString());
      }
    });
  } else if (url.pathname === '/ws/terminal') {
    // Dashboard terminal — requires token & machineId
    const tokenParam = url.searchParams.get('token');
    const machineId = url.searchParams.get('id');
    try { jwt.verify(tokenParam, JWT_SECRET); } catch { return ws.close(4001, 'Unauthorized'); }
    const agentWs = agents.get(machineId);
    if (!agentWs || agentWs.readyState !== 1) return ws.close(4002, 'Agent offline');
    // Link dashboard <-> agent
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
