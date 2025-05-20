const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const bodyParser = require('body-parser');
const { MessagingResponse } = require('twilio').twiml;
const fs = require('fs');

// Load video list
const videos = JSON.parse(fs.readFileSync('vlogs.json', 'utf8'));

// Create server
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Body parser for Twilio webhook
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Serve static files
app.use(express.static(__dirname));

// WebSocket stuff (unchanged)
const clients = new Set();
wss.on('connection', (ws) => {
  console.log('New WebSocket connection');
  clients.add(ws);

  ws.on('message', (data) => {
    if (Buffer.isBuffer(data)) {
      for (const client of clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(data);
        }
      }
    }
  });

  ws.on('close', () => clients.delete(ws));
});

// ✅ WhatsApp Webhook Endpoint
app.post('/whatsapp-webhook', (req, res) => {
  const incomingMsg = req.body.Body.toLowerCase();
  const from = req.body.From;

  const stopwords = ['hello', 'hi', 'mayu', 'looking', 'for', 'videos', 'i', 'am'];
  const words = incomingMsg
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .split(' ')
    .filter((w) => !stopwords.includes(w));

  const matches = videos.filter((video) => {
    const haystack = `${video.title} ${video.category} ${video.tags}`.toLowerCase();
    return words.some((word) => haystack.includes(word));
  });

  const twiml = new MessagingResponse();
  if (matches.length > 0) {
    matches.slice(0, 3).forEach((video) => {
      twiml.message(
        `🎥 *${video.title}*\nCategory: ${video.category}\n📅 ${video.release_date}\n👉 https://gegeto.com.ng/${video.video_file}`
      );
    });
  } else {
    const tags = [...new Set(videos.flatMap(v => v.tags.split(',')))];
    twiml.message(`Sorry, I couldn't find matches.\nTry tags like:\n🔹 ${tags.slice(0, 6).join(', ')}`);
  }

  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});

// Start server
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`WebSocket + WhatsApp server running on port ${PORT}`);
});
