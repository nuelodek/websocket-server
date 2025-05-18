const express = require('express');
const WebSocket = require('ws');

// Create server
const app = express();
const server = require('http').createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from current folder
app.use(express.static(__dirname));

// Store connected clients
const clients = new Set();

wss.on('connection', (ws) => {
  console.log('New WebSocket connection');
  clients.add(ws);

  ws.on('message', (data) => {
    console.log('Received data type:', data.constructor.name);
    console.log('Received data size:', data.length, 'bytes');

    if (Buffer.isBuffer(data)) {
      for (const client of clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      }
    } else {
      console.warn('Received invalid data format. Expected Buffer, got:', typeof data);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
  });
});

// Start the server
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
  if (process.env.RENDER_EXTERNAL_URL) {
    console.log(`WebSocket URL: wss://${process.env.RENDER_EXTERNAL_URL}`);
  } else {
    console.log(`WebSocket URL: ws://localhost:${PORT}`);
  }
});
