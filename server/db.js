import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Initialize database tables
export async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS machines (
      id TEXT PRIMARY KEY,
      hostname TEXT,
      hardware JSONB DEFAULT '{}',
      events JSONB DEFAULT '[]',
      disks JSONB DEFAULT '[]',
      diagnostics JSONB DEFAULT '{}',
      customer_id TEXT,
      client_version TEXT,
      driver_update JSONB,
      windows_update JSONB,
      notes TEXT DEFAULT '',
      activity JSONB DEFAULT '[]',
      pending_command TEXT,
      last_seen TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contact JSONB DEFAULT '{}',
      notes TEXT DEFAULT ''
    );
  `);
}

export async function upsertMachine(id, hostname, hardware, events, customerId, driverUpdate, windowsUpdate, disks, diagnostics, clientVersion) {
  const existing = await getMachine(id);
  await pool.query(`
    INSERT INTO machines (id, hostname, hardware, events, customer_id, driver_update, windows_update, disks, diagnostics, client_version, last_seen)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
    ON CONFLICT (id) DO UPDATE SET
      hostname = COALESCE($2, machines.hostname),
      hardware = COALESCE($3, machines.hardware),
      events = COALESCE($4, machines.events),
      customer_id = COALESCE($5, machines.customer_id),
      driver_update = COALESCE($6, machines.driver_update),
      windows_update = COALESCE($7, machines.windows_update),
      disks = COALESCE($8, machines.disks),
      diagnostics = COALESCE($9, machines.diagnostics),
      client_version = COALESCE($10, machines.client_version),
      last_seen = NOW()
  `, [id, hostname, JSON.stringify(hardware || {}), JSON.stringify(events || []),
      customerId || existing?.customer_id || null,
      driverUpdate ? JSON.stringify(driverUpdate) : null,
      windowsUpdate ? JSON.stringify(windowsUpdate) : null,
      disks ? JSON.stringify(disks) : null,
      diagnostics ? JSON.stringify(diagnostics) : null,
      clientVersion || null]);
}

export async function getMachines() {
  const { rows } = await pool.query('SELECT * FROM machines ORDER BY last_seen DESC');
  return rows.map(formatMachine);
}

export async function getMachine(id) {
  const { rows } = await pool.query('SELECT * FROM machines WHERE id = $1', [id]);
  return rows[0] ? formatMachine(rows[0]) : null;
}

export async function assignMachine(machineId, customerId) {
  const { rows } = await pool.query(
    'UPDATE machines SET customer_id = $2 WHERE id = $1 RETURNING *', [machineId, customerId || null]);
  return rows[0] ? formatMachine(rows[0]) : null;
}

export async function updateMachineNotes(machineId, notes) {
  const { rows } = await pool.query(
    'UPDATE machines SET notes = $2 WHERE id = $1 RETURNING *', [machineId, notes]);
  return rows[0] ? formatMachine(rows[0]) : null;
}

export async function addActivity(machineId, action) {
  const machine = await getMachine(machineId);
  if (!machine) return;
  const activity = machine.activity || [];
  activity.unshift({ action, timestamp: new Date().toISOString() });
  await pool.query('UPDATE machines SET activity = $2 WHERE id = $1',
    [machineId, JSON.stringify(activity.slice(0, 50))]);
}

export async function deleteMachine(id) {
  await pool.query('DELETE FROM machines WHERE id = $1', [id]);
}

export async function queueCommand(machineId, command) {
  const { rowCount } = await pool.query(
    'UPDATE machines SET pending_command = $2 WHERE id = $1', [machineId, command]);
  return rowCount > 0 ? true : null;
}

export async function popCommand(machineId) {
  const { rows } = await pool.query(
    'UPDATE machines SET pending_command = NULL WHERE id = $1 AND pending_command IS NOT NULL RETURNING pending_command',
    [machineId]);
  return rows[0]?.pending_command || null;
}

export async function getCustomers() {
  const { rows } = await pool.query('SELECT * FROM customers ORDER BY name');
  return rows;
}

export async function createCustomer(id, name, contact) {
  const { rows } = await pool.query(
    'INSERT INTO customers (id, name, contact) VALUES ($1, $2, $3) RETURNING *',
    [id, name, JSON.stringify(contact || {})]);
  return rows[0];
}

export async function updateCustomer(id, updates) {
  const existing = await pool.query('SELECT * FROM customers WHERE id = $1', [id]);
  if (existing.rows.length === 0) return null;
  const { rows } = await pool.query(
    'UPDATE customers SET name = COALESCE($2, name), contact = COALESCE($3, contact), notes = COALESCE($4, notes) WHERE id = $1 RETURNING *',
    [id, updates.name || null, updates.contact ? JSON.stringify(updates.contact) : null, updates.notes || null]);
  return rows[0];
}

export async function deleteCustomer(id) {
  await pool.query('UPDATE machines SET customer_id = NULL WHERE customer_id = $1', [id]);
  await pool.query('DELETE FROM customers WHERE id = $1', [id]);
}

function formatMachine(row) {
  return {
    id: row.id,
    hostname: row.hostname,
    hardware: row.hardware,
    events: row.events,
    disks: row.disks,
    diagnostics: row.diagnostics,
    customer_id: row.customer_id,
    clientVersion: row.client_version,
    driverUpdate: row.driver_update,
    windowsUpdate: row.windows_update,
    notes: row.notes,
    activity: row.activity,
    pending_command: row.pending_command,
    last_seen: row.last_seen
  };
}
