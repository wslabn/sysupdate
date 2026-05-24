import { LowSync } from 'lowdb';
import { JSONFileSync } from 'lowdb/node';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const adapter = new JSONFileSync(join(__dirname, 'data', 'machines.json'));
const db = new LowSync(adapter, { machines: {}, customers: {} });
db.read();
db.data.machines ??= {};
db.data.customers ??= {};
db.write();

export function upsertMachine(id, hostname, hardware, events, customerId) {
  db.read();
  db.data.machines[id] = {
    id, hostname, hardware, events,
    customer_id: customerId || null,
    last_seen: new Date().toISOString()
  };
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

export function getCustomers() {
  db.read();
  return Object.values(db.data.customers);
}

export function createCustomer(id, name) {
  db.read();
  db.data.customers[id] = { id, name };
  db.write();
  return db.data.customers[id];
}

export function deleteCustomer(id) {
  db.read();
  delete db.data.customers[id];
  // Unassign machines from this customer
  Object.values(db.data.machines).forEach(m => {
    if (m.customer_id === id) m.customer_id = null;
  });
  db.write();
}

export function assignMachine(machineId, customerId) {
  db.read();
  if (!db.data.machines[machineId]) return null;
  db.data.machines[machineId].customer_id = customerId || null;
  db.write();
  return db.data.machines[machineId];
}

export function deleteMachine(id) {
  db.read();
  delete db.data.machines[id];
  db.write();
}
