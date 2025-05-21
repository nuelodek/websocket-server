const express = require('express');
const fs = require('fs');
const path = require('path');

app.get('/send', async (req, res) => {
  const { message } = req.query;

  if (!message) {
    return res.status(400).send('Missing "message" query parameter.');
  }

  try {
    const vlogs = JSON.parse(fs.readFileSync(path.join(__dirname, 'vlogs.json')));
    
    if (message.toLowerCase().includes('cooking')) {
      const cookingVideos = vlogs.filter(video => video.category === 'Cooking');
      if (cookingVideos.length > 0) {
        res.json(cookingVideos);
      } else {
        res.status(404).send('No cooking videos found');
      }
    } else {
      res.status(400).send('Please specify what type of videos you want');
    }
  } catch (err) {
    console.error("Error:", err);
    res.status(500).send(`Failed to process request: ${err.message}`);
  }
});