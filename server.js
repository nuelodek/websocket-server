const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const bodyParser = require('body-parser');
const { MessagingResponse } = require('twilio').twiml;
const url = require('url');
const axios = require('axios');

// Create server
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/live-stream" });

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(express.static(__dirname)); // Serve frontend files

// Store viewers per stream hash
const streams = new Map();

wss.on('connection', async (ws, req) => {
  const pathname = url.parse(req.url).pathname;
  const hashmetric = pathname.split('/')[2];

  if (!hashmetric) {
    ws.close();
    return;
  }

  // Validate hashmetric using PHP API
  try {
    const response = await axios.get('http://gegeto.com.ng/fetchstreams.php'); // Adjust URL if hosted elsewhere
    const data = response.data;

    if (data.status !== 'success') {
      ws.close();
      return;
    }

    const validStream = data.data.find(stream =>
      stream.hashedmetric === hashmetric &&
      stream.stream_status === 'ongoing'
    );

    if (!validStream) {
      ws.close();
      return;
    }

  } catch (error) {
    console.error('Stream validation error:', error.message);
    ws.close();
    return;
  }

  // Register connection to stream
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
