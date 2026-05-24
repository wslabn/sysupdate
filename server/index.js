import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { upsertMachine, getMachines, getMachine } from './db.js';
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
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (!bcrypt.compareSync(password, ADMIN_HASH))
    return res.status(401).json({ error: 'Invalid password' });
  res.json({ token: jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '8h' }) });
});

app.post('/api/checkin', (req, res) => {
  const { machineId, hostname, hardware, events } = req.body;
  if (!machineId || !hostname) return res.status(400).json({ error: 'Missing fields' });
  upsertMachine(machineId, hostname, hardware, events);
  res.json({ ok: true });
});

app.get('/api/machines', auth, (req, res) => {
  res.json(getMachines());
});

app.get('/api/machines/:id', auth, (req, res) => {
  const machine = getMachine(req.params.id);
  if (!machine) return res.status(404).json({ error: 'Not found' });
  res.json(machine);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
