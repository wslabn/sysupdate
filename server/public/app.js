const App = {
  token: localStorage.getItem('token'),
  customers: [],
  machines: [],
  currentCustomer: null,
  currentMachine: null,
  termWs: null,

  async init() {
    if (this.token) this.showMain();
  },

  // --- Auth ---
  async login(e) {
    e.preventDefault();
    const res = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: document.getElementById('password').value })
    });
    if (!res.ok) { document.getElementById('error').textContent = 'Invalid password'; return; }
    this.token = (await res.json()).token;
    localStorage.setItem('token', this.token);
    this.showMain();
  },

  logout() {
    localStorage.removeItem('token');
    this.token = null;
    document.getElementById('main').style.display = 'none';
    document.getElementById('login').style.display = 'flex';
  },

  // --- API ---
  async api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}`, ...opts.headers }
    });
    if (res.status === 401) { this.logout(); return null; }
    return res.json();
  },

  // --- Main ---
  async showMain() {
    document.getElementById('login').style.display = 'none';
    document.getElementById('main').style.display = 'flex';
    await this.loadData();
    this.showHome();
    setInterval(() => this.loadData(), 30000);
  },

  async loadData() {
    [this.customers, this.machines] = await Promise.all([
      this.api('/api/customers'),
      this.api('/api/machines')
    ]);
    this.renderSidebar();
  },

  renderSidebar() {
    const list = document.getElementById('customer-list');
    const unassigned = this.machines.filter(m => !m.customer_id).length;
    list.innerHTML = this.customers.map(c => {
      const count = this.machines.filter(m => m.customer_id === c.id).length;
      const active = this.currentCustomer?.id === c.id ? 'active' : '';
      return `<div class="sidebar-item ${active}" onclick="App.showCustomer('${c.id}')">${c.name} <span class="count">${count}</span></div>`;
    }).join('') +
    `<div class="sidebar-item ${!this.currentCustomer && !this.currentMachine ? 'active' : ''}" onclick="App.showUnassigned()">Unassigned <span class="count">${unassigned}</span></div>`;
  },

  // --- Views ---
  showView(name) {
    ['home', 'customer', 'machine'].forEach(v => {
      document.getElementById(`view-${v}`).style.display = v === name ? 'block' : 'none';
    });
  },

  async showHome() {
    this.currentCustomer = null;
    this.currentMachine = null;
    this.renderSidebar();
    this.showView('home');
    const online = this.machines.filter(m => (Date.now() - new Date(m.last_seen)) / 60000 < 70).length;
    const offline = this.machines.length - online;
    const alerts = await this.api('/api/alerts') || [];
    const alertsHtml = alerts.length ? alerts.slice(0, 10).map(a => `<div class="info-card" style="border-left-color:${a.severity==='Critical'?'#ef4444':'#facc15'};margin-bottom:.5rem;cursor:pointer" onclick="App.showMachine('${a.machine_id}')">
      <div style="display:flex;justify-content:space-between">
        <span style="font-size:.82rem"><strong>${a.hostname}</strong> — ${a.issue}</span>
        <span style="font-size:.7rem;color:#94a3b8">${new Date(a.created_at).toLocaleString()}</span>
      </div>
    </div>`).join('') : '<p class="muted">No active alerts</p>';
    document.getElementById('view-home').innerHTML = `
      <h2 style="color:#38bdf8;margin-bottom:1.5rem">Dashboard</h2>
      <div class="stats">
        <div class="stat-card"><div class="value">${this.machines.length}</div><div class="label">Total Machines</div></div>
        <div class="stat-card"><div class="value online">${online}</div><div class="label">Online</div></div>
        <div class="stat-card"><div class="value offline">${offline}</div><div class="label">Offline</div></div>
        <div class="stat-card"><div class="value" style="color:${alerts.length?'#ef4444':'#4ade80'}">${alerts.length}</div><div class="label">Active Alerts</div></div>
      </div>
      <div class="section-title">Active Alerts</div>
      ${alertsHtml}
      <div class="section-title" style="margin-top:1.5rem">Recent Machines</div>
      <div class="machine-list">${this.machines.slice(0, 10).map(m => this.machineCard(m)).join('')}</div>
    `;
  },

  showCustomer(id) {
    this.currentCustomer = this.customers.find(c => c.id === id);
    this.currentMachine = null;
    this.renderSidebar();
    this.showView('customer');
    const machines = this.machines.filter(m => m.customer_id === id);
    const c = this.currentCustomer;
    document.getElementById('view-customer').innerHTML = `
      <div class="customer-header">
        <div>
          <h2>${c.name}</h2>
          ${c.contact ? `<div class="customer-contact">${[c.contact.email, c.contact.phone, c.contact.address].filter(Boolean).join(' | ')}</div>` : ''}
        </div>
        <div><button class="btn-sm btn-secondary" onclick="App.editCustomer('${c.id}')">Edit</button>
        <button class="btn-sm btn-danger" onclick="App.deleteCustomer('${c.id}')">Delete</button></div>
      </div>
      <div class="section-title">Machines (${machines.length})</div>
      <div class="machine-list">${machines.length ? machines.map(m => this.machineCard(m)).join('') : '<p class="muted">No machines assigned</p>'}</div>
    `;
  },

  showUnassigned() {
    this.currentCustomer = null;
    this.currentMachine = null;
    this.renderSidebar();
    this.showView('customer');
    const machines = this.machines.filter(m => !m.customer_id);
    document.getElementById('view-customer').innerHTML = `
      <h2 style="color:#38bdf8;margin-bottom:1.5rem">Unassigned Machines</h2>
      <div class="machine-list">${machines.length ? machines.map(m => this.machineCard(m)).join('') : '<p class="muted">No unassigned machines</p>'}</div>
    `;
  },

  async showMachine(id) {
    const m = await this.api(`/api/machines/${id}`);
    if (!m) return;
    this.currentMachine = m;
    this.showView('machine');

    const customer = this.customers.find(c => c.id === m.customer_id);
    const breadcrumb = customer ? `<span class="breadcrumb" onclick="App.showCustomer('${customer.id}')">&larr; ${customer.name}</span>` : '<span class="breadcrumb" onclick="App.showUnassigned()">&larr; Unassigned</span>';

    document.getElementById('view-machine').innerHTML = `
      ${breadcrumb}
      <div class="detail-header">
        <div><h2>${m.hostname}</h2><div class="version">${m.clientVersion ? 'v' + m.clientVersion : 'Version unknown'}</div></div>
      </div>
      <div class="detail-actions">
        <button onclick="App.openTerminal()">Terminal</button>
        <button onclick="App.takeScreenshot()">Screenshot</button>
        <button onclick="App.sendCommand('update-drivers')">Update Drivers</button>
        <button onclick="App.sendCommand('update-client')">Push Update</button>
        <button onclick="App.switchEnv()">Switch Env</button>
        <button class="btn-danger" onclick="App.sendCommand('reboot')">Reboot</button>
        <button class="btn-danger" onclick="App.deleteMachine()">Delete</button>
      </div>
      <div style="margin-bottom:1rem">
        <label style="font-size:.8rem;color:#94a3b8">Customer</label>
        <select id="machine-customer" onchange="App.assignCustomer()">
          <option value="">— Unassigned —</option>
          ${this.customers.map(c => `<option value="${c.id}" ${m.customer_id === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
        </select>
      </div>
      <div class="tabs">
        <div class="tab active" onclick="App.switchTab('overview')">Overview</div>
        <div class="tab" onclick="App.switchTab('storage')">Storage</div>
        <div class="tab" onclick="App.switchTab('network')">Network</div>
        <div class="tab" onclick="App.switchTab('updates')">Updates</div>
        <div class="tab" onclick="App.switchTab('tools')">Tools</div>
        <div class="tab" onclick="App.switchTab('events')">Events</div>
        <div class="tab" onclick="App.switchTab('notes')">Notes</div>
        <div class="tab" onclick="App.switchTab('activity')">Activity</div>
        <div class="tab" onclick="App.switchTab('diagnostics')">Diagnostics</div>
        <div class="tab" onclick="App.switchTab('alerts')">Alerts</div>
      </div>
      <div class="tab-content active" id="tab-overview">${this.renderOverview(m)}</div>
      <div class="tab-content" id="tab-storage">${this.renderStorage(m)}</div>
      <div class="tab-content" id="tab-network">${this.renderNetwork(m)}</div>
      <div class="tab-content" id="tab-updates">${this.renderUpdates(m)}</div>
      <div class="tab-content" id="tab-tools">${this.renderTools()}</div>
      <div class="tab-content" id="tab-events">${this.renderEvents(m)}</div>
      <div class="tab-content" id="tab-notes">${this.renderNotes(m)}</div>
      <div class="tab-content" id="tab-activity">${this.renderActivity(m)}</div>
      <div class="tab-content" id="tab-diagnostics">${await this.renderDiagnosticsTab(m)}</div>
      <div class="tab-content" id="tab-alerts">${await this.renderAlertsTab(m)}</div>
    `;
  },

  // --- Render helpers ---
  machineCard(m) {
    const age = (Date.now() - new Date(m.last_seen)) / 60000;
    const status = age < 70 ? '<span class="online">● Online</span>' : age < 1440 ? '<span class="stale">● Stale</span>' : '<span class="offline">● Offline</span>';
    return `<div class="machine-card" onclick="App.showMachine('${m.id}')">
      <div><div class="name">${m.hostname}</div><div class="meta">${m.hardware?.model || ''} | ${m.hardware?.cpu || ''}</div></div>
      <div>${status}</div>
    </div>`;
  },

  renderOverview(m) {
    const hw = Object.entries(m.hardware || {}).map(([k,v]) => `<div class="hw-row"><span>${k}</span><span>${v}</span></div>`).join('');
    const diag = m.diagnostics;
    const diagHtml = diag ? `<div class="hw-grid">
      <div class="hw-row"><span>Uptime</span><span>${diag.uptime_hours}h</span></div>
      <div class="hw-row"><span>Last Boot</span><span>${diag.last_boot}</span></div>
      <div class="hw-row"><span>Pending Reboot</span><span style="color:${diag.pending_reboot ? '#ef4444' : '#4ade80'}">${diag.pending_reboot ? 'Yes' : 'No'}</span></div>
    </div>` : '<p class="muted">No data</p>';
    return `<div class="section-title">Hardware</div><div class="hw-grid">${hw}</div><div class="section-title">Diagnostics</div>${diagHtml}`;
  },

  renderStorage(m) {
    const disks = m.disks || [];
    return '<div class="section-title">Disk Space</div>' + (disks.length ? disks.map(d => `<div class="info-card" style="border-left-color:${d.percent_free < 10 ? '#ef4444' : d.percent_free < 25 ? '#facc15' : '#4ade80'}">
      <div style="font-size:.85rem;font-weight:bold">${d.drive}</div>
      <div style="font-size:.82rem;margin-top:.25rem">${d.free_gb} GB free / ${d.size_gb} GB (${d.percent_free}% free)</div>
      <div style="margin-top:.4rem;height:6px;background:#334155;border-radius:3px;overflow:hidden"><div style="height:100%;width:${100-d.percent_free}%;background:${d.percent_free<10?'#ef4444':d.percent_free<25?'#facc15':'#4ade80'}"></div></div>
    </div>`).join('') : '<p class="muted">No data</p>');
  },

  renderNetwork(m) {
    const nets = m.diagnostics?.network_adapters || [];
    return '<div class="section-title">Network Adapters</div>' + (nets.length ? nets.map(n => `<div class="info-card">
      <div style="font-size:.82rem;font-weight:bold">${n.name}</div>
      <div style="font-size:.8rem;color:#94a3b8;margin-top:.25rem">IP: ${n.ip || 'N/A'} &nbsp; MAC: ${n.mac || 'N/A'}</div>
    </div>`).join('') : '<p class="muted">No data</p>');
  },

  renderUpdates(m) {
    const wu = m.windowsUpdate;
    const wuHtml = wu ? `<div class="info-card" style="border-left-color:${wu.missing>0?'#facc15':'#4ade80'}"><div style="font-size:.85rem">${wu.missing>0?wu.missing+' pending':'Up to date'}</div><div style="font-size:.75rem;color:#94a3b8">Last: ${wu.last_install}</div></div>` : '<p class="muted">No data</p>';
    const du = m.driverUpdate;
    const duHtml = du ? `<div class="info-card" style="border-left-color:${du.status==='updated'?'#4ade80':'#38bdf8'}"><div style="font-size:.75rem;color:#94a3b8">${du.timestamp}</div><div style="font-size:.85rem">${du.status==='updated'?'Updated':'Current'}</div></div>` : '<p class="muted">No data</p>';
    return `<div class="section-title">Windows Updates</div>${wuHtml}<div class="section-title">Driver Updates</div>${duHtml}`;
  },

  renderTools() {
    return `
      <div class="section-title">Disk &amp; Cleanup</div>
      <div style="display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:1rem">
        <button onclick="App.runTool('disk-cleanup')">Full Disk Cleanup</button>
        <button onclick="App.runTool('clear-temp')">Clear Temp</button>
        <button onclick="App.runTool('clear-browser-cache')">Clear Browser Cache</button>
      </div>
      <div class="section-title">Network</div>
      <div style="display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:1rem">
        <button onclick="App.runTool('flush-dns')">Flush DNS</button>
      </div>
      <div class="section-title">System Repair</div>
      <div style="display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:1rem">
        <button onclick="App.runTool('sfc-scan')">SFC Scan</button>
        <button onclick="App.runTool('dism-repair')">DISM Repair</button>
      </div>
      <div class="section-title">Services</div>
      <div style="display:flex;flex-wrap:wrap;gap:.5rem">
        <button onclick="App.runTool('restart-spooler')">Restart Spooler</button>
      </div>`;
  },

  renderEvents(m) {
    const events = m.events || [];
    return '<div class="section-title">Recent System Errors</div>' + (events.length ? events.map(e => `<div class="event">
      <div class="evt-meta"><span>${e.time}</span><span>${e.source||''}</span><span>ID:${e.id||''}</span></div>
      <div class="evt-msg">${e.message||''}</div>
    </div>`).join('') : '<p class="muted">No events</p>');
  },

  renderNotes(m) {
    return `<div class="section-title">Machine Notes</div>
      <textarea id="machine-notes" style="width:100%;height:150px">${m.notes||''}</textarea>
      <button onclick="App.saveNotes()" style="margin-top:.5rem">Save Notes</button>`;
  },

  renderActivity(m) {
    const activity = m.activity || [];
    return '<div class="section-title">Activity Log</div>' + (activity.length ? activity.map(a => `<div class="info-card" style="border-left-color:#38bdf8">
      <div style="font-size:.75rem;color:#94a3b8">${new Date(a.timestamp).toLocaleString()}</div>
      <div style="font-size:.82rem;margin-top:.2rem">${a.action}</div>
    </div>`).join('') : '<p class="muted">No activity</p>');
  },

  async renderDiagnosticsTab(m) {
    const analyses = await this.api(`/api/machines/${m.id}/analyses`) || [];
    if (!analyses.length) return '<div class="section-title">AI Diagnostics</div><p class="muted">No analyses yet. Will run on next check-in if changes detected.</p>';
    return '<div class="section-title">AI Diagnostics</div>' + analyses.map(a => {
      const issues = a.ai_response?.issues || [];
      const actions = a.actions_taken || [];
      return `<div class="info-card" style="border-left-color:#38bdf8;margin-bottom:.75rem">
        <div style="display:flex;justify-content:space-between">
          <span style="font-size:.75rem;color:#94a3b8">${new Date(a.created_at).toLocaleString()}</span>
          <span style="font-size:.7rem;color:#94a3b8">${a.trigger_reason}</span>
        </div>
        ${a.ai_response?.status === 'stable' ? '<div style="color:#4ade80;font-size:.85rem;margin-top:.4rem">System Stable</div>' : ''}
        ${issues.length ? issues.map(i => `<div style="margin-top:.4rem;font-size:.82rem">
          <span style="color:${i.severity==='Critical'?'#ef4444':'#facc15'}">${i.severity}:</span> ${i.issue}
          ${i.fix_command ? `<div style="font-size:.75rem;color:#94a3b8;margin-top:.2rem"><code>${i.fix_command}</code></div>` : ''}
        </div>`).join('') : ''}
        ${actions.length ? '<div style="margin-top:.4rem;font-size:.75rem;color:#4ade80">Actions: ' + actions.map(a => a.action + ': ' + a.issue).join(', ') + '</div>' : ''}
      </div>`;
    }).join('');
  },

  async renderAlertsTab(m) {
    const alerts = await this.api(`/api/machines/${m.id}/alerts`) || [];
    if (!alerts.length) return '<div class="section-title">Active Alerts</div><p class="muted">No active alerts.</p>';
    return '<div class="section-title">Active Alerts</div>' + alerts.map(a => `<div class="info-card" style="border-left-color:${a.severity==='Critical'?'#ef4444':'#facc15'};margin-bottom:.5rem">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <span style="font-size:.82rem;font-weight:bold;color:${a.severity==='Critical'?'#ef4444':'#facc15'}">${a.severity}:</span>
          <span style="font-size:.82rem">${a.issue}</span>
        </div>
        <button class="btn-sm btn-secondary" onclick="App.resolveAlert(${a.id})">Resolve</button>
      </div>
      ${a.fix_command ? `<div style="margin-top:.4rem"><code style="font-size:.75rem;color:#94a3b8">${a.fix_command}</code></div>` : ''}
      <div style="font-size:.7rem;color:#94a3b8;margin-top:.3rem">Since: ${new Date(a.created_at).toLocaleString()}</div>
    </div>`).join('');
  },

  async resolveAlert(id) {
    await this.api(`/api/alerts/${id}/resolve`, { method: 'POST' });
    this.showMachine(this.currentMachine.id);
  },

  // --- Tabs ---
  switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelector(`.tab[onclick="App.switchTab('${name}')"]`).classList.add('active');
    document.getElementById(`tab-${name}`).classList.add('active');
  },

  // --- Actions ---
  async assignCustomer() {
    const val = document.getElementById('machine-customer').value || null;
    await this.api(`/api/machines/${this.currentMachine.id}`, { method: 'PATCH', body: JSON.stringify({ customer_id: val }) });
    await this.loadData();
  },

  async saveNotes() {
    const notes = document.getElementById('machine-notes').value;
    await this.api(`/api/machines/${this.currentMachine.id}`, { method: 'PATCH', body: JSON.stringify({ notes }) });
    alert('Notes saved.');
  },

  async sendCommand(cmd) {
    const labels = { reboot:'reboot', 'update-drivers':'run driver update', 'update-client':'push client update' };
    if (!confirm(`Send "${labels[cmd]||cmd}" to this machine?`)) return;
    const res = await this.api(`/api/machines/${this.currentMachine.id}/command`, { method:'POST', body:JSON.stringify({command:cmd}) });
    if (res?.error) alert(res.error);
    else alert(cmd==='update-client'?'Update pushed.':'Command sent.');
  },

  async runTool(tool) {
    if (!confirm(`Run "${tool}" on this machine?`)) return;
    this.openTerminal();
    await this.api(`/api/machines/${this.currentMachine.id}/command`, { method:'POST', body:JSON.stringify({command:tool}) });
  },

  async deleteMachine() {
    if (!confirm('Delete this machine?')) return;
    await this.api(`/api/machines/${this.currentMachine.id}`, { method:'DELETE' });
    await this.loadData();
    this.showHome();
  },

  async switchEnv() {
    const server = prompt('Enter server URL (e.g. wss://rmm.yourdomain.com):', 'wss://192.168.200.146:3000');
    if (!server) return;
    const secret = prompt('Enter agent secret for that server:', 'dev-agent-secret');
    if (!secret) return;
    if (!confirm(`Switch this machine to:\n${server}\n\nThe client will restart and connect to the new server.`)) return;
    const res = await this.api(`/api/machines/${this.currentMachine.id}/command`, {
      method: 'POST', body: JSON.stringify({ command: 'switch-env', server, secret })
    });
    if (res?.error) alert(res.error);
    else alert('Environment switch sent. Client will restart.');
  },

  async takeScreenshot() {
    this.openTerminal();
    await this.api(`/api/machines/${this.currentMachine.id}/command`, { method:'POST', body:JSON.stringify({command:'screenshot'}) });
  },

  // --- Customers ---
  openCustomerModal(id) {
    const c = id ? this.customers.find(x => x.id === id) : null;
    document.getElementById('customer-modal-title').textContent = c ? 'Edit Customer' : 'New Customer';
    document.getElementById('customer-edit-id').value = c?.id || '';
    document.getElementById('customer-name').value = c?.name || '';
    document.getElementById('customer-email').value = c?.contact?.email || '';
    document.getElementById('customer-phone').value = c?.contact?.phone || '';
    document.getElementById('customer-address').value = c?.contact?.address || '';
    document.getElementById('customer-notes').value = c?.notes || '';
    document.getElementById('customer-modal').classList.add('open');
  },

  editCustomer(id) { this.openCustomerModal(id); },

  closeModal() { document.getElementById('customer-modal').classList.remove('open'); },

  async saveCustomer() {
    const id = document.getElementById('customer-edit-id').value;
    const name = document.getElementById('customer-name').value.trim();
    if (!name) return;
    const contact = {
      email: document.getElementById('customer-email').value.trim(),
      phone: document.getElementById('customer-phone').value.trim(),
      address: document.getElementById('customer-address').value.trim()
    };
    const notes = document.getElementById('customer-notes').value;
    if (id) {
      await this.api(`/api/customers/${id}`, { method:'PATCH', body:JSON.stringify({name,contact,notes}) });
    } else {
      await this.api('/api/customers', { method:'POST', body:JSON.stringify({name,contact}) });
    }
    this.closeModal();
    await this.loadData();
  },

  async deleteCustomer(id) {
    if (!confirm('Delete this customer? Machines will become unassigned.')) return;
    await this.api(`/api/customers/${id}`, { method:'DELETE' });
    await this.loadData();
    this.showHome();
  },

  // --- Terminal ---
  openTerminal() {
    if (!this.currentMachine) return;
    this.closeTerminal();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws/terminal?token=${this.token}&id=${this.currentMachine.id}`;
    this.termWs = new WebSocket(url);
    document.getElementById('terminal-output').textContent = '';
    document.getElementById('terminal-title').textContent = `Terminal — ${this.currentMachine.hostname}`;
    document.getElementById('terminal-container').classList.add('open');
    document.getElementById('term-cmd').focus();

    this.termWs.onmessage = (e) => {
      const data = e.data;
      if (data.startsWith('__SCREENSHOT_DATA__')) {
        document.getElementById('screenshot-img').src = 'data:image/png;base64,' + data.replace('__SCREENSHOT_DATA__','');
        document.getElementById('screenshot-modal').classList.add('open');
      } else {
        const out = document.getElementById('terminal-output');
        out.textContent += data;
        out.scrollTop = out.scrollHeight;
      }
    };
    this.termWs.onclose = () => {
      document.getElementById('terminal-output').textContent += '\n[Disconnected]\n';
    };
  },

  sendTermCmd() {
    const input = document.getElementById('term-cmd');
    if (!this.termWs || this.termWs.readyState !== 1 || !input.value) return;
    document.getElementById('terminal-output').textContent += `PS> ${input.value}\n`;
    this.termWs.send(input.value);
    input.value = '';
  },

  closeTerminal() {
    if (this.termWs) { this.termWs.close(); this.termWs = null; }
    document.getElementById('terminal-container').classList.remove('open');
  }
};

App.init();
