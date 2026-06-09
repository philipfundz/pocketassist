require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { getOrCreateUser, checkAndResetDaily } = require('./src/database');
const { checkAccess } = require('./src/auth');
const { onboardingFlow } = require('./src/onboarding');
const { handleMessage } = require('./src/handlers');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;

// ─── SEND FUNCTIONS ──────────────────────────────────────

const sendMessage = async (phone, text) => {
  await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: text }
    },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
};

const sendImage = async (phone, imageUrl, caption = '') => {
  await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'image',
      image: { link: imageUrl, caption }
    },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
};

const sendVideo = async (phone, videoPath, caption = '') => {
  const fs = require('fs');
  const FormData = require('form-data');
  const form = new FormData();
  form.append('file', fs.createReadStream(videoPath));
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'video/mp4');

  const uploadRes = await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/media`,
    form,
    { headers: { ...form.getHeaders(), Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );

  const mediaId = uploadRes.data.id;

  await axios.post(
    `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'video',
      video: { id: mediaId, caption }
    },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
};

// Get WhatsApp media URL from media ID
const getMediaUrl = async (mediaId) => {
  const res = await axios.get(
    `https://graph.facebook.com/v19.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
  return res.data.url;
};

// ─── WEBHOOK VERIFICATION ────────────────────────────────

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verified');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ─── WEBHOOK MESSAGE HANDLER ─────────────────────────────

app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Always respond immediately to Meta

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const messages = value?.messages;

    if (!messages || !messages.length) return;

    const msg = messages[0];
    const phone = msg.from;
    const msgType = msg.type;

    let text = '';
    let mediaUrl = null;
    let mediaType = null;

    // Extract message content
    if (msgType === 'text') {
      text = msg.text?.body || '';
    } else if (msgType === 'image') {
      mediaType = 'image';
      mediaUrl = await getMediaUrl(msg.image.id);
    } else if (msgType === 'audio') {
      mediaType = 'audio';
      mediaUrl = await getMediaUrl(msg.audio.id);
    } else if (msgType === 'document') {
      mediaType = 'document';
      mediaUrl = await getMediaUrl(msg.document.id);
    } else {
      return; // Ignore other message types for now
    }

    // Get or create user
    let user = await getOrCreateUser(phone);
    user = await checkAndResetDaily(user);
    const access = await checkAccess(phone);

    // Run onboarding for new users
    const isNewUser = await onboardingFlow(user, text, sendMessage);
    if (isNewUser) return;

    // Route to handler
    await handleMessage(
      phone,
      text,
      mediaUrl,
      mediaType,
      sendMessage,
      sendImage,
      sendVideo,
      user,
      access
    );

  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

// ─── HEALTH CHECK ────────────────────────────────────────

app.get('/', (req, res) => {
  res.send('🤖 PocketAssist is running!');
});

// ─── START SERVER ─────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🚀 PocketAssist running on port ${PORT}`);
});