
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Pre-webhook handlers
router.get('/request', async (req, res) => {
  const { event, message } = req.query;

  try {
    const vlogs = JSON.parse(fs.readFileSync(path.join(__dirname, 'vlogs.json')));
    
    switch(event) {
      case 'onConversationAdd':
      case 'onConversationRemove':
      case 'onConversationUpdate':
      case 'onMessageAdd':
      case 'onMessageRemove':
      case 'onMessageUpdate':
      case 'onParticipantAdd':
      case 'onParticipantRemove':
      case 'onParticipantUpdate':
      case 'onUserUpdate':
        if (message && message.toLowerCase().includes('cooking')) {
          const cookingVideos = vlogs.filter(video => video.category === 'Cooking');
          if (cookingVideos.length > 0) {
            return res.status(200).json(cookingVideos);
          }
        }
        break;
    }
    
    res.status(200).send('Event processed successfully');
  } catch (err) {
    console.error("Error processing webhook:", err);
    res.status(500).send(`Webhook processing failed: ${err.message}`);
  }
});

// Post-webhook handlers
router.post('/request', async (req, res) => {
  const { event, message } = req.body;

  try {
    const vlogs = JSON.parse(fs.readFileSync(path.join(__dirname, 'vlogs.json')));
    
    switch(event) {
      case 'onConversationAdded':
      case 'onConversationRemoved':
      case 'onConversationUpdated':
      case 'onConversationStateUpdated':
      case 'onMessageAdded':
      case 'onMessageRemoved':
      case 'onMessageUpdated':
      case 'onParticipantAdded':
      case 'onParticipantRemoved':
      case 'onParticipantUpdated':
      case 'onDeliveryUpdated':
      case 'onUserAdded':
      case 'onUserUpdated':
        if (message && message.toLowerCase().includes('cooking')) {
          const cookingVideos = vlogs.filter(video => video.category === 'Cooking');
          if (cookingVideos.length > 0) {
            return res.status(200).json(cookingVideos);
          }
        }
        break;
    }

    res.status(200).send('Event processed successfully');
  } catch (err) {
    console.error("Error processing webhook:", err);
    res.status(500).send(`Webhook processing failed: ${err.message}`);
  }
});

module.exports = router;
