require('dotenv').config();
const twilio = require('twilio');
const fs = require('fs');

// Load video list
const videos = JSON.parse(fs.readFileSync('vlogs.json', 'utf8'));

const client = new twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

function searchVideos(message) {
  const stopwords = ['hello', 'hi', 'mayu', 'looking', 'for', 'videos', 'i', 'am'];
  const words = message
    .toLowerCase()
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .split(' ')
    .filter((w) => !stopwords.includes(w));

  const matches = videos.filter((video) => {
    const haystack = `${video.title} ${video.category} ${video.tags}`.toLowerCase();
    return words.some((word) => haystack.includes(word));
  });

  if (matches.length > 0) {
    return matches.slice(0, 3).map(video => 
      `🎥 *${video.title}*\nCategory: ${video.category}\n📅 ${video.release_date}\n👉 https://gegeto.com.ng/${video.video_file}`
    ).join('\n\n');
  } else {
    const tags = [...new Set(videos.flatMap(v => v.tags.split(',')))];
    return `Sorry, I couldn't find matches.\nTry tags like:\n🔹 ${tags.slice(0, 6).join(', ')}`;
  }
}

client.messages
  .create({
    body: searchVideos('travel'),  // Example search for 'travel' videos
    from: 'whatsapp:+14155238886', // Twilio sandbox number
    to: 'whatsapp:+2349151294786'  // Your verified WhatsApp number (Nigeria in this case)
  })
  .then(message => console.log("Message sent with SID:", message.sid))
  .catch(err => console.error("Twilio Error:", err));
