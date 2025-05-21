const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const bodyParser = require('body-parser');
const { MessagingResponse } = require('twilio').twiml;
const url = require('url');
const axios = require('axios');

// Setup
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true }); // <-- CHANGE HERE

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static(__dirname));

// Store stream clients
const streams = new Map();

// Manual WebSocket upgrade to support dynamic paths
server.on('upgrade', async (req, socket, head) => {
  const pathname = url.parse(req.url).pathname;

  // Match paths like /live-stream/<hashmetric>
  const match = pathname.match(/^\/live-stream\/([a-zA-Z0-9]+)$/);
  if (!match) {
    socket.destroy();
    return;
  }

  const hashmetric = match[1];

  // Validate stream hash before accepting connection
  try {
    const response = await axios.get('http://gegeto.com.ng/fetchstreams.php');
    const data = response.data;

    if (data.status !== 'success') {
      socket.destroy();
      return;
    }

    const validStream = data.data.find(stream =>
      stream.hashedmetric === hashmetric &&
      stream.stream_status === 'ongoing'
    );

    if (!validStream) {
      socket.destroy();
      return;
    }

    // Proceed with upgrade
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.hashmetric = hashmetric;
      wss.emit('connection', ws, req);
    });

  } catch (err) {
    console.error('Stream validation error during upgrade:', err.message);
    socket.destroy();
  }
});

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  const hashmetric = ws.hashmetric;

  if (!streams.has(hashmetric)) {
    streams.set(hashmetric, new Set());
  }

  const streamClients = streams.get(hashmetric);
  streamClients.add(ws);

  console.log(`Client joined stream: ${hashmetric} (Total: ${streamClients.size})`);

  ws.on('message', (data) => {
    if (Buffer.isBuffer(data)) {
      for (const client of streamClients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      }
    }
  });

  ws.on('close', () => {
    streamClients.delete(ws);
    if (streamClients.size === 0) {
      streams.delete(hashmetric);
    }
    console.log(`Client left stream: ${hashmetric} (Remaining: ${streamClients.size})`);
  });
});

// WhatsApp webhook endpoint
app.post('/whatsapp-webhook', (req, res) => {
  const twiml = new MessagingResponse();
  twiml.message('Message received');
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});

// Start server
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`WebSocket + WhatsApp server running on port ${PORT}`);
});
