/**
 * Gegeto WebSocket Server - Secure Live Streaming
 * 
 * Security Features:
 * - JWT token verification
 * - Server-side payment verification
 * - Access token validation
 * - Direct database lookups
 * - Heartbeat/ping mechanism
 * - Backpressure handling
 * - Comprehensive error logging
 */

const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const bodyParser = require('body-parser');
const { MessagingResponse } = require('twilio').twiml;
const url = require('url');
const mysql = require('mysql2/promise');
const jwt = require('jsonwebtoken');
const winston = require('winston');
require('dotenv').config();

// ============================================
// LOGGING SETUP
// ============================================
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  defaultMeta: { service: 'gegeto-websocket' },
  transports: [
    new winston.transports.File({ 
      filename: './logs/error.log', 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.File({ 
      filename: './logs/combined.log',
      maxsize: 5242880,
      maxFiles: 5
    })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

// ============================================
// DATABASE CONNECTION POOL
// ============================================
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelayMs: 0
});

// ============================================
// EXPRESS SETUP
// ============================================
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static(__dirname));

// ============================================
// STREAM MANAGEMENT
// ============================================
const streams = new Map(); // hashmetric => { streamId, sender, viewers: Map<userId => ws>, createdAt }
const activeStreamIds = new Set(); // Track active streams for efficient polling

// Configuration
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const BACKPRESSURE_LIMIT = 64 * 1024; // 64KB
const TOKEN_EXPIRY = 3600; // 1 hour in seconds
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-key';

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Verify JWT token
 */
async function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    logger.error('JWT verification failed', { error: error.message });
    return null;
  }
}

/**
 * Get stream details from database
 */
async function getStreamByHashmetric(hashmetric) {
  const connection = await pool.getConnection();
  try {
    const [streams] = await connection.query(
      'SELECT id, streamer_id, stream_price, stream_status, hashedmetric FROM webstreams WHERE hashedmetric = ?',
      [hashmetric]
    );
    return streams.length > 0 ? streams[0] : null;
  } catch (error) {
    logger.error('Database error fetching stream', { error: error.message, hashmetric });
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Verify access token
 */
async function verifyAccessToken(accessToken, streamId) {
  const connection = await pool.getConnection();
  try {
    const [tokens] = await connection.query(
      'SELECT id, viewer_id FROM stream_access_tokens WHERE access_token = ? AND stream_id = ? AND expires_at > NOW()',
      [accessToken, streamId]
    );
    return tokens.length > 0 ? tokens[0] : null;
  } catch (error) {
    logger.error('Database error verifying access token', { error: error.message });
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Broadcast message to all viewers in a stream
 */
function broadcastToStream(hashmetric, message, excludeWs = null) {
  const stream = streams.get(hashmetric);
  if (!stream) return;

  const messageStr = JSON.stringify(message);
  let failedCount = 0;

  stream.viewers.forEach((ws, userId) => {
    if (ws === excludeWs || ws.readyState !== WebSocket.OPEN) return;

    // Backpressure check
    if (ws.bufferedAmount > BACKPRESSURE_LIMIT) {
      logger.warn('Backpressure detected, dropping message', { userId, bufferedAmount: ws.bufferedAmount });
      return;
    }

    ws.send(messageStr, (err) => {
      if (err) {
        logger.error('Send error', { userId, error: err.message });
        failedCount++;
      }
    });
  });

  return failedCount;
}

/**
 * Broadcast binary data (video) to all viewers
 */
function broadcastBinaryToStream(hashmetric, data, excludeWs = null) {
  const stream = streams.get(hashmetric);
  if (!stream) return;

  let failedCount = 0;

  stream.viewers.forEach((ws, userId) => {
    if (ws === excludeWs || ws.readyState !== WebSocket.OPEN) return;

    // Backpressure check - drop if queue full
    if (ws.bufferedAmount > BACKPRESSURE_LIMIT) {
      logger.warn('Backpressure on binary data, dropping chunk', { userId, bufferedAmount: ws.bufferedAmount });
      return; // Skip this viewer to prevent OOM
    }

    ws.send(data, (err) => {
      if (err) {
        logger.error('Binary send error', { userId, error: err.message });
        failedCount++;
      }
    });
  });

  return failedCount;
}

/**
 * Close all connections for a stream
 */
function closeStreamConnections(hashmetric, reason = 'Stream ended') {
  const stream = streams.get(hashmetric);
  if (!stream) return;

  // Close sender
  if (stream.sender && stream.sender.readyState === WebSocket.OPEN) {
    stream.sender.close(4007, reason);
  }

  // Close viewers
  stream.viewers.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(4007, reason);
    }
  });

  streams.delete(hashmetric);
  activeStreamIds.delete(stream.streamId);
  logger.info('Stream connections closed', { hashmetric, reason });
}

// ============================================
// WEBSOCKET UPGRADE HANDLER
// ============================================
server.on('upgrade', async (req, socket, head) => {
  try {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const hashmetric = pathname.split('/')[2];
    const role = parsedUrl.query.role || 'viewer';
    const authToken = parsedUrl.query.token;
    const accessToken = parsedUrl.query.access_token;

    // Validate inputs
    if (!hashmetric || !['sender', 'viewer'].includes(role)) {
      socket.destroy();
      logger.warn('Invalid upgrade parameters', { hashmetric, role });
      return;
    }

    if (!authToken) {
      socket.destroy();
      logger.warn('Missing authentication token', { hashmetric, role });
      return;
    }

    // Verify JWT token
    const decoded = await verifyToken(authToken);
    if (!decoded) {
      socket.destroy();
      logger.warn('Invalid JWT token', { hashmetric, role });
      return;
    }

    // Get stream details from database
    const stream = await getStreamByHashmetric(hashmetric);
    if (!stream) {
      socket.destroy();
      logger.warn('Stream not found', { hashmetric });
      return;
    }

    // Validate stream is live
    if (stream.stream_status !== 'ongoing' && stream.stream_status !== 'active') {
      socket.destroy();
      logger.warn('Stream not live', { hashmetric, status: stream.stream_status });
      return;
    }

    // Viewer specific checks
    if (role === 'viewer') {
      // For paid streams, verify access token
      if (stream.stream_price > 0) {
        if (!accessToken) {
          socket.destroy();
          logger.warn('Access token required for paid stream', { hashmetric });
          return;
        }

        const accessTokenRecord = await verifyAccessToken(accessToken, stream.id);
        if (!accessTokenRecord) {
          socket.destroy();
          logger.warn('Invalid or expired access token', { hashmetric });
          return;
        }
      }
    }

    // Sender specific checks
    if (role === 'sender') {
      // Verify user is the stream creator
      if (decoded.id !== stream.streamer_id) {
        socket.destroy();
        logger.warn('Unauthorized sender', { hashmetric, userId: decoded.id, streamerId: stream.streamer_id });
        return;
      }
    }

    // Accept connection
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.hashmetric = hashmetric;
      ws.streamId = stream.id;
      ws.role = role;
      ws.userId = decoded.id;
      ws.isAlive = true;
      
      logger.info('WebSocket upgrade accepted', { hashmetric, role, userId: decoded.id });
      wss.emit('connection', ws, req);
    });

  } catch (error) {
    socket.destroy();
    logger.error('Upgrade handler error', { error: error.message, stack: error.stack });
  }
});

// ============================================
// WEBSOCKET CONNECTION HANDLER
// ============================================
wss.on('connection', (ws, req) => {
  try {
    const { hashmetric, streamId, role, userId } = ws;

    // Initialize stream if needed
    if (!streams.has(hashmetric)) {
      streams.set(hashmetric, { 
        streamId, 
        sender: null, 
        viewers: new Map(),
        createdAt: new Date()
      });
      activeStreamIds.add(streamId);
      logger.info('New stream initialized', { hashmetric, streamId });
    }

    const streamData = streams.get(hashmetric);

    if (role === 'sender') {
      // Only allow one sender per stream
      if (streamData.sender) {
        ws.close(4008, 'Another sender is already streaming this content');
        logger.warn('Duplicate sender rejected', { hashmetric });
        return;
      }
      streamData.sender = ws;
      logger.info('Sender connected', { hashmetric, userId });

      // Notify viewers that sender is ready
      broadcastToStream(hashmetric, {
        type: 'sender_ready',
        timestamp: new Date().toISOString()
      });

    } else {
      // Viewer connection
      streamData.viewers.set(userId, ws);
      logger.info('Viewer connected', { hashmetric, userId, totalViewers: streamData.viewers.size });

      // Notify sender about new viewer
      if (streamData.sender && streamData.sender.readyState === WebSocket.OPEN) {
        streamData.sender.send(JSON.stringify({
          type: 'viewer_joined',
          viewerCount: streamData.viewers.size,
          timestamp: new Date().toISOString()
        }), (err) => {
          if (err) logger.error('Failed to notify sender of viewer join', { error: err.message });
        });
      }
    }

    // ========================================
    // MESSAGE HANDLER
    // ========================================
    ws.on('message', (data, isBinary) => {
      try {
        if (role === 'sender' && isBinary) {
          // Sender is sending video data - broadcast to all viewers
          const failedCount = broadcastBinaryToStream(hashmetric, data, ws);
          if (failedCount > 0) {
            logger.debug('Broadcast failures', { failedCount, totalViewers: streamData.viewers.size });
          }
        } else if (role === 'viewer' && !isBinary) {
          // Viewer sending JSON (viewer-ready signal, etc)
          try {
            const message = JSON.parse(data.toString());
            if (message.type === 'viewer-ready') {
              logger.debug('Viewer ready signal received', { userId });
            }
          } catch (parseError) {
            logger.warn('Failed to parse viewer message', { error: parseError.message });
          }
        }
      } catch (error) {
        logger.error('Message handler error', { error: error.message, role, userId });
      }
    });

    // ========================================
    // PING/PONG HANDLER (Heartbeat)
    // ========================================
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('ping', () => {
      try {
        ws.pong();
      } catch (error) {
        logger.error('Pong error', { error: error.message });
      }
    });

    // ========================================
    // ERROR HANDLER
    // ========================================
    ws.on('error', (error) => {
      logger.error('WebSocket error', {
        userId,
        role,
        hashmetric,
        error: error.message
      });
    });

    // ========================================
    // CLOSE HANDLER
    // ========================================
    ws.on('close', (code, reason) => {
      try {
        logger.info('WebSocket closed', {
          userId,
          role,
          hashmetric,
          code,
          reason,
          viewerCount: streamData.viewers.size
        });

        if (role === 'sender') {
          streamData.sender = null;
          logger.info('Sender disconnected, closing stream', { hashmetric });
          
          // Notify all viewers and close them
          broadcastToStream(hashmetric, {
            type: 'stream_ended',
            reason: 'Sender disconnected',
            timestamp: new Date().toISOString()
          });

          closeStreamConnections(hashmetric, 'Sender disconnected');
        } else {
          streamData.viewers.delete(userId);
          logger.info('Viewer disconnected', { hashmetric, userId, remainingViewers: streamData.viewers.size });

          // Notify sender
          if (streamData.sender && streamData.sender.readyState === WebSocket.OPEN) {
            streamData.sender.send(JSON.stringify({
              type: 'viewer_left',
              viewerCount: streamData.viewers.size,
              timestamp: new Date().toISOString()
            }), (err) => {
              if (err) logger.error('Failed to notify sender of viewer departure', { error: err.message });
            });
          }
        }

        // Clean up empty stream
        if (!streamData.sender && streamData.viewers.size === 0) {
          streams.delete(hashmetric);
          activeStreamIds.delete(streamId);
          logger.info('Stream cleaned up', { hashmetric, duration: Date.now() - streamData.createdAt.getTime() });
        }
      } catch (error) {
        logger.error('Close handler error', { error: error.message });
      }
    });

  } catch (error) {
    ws.close(1011, 'Internal server error');
    logger.error('Connection handler error', { error: error.message, stack: error.stack });
  }
});

// ============================================
// HEARTBEAT MECHANISM
// ============================================
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      logger.warn('Terminating inactive connection', { userId: ws.userId });
      return ws.terminate();
    }

    ws.isAlive = false;
    ws.ping((err) => {
      if (err) {
        logger.warn('Ping error', { error: err.message });
      }
    });
  });
}, HEARTBEAT_INTERVAL);

// ============================================
// STREAM STATE POLLING
// ============================================
// Poll database every 5 seconds to check for stream status changes
setInterval(async () => {
  if (activeStreamIds.size === 0) return;

  try {
    const connection = await pool.getConnection();
    const streamIdArray = Array.from(activeStreamIds);
    
    if (streamIdArray.length > 0) {
      const placeholders = streamIdArray.map(() => '?').join(',');
      const [dbStreams] = await connection.query(
        `SELECT id, stream_status, hashedmetric FROM webstreams WHERE id IN (${placeholders})`,
        streamIdArray
      );

      dbStreams.forEach((dbStream) => {
        if (dbStream.stream_status === 'completed' || dbStream.stream_status === 'cancelled') {
          logger.info('Stream status changed to inactive', { 
            streamId: dbStream.id, 
            status: dbStream.stream_status 
          });
          closeStreamConnections(dbStream.hashedmetric, `Stream ${dbStream.stream_status}`);
        }
      });
    }
    
    connection.release();
  } catch (error) {
    logger.error('Stream polling error', { error: error.message });
  }
}, 5000); // Poll every 5 seconds

// ============================================
// HEALTH CHECK ENDPOINT
// ============================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    clients: wss.clients.size,
    activeStreams: streams.size,
    uptime: process.uptime()
  });
});

// ============================================
// STATS ENDPOINT
// ============================================
app.get('/stats', (req, res) => {
  const stats = {
    timestamp: new Date().toISOString(),
    totalConnections: wss.clients.size,
    totalStreams: streams.size,
    streams: Array.from(streams.entries()).map(([hashmetric, streamData]) => ({
      hashmetric,
      streamId: streamData.streamId,
      sender: streamData.sender ? 'connected' : 'disconnected',
      viewers: streamData.viewers.size,
      uptime: Date.now() - streamData.createdAt.getTime()
    }))
  };
  res.json(stats);
});

// ============================================
// WHATSAPP WEBHOOK (LEGACY)
// ============================================
app.post('/whatsapp-webhook', (req, res) => {
  try {
    const twiml = new MessagingResponse();
    twiml.message('Message received');
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml.toString());
  } catch (error) {
    logger.error('WhatsApp webhook error', { error: error.message });
    res.status(500).end();
  }
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || parseInt(process.env.WS_PORT || '10000', 10);

server.listen(PORT, () => {
  logger.info(`🚀 WebSocket Server Started`, {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version
  });
  console.log(`✅ WebSocket server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`📈 Stats: http://localhost:${PORT}/stats`);
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  
  // Close all connections
  wss.clients.forEach((client) => {
    client.close(1001, 'Server shutting down');
  });

  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });

  // Force close after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.emit('SIGTERM');
});

// ============================================
// ERROR HANDLING
// ============================================
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', {
    reason,
    promise: promise.toString()
  });
});
