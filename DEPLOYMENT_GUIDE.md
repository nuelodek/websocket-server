# WebSocket Server Deployment Guide

## Quick Start (5 Minutes)

### 1. Install Dependencies
```bash
cd C:\Users\HP\websocket\websocket-server
npm install
```

### 2. Configure Environment
```bash
# Copy template
cp .env.example .env

# Edit .env with your values
# Required:
#   DB_HOST=your-database
#   DB_USERNAME=user
#   DB_PASSWORD=password
#   DB_DATABASE=gegeto_db
#   JWT_SECRET=your-random-secret-key
```

### 3. Create Logs Directory
```bash
mkdir -p logs
chmod 755 logs
```

### 4. Start Server
```bash
# Development
npm run dev

# Production
npm start

# With PM2 (recommended)
pm2 start server.js --name gegeto-ws
```

### 5. Verify Health
```bash
curl http://localhost:10000/health
```

---

## Detailed Setup Guide

### Prerequisites

- **Node.js 16+**: https://nodejs.org/
- **npm 8+**: Comes with Node.js
- **MySQL 5.7+**: Your database
- **Git** (optional): For version control
- **PM2** (optional): For process management

### Step 1: Initial Setup

**Windows (Automated):**
```bash
cd C:\Users\HP\websocket\websocket-server
setup.bat
```

**Linux/Mac (Automated):**
```bash
cd /path/to/websocket-server
chmod +x setup.sh
./setup.sh
```

**Manual:**
```bash
npm install
mkdir -p logs
cp .env.example .env
```

### Step 2: Configuration

Edit `.env` file with your production values:

```env
# ===== REQUIRED =====

# Database
DB_HOST=prod-db.example.com
DB_USERNAME=gegeto_user
DB_PASSWORD=strong-password-here
DB_DATABASE=gegeto_db

# JWT Secret (use strong random value)
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6

# ===== OPTIONAL =====

NODE_ENV=production
PORT=10000
WS_PORT=10000
LOG_LEVEL=info
REDIS_URL=redis://localhost:6379
```

**Generate Secure JWT Secret:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Step 3: Database Verification

Ensure these tables exist in your database:
```sql
-- Check tables
SHOW TABLES LIKE 'webstreams';
SHOW TABLES LIKE 'stream_access_tokens';
SHOW TABLES LIKE 'wallet_transactions';
SHOW TABLES LIKE 'wallets';
```

If tables are missing, run the migration:
```bash
# From gegetoapp directory
mysql -u root -p gegeto_db < sql/tables.sql
```

### Step 4: Start Server

#### Development (with auto-restart)
```bash
npm run dev
```

Expected output:
```
✅ WebSocket server running on port 10000
📊 Health check: http://localhost:10000/health
📈 Stats: http://localhost:10000/stats
```

#### Production (PM2 - Recommended)

**Install PM2 globally:**
```bash
npm install -g pm2
```

**Start server:**
```bash
pm2 start server.js --name gegeto-ws --instances max --exec-mode cluster
```

**Setup auto-start on reboot:**
```bash
pm2 save
pm2 startup
# Follow instructions to enable auto-start
```

**Monitor in real-time:**
```bash
pm2 monit gegeto-ws
```

**View logs:**
```bash
pm2 logs gegeto-ws
```

#### Systemd Service (Linux)

Create `/etc/systemd/system/gegeto-websocket.service`:
```ini
[Unit]
Description=Gegeto WebSocket Server
After=network.target mysql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/home/user/websocket-server
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment="NODE_ENV=production"

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable gegeto-websocket
sudo systemctl start gegeto-websocket
sudo systemctl status gegeto-websocket
```

View logs:
```bash
journalctl -u gegeto-websocket -f
```

### Step 5: Configure Reverse Proxy (Nginx)

Create `/etc/nginx/sites-available/gegeto-websocket`:
```nginx
upstream websocket_backend {
    server localhost:10000;
}

server {
    listen 443 ssl http2;
    server_name api.gegeto.com.ng;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # WebSocket configuration
    location /live-stream/ {
        proxy_pass http://websocket_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket-specific settings
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://websocket_backend;
        proxy_set_header Host $host;
    }

    # Statistics endpoint
    location /stats {
        proxy_pass http://websocket_backend;
        proxy_set_header Host $host;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name api.gegeto.com.ng;
    return 301 https://$server_name$request_uri;
}
```

Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/gegeto-websocket \
           /etc/nginx/sites-enabled/gegeto-websocket
sudo nginx -t
sudo systemctl restart nginx
```

### Step 6: SSL/TLS Certificates

#### Using Let's Encrypt (Recommended)
```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot certonly --standalone -d api.gegeto.com.ng
```

Update nginx config to use certificates from:
- `/etc/letsencrypt/live/api.gegeto.com.ng/fullchain.pem`
- `/etc/letsencrypt/live/api.gegeto.com.ng/privkey.pem`

Auto-renew:
```bash
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
```

### Step 7: Monitoring & Logging

**View real-time logs:**
```bash
# PM2 logs
pm2 logs gegeto-ws

# Tail logs
tail -f logs/combined.log

# Filter errors
grep "error" logs/error.log | tail -20
```

**Monitor metrics:**
```bash
# Every 5 seconds
watch -n 5 'curl -s http://localhost:10000/health | jq'

# With PM2
pm2 monit gegeto-ws
```

**Setup log rotation (Linux):**
```bash
sudo tee /etc/logrotate.d/gegeto-websocket > /dev/null <<'EOF'
/home/user/websocket-server/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    notifempty
    create 0644 www-data www-data
    sharedscripts
    postrotate
        systemctl reload gegeto-websocket > /dev/null 2>&1 || true
    endscript
}
EOF
```

### Step 8: Firewall Configuration

**Open port 10000 (if not behind proxy):**
```bash
# Ubuntu/Debian
sudo ufw allow 10000/tcp

# CentOS/RHEL
sudo firewall-cmd --permanent --add-port=10000/tcp
sudo firewall-cmd --reload
```

**If behind nginx proxy:**
- Keep port 10000 local-only
- Only expose HTTPS port 443

### Step 9: Load Balancing (Optional)

**For horizontal scaling with multiple instances:**

Start multiple instances on different ports:
```bash
pm2 start server.js --instances 3 --name gegeto-ws-1 --port 10001
pm2 start server.js --instances 3 --name gegeto-ws-2 --port 10002
pm2 start server.js --instances 3 --name gegeto-ws-3 --port 10003
```

Update nginx upstream:
```nginx
upstream websocket_backend {
    least_conn;  # Connection balancing
    server localhost:10001;
    server localhost:10002;
    server localhost:10003;
}
```

---

## Troubleshooting

### Issue: "Cannot connect to database"
```bash
# Check database connection
mysql -h DB_HOST -u DB_USERNAME -p DB_PASSWORD

# Verify .env has correct credentials
cat .env | grep DB_

# Check MySQL is running
sudo systemctl status mysql
```

### Issue: "JWT verification failed"
```bash
# Check JWT_SECRET is set
cat .env | grep JWT_SECRET

# Generate new secret if needed
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Issue: High memory usage
```bash
# Check for backpressure warnings
grep "Backpressure" logs/combined.log

# Monitor in real-time
pm2 monit gegeto-ws

# Reduce video bitrate or increase buffer limit
```

### Issue: "Port already in use"
```bash
# Find process on port 10000
lsof -i :10000

# Kill process (if it's old)
kill -9 <PID>

# Or use different port
WS_PORT=10001 npm start
```

### Issue: Connections rejected
Check logs for specific error codes:
- **4001**: Missing authentication token
- **4002**: Invalid JWT token
- **4003**: Stream not found
- **4004**: Stream not live
- **4005**: Payment verification failed
- **4006**: Unauthorized sender
- **4007**: Stream ended
- **4008**: Duplicate sender

```bash
grep "4005\|4006\|4008" logs/error.log
```

---

## Performance Tuning

### Database Pool Size
Edit `server.js` line ~54:
```javascript
const pool = mysql.createPool({
  connectionLimit: 20,  // Increase for high load
  // ...
});
```

### Heartbeat Interval
Edit `server.js` line ~132:
```javascript
const HEARTBEAT_INTERVAL = 20000; // 20s instead of 30s
```

### Backpressure Limit
Edit `server.js` line ~129:
```javascript
const BACKPRESSURE_LIMIT = 128 * 1024; // 128KB instead of 64KB
```

### Connection Timeout
Edit nginx config:
```nginx
proxy_connect_timeout 60s;
proxy_send_timeout 3600s;
proxy_read_timeout 3600s;
```

---

## Health Checks

### Kubernetes Liveness Probe
```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 10000
  initialDelaySeconds: 10
  periodSeconds: 10
```

### Monitoring with Grafana
```bash
# Query metrics
curl http://localhost:10000/stats | jq '.totalConnections'
```

---

## Backup & Recovery

### Backup Logs
```bash
tar -czf logs-backup-$(date +%Y%m%d).tar.gz logs/
mv logs-backup-*.tar.gz /backup/
```

### Database Backup
```bash
mysqldump -u root -p gegeto_db > gegeto_db_backup.sql
```

### Recover from Backup
```bash
mysql -u root -p gegeto_db < gegeto_db_backup.sql
```

---

## Security Checklist

- [ ] `.env` file has strong `JWT_SECRET`
- [ ] Database credentials are secure
- [ ] HTTPS/SSL enabled
- [ ] Firewall blocks unnecessary ports
- [ ] Regular log review for suspicious activity
- [ ] Backups automated
- [ ] Secrets not committed to git
- [ ] API auth tokens rotated regularly
- [ ] Database backups encrypted

---

## Contact & Support

For issues or questions, see:
- `README.md` - Server documentation
- `WEBSOCKET_SECURITY_GUIDE.md` - Security implementation details
- `SECURITY_FIXES_SUMMARY.md` - Backend security fixes
