# Gegeto WebSocket Server - Secure Live Streaming

## Overview

This is a production-grade WebSocket server for the Gegeto live streaming platform with comprehensive security features including:

- ✅ JWT authentication & token verification
- ✅ Server-side payment verification
- ✅ Direct database lookups (replaces HTTP calls)
- ✅ Heartbeat/ping mechanism (prevents dead connections)
- ✅ Backpressure handling (prevents OOM crashes)
- ✅ Comprehensive error logging (Winston)
- ✅ Stream state consistency (database polling)
- ✅ Health check & statistics endpoints
- ✅ Graceful shutdown handling

## Prerequisites

- Node.js 16+
- npm or yarn
- MySQL database with Gegeto schema
- `.env` file with configuration

## Installation

1. **Install dependencies:**
```bash
npm install
```

2. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. **Create logs directory:**
```bash
mkdir -p logs
```

## Configuration

Edit `.env` with your settings:

```env
# Database
DB_HOST=localhost
DB_USERNAME=root
DB_PASSWORD=password
DB_DATABASE=gegeto_db

# JWT (use a strong, random secret)
JWT_SECRET=your-very-long-random-secret-key-here

# Server
PORT=10000
NODE_ENV=production
```

## Running the Server

### Development Mode
```bash
npm run dev
```
This uses `nodemon` for auto-restart on file changes.

### Production Mode
```bash
npm start
```

### With PM2 (Recommended for Production)
```bash
npm install -g pm2

# Start the server
pm2 start server.js --name gegeto-ws --instances max --exec-mode cluster

# View logs
pm2 logs gegeto-ws

# Monitor
pm2 monit
```

## Health Checks

### Get Server Status
```bash
curl http://localhost:10000/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2025-05-16T10:30:45.123Z",
  "clients": 45,
  "activeStreams": 3,
  "uptime": 3600.5
}
```

### Get Detailed Statistics
```bash
curl http://localhost:10000/stats
```

Response:
```json
{
  "timestamp": "2025-05-16T10:30:45.123Z",
  "totalConnections": 45,
  "totalStreams": 3,
  "streams": [
    {
      "hashmetric": "abc123...",
      "streamId": 1,
      "sender": "connected",
      "viewers": 15,
      "uptime": 300000
    }
  ]
}
```

## API Connection Format

### Frontend WebSocket Connection

**Viewer Connection:**
```javascript
const authToken = localStorage.getItem('auth_token');
const accessToken = await fetch('/api/verify-stream-access.php', {
  method: 'POST',
  body: JSON.stringify({ hashedmetric, auth_token })
}).then(r => r.json()).then(d => d.access_token);

const ws = new WebSocket(
  `wss://api.gegeto.com.ng/live-stream/${hashmetric}` +
  `?role=viewer&token=${authToken}&access_token=${accessToken}`
);
```

**Sender Connection:**
```javascript
const authToken = localStorage.getItem('auth_token');

const ws = new WebSocket(
  `wss://api.gegeto.com.ng/live-stream/${hashmetric}` +
  `?role=sender&token=${authToken}`
);
```

## Message Protocol

### WebSocket Message Types

#### Viewer → Sender Messages

**Viewer Ready Signal:**
```json
{
  "type": "viewer-ready"
}
```

#### Sender → Viewers (Binary)
- Raw video chunks in WebM format with VP8/Opus codecs
- Variable size chunks (typically 50KB-200KB)

#### Server Broadcasts

**Sender Ready:**
```json
{
  "type": "sender_ready",
  "timestamp": "2025-05-16T10:30:45.123Z"
}
```

**Viewer Joined:**
```json
{
  "type": "viewer_joined",
  "viewerCount": 5,
  "timestamp": "2025-05-16T10:30:45.123Z"
}
```

**Viewer Left:**
```json
{
  "type": "viewer_left",
  "viewerCount": 4,
  "timestamp": "2025-05-16T10:30:45.123Z"
}
```

**Stream Ended:**
```json
{
  "type": "stream_ended",
  "reason": "Sender disconnected",
  "timestamp": "2025-05-16T10:30:45.123Z"
}
```

**Stream Status Changed:**
```json
{
  "type": "stream_status_changed",
  "status": "completed",
  "timestamp": "2025-05-16T10:30:45.123Z"
}
```

## Security Features

### 1. JWT Token Verification
- Every connection must include valid `token` parameter
- Token is verified using `JWT_SECRET`
- Invalid tokens are rejected with code 4002

### 2. Payment Verification
- Paid streams require `access_token` parameter
- Access tokens are validated against `stream_access_tokens` table
- Tokens expire after 1 hour
- Expired tokens are rejected with code 4005

### 3. Sender Authorization
- Only stream creator can connect as sender
- Sender ID must match `webstreams.streamer_id`
- Unauthorized senders are rejected with code 4006

### 4. Stream Validation
- Stream must exist and have valid `hashedmetric`
- Stream must be `ongoing` or `active`
- Inactive streams are rejected with code 4004

### 5. Duplicate Sender Prevention
- Only one sender allowed per stream
- Second sender is rejected with code 4008

### 6. Backpressure Handling
- Monitors client buffer size (64KB limit)
- Drops messages if client buffer is full
- Prevents OOM crashes under heavy load

### 7. Heartbeat Mechanism
- Server sends ping every 30 seconds
- Dead connections are automatically terminated
- Clients must respond with pong

### 8. Stream State Consistency
- Polls database every 5 seconds
- Detects streams that have been marked completed/cancelled
- Closes connections for inactive streams

## Logging

Logs are stored in the `./logs` directory:

- **error.log** - All errors and critical events
- **combined.log** - All events (info, warn, error)

### Log Example

```json
{
  "level": "info",
  "message": "Viewer connected",
  "userId": "user123",
  "hashmetric": "abc123...",
  "totalViewers": 5,
  "timestamp": "2025-05-16T10:30:45.123Z",
  "service": "gegeto-websocket"
}
```

### View Live Logs

```bash
# With PM2
pm2 logs gegeto-ws

# With tail
tail -f logs/combined.log

# With grep for errors
grep "error" logs/error.log
```

## Performance Optimization

### Connection Limits
- Default: 10 concurrent database connections
- Adjust `connectionLimit` in `server.js` based on load

### Message Rates
- Video chunks sent at ~100ms intervals
- Server broadcasts without buffering (drops on full buffer)
- Recommended: 2-4 Mbps per viewer

### Backpressure Tuning
- Default buffer limit: 64KB
- Increase if you see backpressure warnings in logs
- Decrease if OOM errors occur

### Heartbeat Interval
- Default: 30 seconds
- Shorter = more overhead, faster dead detection
- Longer = less overhead, slower dead detection

## Troubleshooting

### Connection Rejected: "Missing authentication token"
- Frontend must include `token` parameter
- Check that localStorage has valid auth token

### Connection Rejected: "Payment verification failed"
- Viewer must have called `verify-stream-access.php` first
- Check that `access_token` is valid and not expired

### Connection Rejected: "Unauthorized sender"
- Sender ID must match stream creator
- Verify `decoded.id` matches `stream.streamer_id`

### "Backpressure detected, dropping message"
- Some viewers have slow connections
- Consider optimizing video encoding
- Increase buffer limit if acceptable
- Monitor quality of experience trade-offs

### High Memory Usage
- Check logs for backpressure warnings
- Reduce video bitrate
- Check for connection leaks (dead connections not closing)
- Verify heartbeat is terminating dead clients

### Database Connection Errors
- Verify database is running
- Check connection credentials in `.env`
- Increase `connectionLimit` if pool exhausted
- Monitor active connections: `mysql> SHOW PROCESSLIST;`

## Monitoring

### Key Metrics to Track

1. **Active Connections**
   - `/health` → `clients`
   - Alert if trending high (> 1000)

2. **Active Streams**
   - `/stats` → `totalStreams`
   - Track streaming usage patterns

3. **Viewer Distribution**
   - `/stats` → `streams[].viewers`
   - Identify load hotspots

4. **Error Rate**
   - Parse `logs/error.log`
   - Alert if rate > 1%

5. **Message Backpressure**
   - Count "Backpressure detected" warnings
   - Indicates video quality issues

### Recommended Alerting

```bash
# CPU > 80%
# Memory > 85%
# Error rate > 1% per minute
# Backpressure events > 10 per minute
# Connections stuck for > 5 minutes
```

## Scaling

### Horizontal Scaling (Multiple Instances)
```bash
pm2 start server.js -i max --name gegeto-ws
```

### Load Balancing
Use nginx to balance across multiple instances:

```nginx
upstream websocket {
    server localhost:10000;
    server localhost:10001;
    server localhost:10002;
}

server {
    listen 443 ssl;
    server_name api.gegeto.com.ng;

    location /live-stream/ {
        proxy_pass http://websocket;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_buffering off;
    }
}
```

## Deployment Checklist

- [ ] Update `.env` with production credentials
- [ ] Set `NODE_ENV=production`
- [ ] Use strong `JWT_SECRET`
- [ ] Enable SSL/TLS certificates
- [ ] Create `logs` directory with proper permissions
- [ ] Set up PM2 to auto-start on reboot
- [ ] Configure log rotation
- [ ] Set up monitoring & alerting
- [ ] Test health check endpoint
- [ ] Load test before going live
- [ ] Set up graceful reload process
- [ ] Configure firewall to allow port 10000
- [ ] Update frontend to use correct WebSocket URL
- [ ] Run database migrations

## Support

For issues or questions, refer to:
- Main documentation: `WEBSOCKET_SECURITY_GUIDE.md`
- Security fixes: `SECURITY_FIXES_SUMMARY.md`
- PHP backend: `/api/verify-stream-access.php`
