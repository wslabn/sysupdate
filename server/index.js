import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { upsertMachine, getMachines, getMachine, getCustomers, createCustomer, deleteCustomer, assignMachine, deleteMachine } from './db.js';
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

// Agent check-in
app.post('/api/checkin', (req, res) => {
  const { machineId, hostname, hardware, events, customerId } = req.body;
  if (!machineId || !hostname) return res.status(400).json({ error: 'Missing fields' });
  upsertMachine(machineId, hostname, hardware, events, customerId);
  res.json({ ok: true });
});

// Machines
app.get('/api/machines', auth, (req, res) => res.json(getMachines()));
app.get('/api/machines/:id', auth, (req, res) => {
  const m = getMachine(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.json(m);
});
app.patch('/api/machines/:id', auth, (req, res) => {
  const m = assignMachine(req.params.id, req.body.customer_id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.json(m);
});
app.delete('/api/machines/:id', auth, (req, res) => {
  deleteMachine(req.params.id);
  res.json({ ok: true });
});

// Customers
app.get('/api/customers', auth, (req, res) => res.json(getCustomers()));
app.post('/api/customers', auth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  res.status(201).json(createCustomer(randomUUID(), name));
});
app.delete('/api/customers/:id', auth, (req, res) => {
  deleteCustomer(req.params.id);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
