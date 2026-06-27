# Azure Deployment Guide

Deploy SysUpdate server to Azure with HTTPS and a custom domain.

## Option A: Azure App Service (Recommended)

### Step 1: Create Azure Resources

1. Go to https://portal.azure.com
2. Search "App Services" → **+ Create**
   - Resource Group: `sysupdate-prod` (create new)
   - Name: `sysupdate` (this becomes `sysupdate.azurewebsites.net`)
   - Runtime: **Node 22 LTS**
   - Region: **East US** (or closest to your clients)
   - Plan: **Basic B1** ($13/month)
   - Click **Create**

3. Search "Azure Database for PostgreSQL" → **+ Create** → **Flexible Server**
   - Resource Group: `sysupdate-prod`
   - Server name: `sysupdate-db`
   - Region: **East US** (same as app)
   - Workload: **Development** (cheapest)
   - Compute: **Burstable B1ms** (~$12/month)
   - Admin username: `sysadmin`
   - Password: (choose a strong password)
   - Click **Create**

### Step 2: Configure Database

1. Go to your PostgreSQL server → **Networking**
2. Check **"Allow public access from any Azure service"**
3. Add your current IP to firewall rules (for testing)
4. Go to **Databases** → **+ Add** → name it `sysupdate`
5. Note your connection string:
   ```
   postgresql://sysadmin:YOUR_PASSWORD@sysupdate-db.postgres.database.azure.com:5432/sysupdate?sslmode=require
   ```

### Step 3: Configure App Service

1. Go to your App Service → **Configuration** → **Application Settings**
2. Add these environment variables:
   ```
   PORT = 8080
   DATABASE_URL = postgresql://sysadmin:YOUR_PASSWORD@sysupdate-db.postgres.database.azure.com:5432/sysupdate?sslmode=require
   JWT_SECRET = (generate: openssl rand -hex 32)
   ADMIN_PASSWORD = (your strong password)
   AGENT_SECRET = (generate: openssl rand -hex 16)
   ```
3. Go to **Configuration** → **General Settings**
   - Web sockets: **On**
   - Startup Command: `npm start`

### Step 4: Deploy from GitHub

1. Go to App Service → **Deployment Center**
2. Source: **GitHub**
3. Sign in to GitHub, select:
   - Organization: `wslabn`
   - Repository: `sysupdate`
   - Branch: `main`
4. It will auto-create a GitHub Actions workflow
5. **Important:** Set the app to deploy from the `server/` folder:
   - Go to **Configuration** → **Application Settings**
   - Add: `PROJECT = server`
   - Or edit the generated workflow to: `working-directory: server`

### Step 5: Custom Domain + HTTPS

1. Go to App Service → **Custom domains**
2. Click **+ Add custom domain**
3. Enter your domain (e.g. `rmm.yourdomain.com`)
4. It will show you a **CNAME** record to add:
   ```
   Type: CNAME
   Name: rmm
   Value: sysupdate.azurewebsites.net
   ```
5. Add this record at your domain registrar/DNS provider
6. Wait for DNS propagation (few minutes)
7. Click **Validate** → **Add**
8. Go to **Certificates** → **+ Add** → **App Service Managed Certificate** (free)
9. Bind the certificate to your domain
10. Enable **HTTPS Only** in **TLS/SSL settings**

### Step 6: Update Clients

Update the client to point to the new server. Edit `client/agent.js`:
```javascript
const SERVER_URL = process.env.SYSUPDATE_SERVER || 'wss://rmm.yourdomain.com';
const AGENT_SECRET = process.env.SYSUPDATE_SECRET || 'YOUR_PRODUCTION_AGENT_SECRET';
```

Build a new client version and push to all machines.

### Step 7: Remove Self-Signed Cert Workaround

Once using a real domain with Azure's managed cert, remove `rejectUnauthorized: false` from the client — it's no longer needed and is more secure without it.

---

## Option B: Azure VM (Simpler, more control)

### Step 1: Create VM

1. Azure Portal → **Virtual Machines** → **+ Create**
   - Resource Group: `sysupdate-prod`
   - Name: `sysupdate-vm`
   - Image: **Ubuntu 24.04 LTS**
   - Size: **B2s** ($15/month — 2 vCPU, 4GB RAM)
   - Authentication: SSH key (download it)
   - Inbound ports: **22 (SSH), 80, 443**
   - Click **Create**

### Step 2: Set Up the VM

SSH in:
```bash
ssh -i your-key.pem azureuser@YOUR_VM_IP
```

Install everything:
```bash
# Node.js
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# PostgreSQL
sudo apt install -y postgresql
sudo -u postgres psql -c "CREATE USER sysupdate WITH PASSWORD 'YOUR_STRONG_PASSWORD';"
sudo -u postgres psql -c "CREATE DATABASE sysupdate OWNER sysupdate;"

# Nginx (reverse proxy + HTTPS)
sudo apt install -y nginx certbot python3-certbot-nginx

# Clone repo
git clone https://github.com/wslabn/sysupdate.git
cd sysupdate/server
npm install
```

### Step 3: Configure

```bash
cp .env.example .env
nano .env
```

Set:
```
PORT=3000
DATABASE_URL=postgresql://sysupdate:YOUR_STRONG_PASSWORD@localhost:5432/sysupdate
JWT_SECRET=GENERATE_A_RANDOM_64_CHAR_STRING
ADMIN_PASSWORD=YOUR_STRONG_ADMIN_PASSWORD
AGENT_SECRET=GENERATE_A_RANDOM_32_CHAR_STRING
```

### Step 4: Nginx Reverse Proxy

```bash
sudo nano /etc/nginx/sites-available/sysupdate
```

Paste:
```nginx
server {
    listen 80;
    server_name rmm.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Enable and restart:
```bash
sudo ln -s /etc/nginx/sites-available/sysupdate /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Step 5: HTTPS with Let's Encrypt

Point your domain to the VM's IP first (A record), then:
```bash
sudo certbot --nginx -d rmm.yourdomain.com
```

Auto-renews. Free forever.

### Step 6: Run as Service

```bash
sudo nano /etc/systemd/system/sysupdate.service
```

Paste:
```ini
[Unit]
Description=SysUpdate Server
After=network.target postgresql.service

[Service]
Type=simple
User=azureuser
WorkingDirectory=/home/azureuser/sysupdate/server
ExecStart=/usr/bin/node index.js
Restart=always
EnvironmentFile=/home/azureuser/sysupdate/server/.env

[Install]
WantedBy=multi-user.target
```

Enable:
```bash
sudo systemctl enable sysupdate
sudo systemctl start sysupdate
```

### Step 7: Update Clients

Same as Option A Step 6 — point clients to `wss://rmm.yourdomain.com`.

---

## Cost Summary

| Component | Option A (App Service) | Option B (VM) |
|-----------|----------------------|---------------|
| Compute | $13/month | $15/month |
| Database | $12/month | included |
| SSL | Free | Free (Let's Encrypt) |
| Domain | Your existing domain | Your existing domain |
| **Total** | **~$25/month** | **~$15/month** |

## After Deployment Checklist

- [ ] Dashboard loads at `https://rmm.yourdomain.com`
- [ ] Can log in with admin password
- [ ] WebSocket connections work (machines show online)
- [ ] Remote terminal works
- [ ] Push update works
- [ ] Screenshot works
- [ ] All client machines updated to new server URL
- [ ] Remove `rejectUnauthorized: false` from client
- [ ] Old dev server can be kept for testing
