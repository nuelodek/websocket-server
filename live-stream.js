const WebSocket = require('ws');
const crypto = require('crypto');
const http = require('http');

// live-stream.js
const wss = new WebSocket.Server({ noServer: true });

// Function to generate unique hash
function generateLectureHash(educatorId, lectureName, duration, amount) {
    const data = `${educatorId}:${lectureName}:${duration}:${amount}`;
    return crypto.createHash('sha256').update(data).digest('hex');
}

// Example usage
const educatorId = 'educator123';
const lectureName = 'Math101';
const duration = 60; // in minutes
const amount = 100; // in currency units

const lectureHash = generateLectureHash(educatorId, lectureName, duration, amount);
console.log('Unique lecture hash:', lectureHash);

// You can now use this hash in your WebSocket route, e.g.:
// ws://your-server/live-stream/<lectureHash>

// Example: handle upgrade requests in your main server file
const server = http.createServer();

server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathParts = url.pathname.split('/');
    if (pathParts[1] === 'live-stream' && pathParts[2]) {
        // Optionally validate the hash here
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request, pathParts[2]);
        });
    } else {
        socket.destroy();
    }
});

wss.on('connection', (ws, request, lectureHash) => {
    console.log('New connection for lecture:', lectureHash);
    ws.on('message', (message) => {
        // Handle messages
        console.log('Received:', message.toString());
    });
});

server.listen(8080, () => {
    console.log('Server listening on port 8080');
});