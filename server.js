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
const wss = new WebSocket.Server({ noServer: true });

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static(__dirname));

// Store stream metadata
const streams = new Map(); // hashmetric => { sender: ws, viewers: Set<ws> }

// WebSocket upgrade handler
server.on('upgrade', async (req, socket, head) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const hashmetric = pathname.split('/')[2];
  const role = parsedUrl.query.role;

  if (!hashmetric || !['sender', 'viewer'].includes(role)) {
    socket.destroy();
    return;
  }

  // Validate the stream
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

    // Accept connection
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.hashmetric = hashmetric;
      ws.role = role;
      wss.emit('connection', ws, req);
    });

  } catch (err) {
    console.error('Stream validation error during upgrade:', err.message);
    socket.destroy();
  }
});

// WebSocket connection logic
wss.on('connection', (ws, req) => {
  const hashmetric = ws.hashmetric;
  const role = ws.role;

  if (!streams.has(hashmetric)) {
    streams.set(hashmetric, { sender: null, viewers: new Set() });
  }

  const stream = streams.get(hashmetric);

  if (role === 'sender') {
    // If another sender already exists, reject
    if (stream.sender) {
      ws.close();
      return;
    }
    stream.sender = ws;
    console.log(`Sender connected for stream: ${hashmetric}`);
  } else {
    // Viewer connection
    stream.viewers.add(ws);
    console.log(`Viewer connected to stream: ${hashmetric} (Total Viewers: ${stream.viewers.size})`);
  }

  // Handle messages (only sender sends)
  ws.on('message', (data) => {
    if (role === 'sender' && Buffer.isBuffer(data)) {
      for (const viewer of stream.viewers) {
        if (viewer.readyState === WebSocket.OPEN) {
          viewer.send(data);
        }
      }
    }
  });

  // Handle disconnect
  ws.on('close', () => {
    if (role === 'sender') {
      stream.sender = null;
      console.log(`Sender disconnected from stream: ${hashmetric}`);
    } else {
      stream.viewers.delete(ws);
      console.log(`Viewer left stream: ${hashmetric} (Remaining Viewers: ${stream.viewers.size})`);
    }

    // Clean up empty stream
    if (!stream.sender && stream.viewers.size === 0) {
      streams.delete(hashmetric);
      console.log(`Stream ${hashmetric} cleaned up.`);
    }
  });
});

// WhatsApp Webhook
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
