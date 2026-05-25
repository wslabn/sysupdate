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

export function upsertMachine(id, hostname, hardware, events, customerId, driverUpdate, windowsUpdate, disks, diagnostics, clientVersion) {
  db.read();
  const existing = db.data.machines[id] || {};
  db.data.machines[id] = {
    ...existing,
    id, hostname, hardware, events,
    customer_id: customerId || existing.customer_id || null,
    last_seen: new Date().toISOString(),
    ...(driverUpdate  && { driverUpdate }),
    ...(windowsUpdate && { windowsUpdate }),
    ...(disks && { disks }),
    ...(diagnostics && { diagnostics }),
    ...(clientVersion && { clientVersion }),
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

export function createCustomer(id, name, contact) {
  db.read();
  db.data.customers[id] = { id, name, contact: contact || {}, notes: '' };
  db.write();
  return db.data.customers[id];
}

export function updateCustomer(id, updates) {
  db.read();
  if (!db.data.customers[id]) return null;
  Object.assign(db.data.customers[id], updates);
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

export function updateMachineNotes(machineId, notes) {
  db.read();
  if (!db.data.machines[machineId]) return null;
  db.data.machines[machineId].notes = notes;
  db.write();
  return db.data.machines[machineId];
}

export function addActivity(machineId, action) {
  db.read();
  if (!db.data.machines[machineId]) return;
  if (!db.data.machines[machineId].activity) db.data.machines[machineId].activity = [];
  db.data.machines[machineId].activity.unshift({
    action,
    timestamp: new Date().toISOString()
  });
  // Keep last 50 entries
  db.data.machines[machineId].activity = db.data.machines[machineId].activity.slice(0, 50);
  db.write();
}

export function deleteMachine(id) {
  db.read();
  delete db.data.machines[id];
  db.write();
}

export function queueCommand(machineId, command) {
  db.read();
  if (!db.data.machines[machineId]) return null;
  db.data.machines[machineId].pending_command = command;
  db.write();
}

export function popCommand(machineId) {
  db.read();
  const cmd = db.data.machines[machineId]?.pending_command || null;
  if (cmd) {
    db.data.machines[machineId].pending_command = null;
    db.write();
  }
  return cmd;
}
