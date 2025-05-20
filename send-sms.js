require('dotenv').config();
const twilio = require('twilio');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

client.messages
  .create({
    body: 'Hello from WebSocket Server!',
    from: process.env.TWILIO_PHONE_NUMBER,
    to: '+2349151294786' // Replace with a verified number
  })
  .then(message => console.log('Message SID:', message.sid))
  .catch(err => console.error('Twilio Error:', err));
