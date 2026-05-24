import { LowSync } from 'lowdb';
import { JSONFileSync } from 'lowdb/node';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const adapter = new JSONFileSync(join(__dirname, 'data', 'machines.json'));
const db = new LowSync(adapter, { machines: {} });

export function upsertMachine(id, hostname, hardware, events) {
  db.read();
  db.data.machines[id] = { id, hostname, hardware, events, last_seen: new Date().toISOString() };
  db.write();
}

export function getMachines() {
  db.read();
  return Object.values(db.data.machines).sort((a, b) => b.last_seen.localeCompare(a.last_seen));
}

export function getMachine(id) {
  db.read();
  return db.data.machines[id] || null;
}
