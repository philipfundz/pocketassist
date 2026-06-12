require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
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

// ─── GLOBAL REQUEST QUEUE ─────────────────────────────────────────────────────
// Max 2 heavy tasks running at the same time on Render free tier
const MAX_CONCURRENT = 2;
let activeJobs = 0;
const jobQueue = [];

// Heavy tools that must go through the queue
const HEAVY_STEPS = [
  'socialdl',
  'convert_format',
  'watermark',
  'esign_sig',
  'voice',
  'web',
  'ocr',
  'rewrite',
];

const isHeavyStep = (step) => HEAVY_STEPS.includes(step);

const processQueue = () => {
  if (jobQueue.length === 0 || activeJobs >= MAX_CONCURRENT) return;
  const next = jobQueue.shift();
  activeJobs++;
  next.run().finally(() => {
    activeJobs--;
    processQueue(); // process next in queue
  });
};

const enqueueJob = (phone, run, sendMessage, position) => {
  if (position > 0) {
    sendMessage(phone, `⏳ *You're in queue (position ${position})*\n\nA heavy task is running ahead of you.\nYour request will be processed shortly...`);
  }
  jobQueue.push({ run });
  processQueue();
};

// ─── SEND FUNCTIONS ───────────────────────────────────────────────────────────

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

const sendImage = async (phone, imagePath, caption = '') => {
  const form = new FormData();
  form.append('file', fs.createReadStream(imagePath));
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'image/png');

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
      type: 'image',
      image: { id: mediaId, caption }
    },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
};

const sendVideo = async (phone, videoPath, caption = '') => {
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

const sendDocument = async (phone, filePath, filename, caption = '') => {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), filename);
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'application/octet-stream');

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
      type: 'document',
      document: { id: mediaId, filename, caption }
    },
    { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
  );
};

const sendSticker = async (phone, stickerPath) => {
  const form = new FormData();
  form.append('file', fs.createReadStream(stickerPath));
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'image/webp');

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
      type: 'sticker',
      sticker: { id: mediaId }
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

// ─── WEBHOOK VERIFICATION ─────────────────────────────────────────────────────

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

// ─── WEBHOOK MESSAGE HANDLER ──────────────────────────────────────────────────

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

    if (msgType === 'text') {
      text = msg.text?.body || '';
    } else if (msgType === 'image') {
      mediaType = 'image';
      mediaUrl = await getMediaUrl(msg.image.id);
    } else if (msgType === 'audio') {
      mediaType = 'audio';
      mediaUrl = await getMediaUrl(msg.audio.id);
    } else if (msgType === 'document') {
      mediaType = msg.document.mime_type || 'document';
      mediaUrl = await getMediaUrl(msg.document.id);
    } else if (msgType === 'video') {
      mediaType = 'video';
      mediaUrl = await getMediaUrl(msg.video.id);
    } else {
      return;
    }

    // Get or create user
    let user = await getOrCreateUser(phone);
    user = await checkAndResetDaily(user);
    const access = await checkAccess(phone);

    // Run onboarding for new users
    const isNewUser = await onboardingFlow(user, text, sendMessage);
    if (isNewUser) return;

    // Build the job function
    const job = () => handleMessage(
      phone,
      text,
      mediaUrl,
      mediaType,
      sendMessage,
      sendImage,
      sendVideo,
      sendDocument,
      sendSticker,
      user,
      access
    );

    // Check if this is a heavy step that needs queuing
    // We peek at session step via a lightweight session check
    const { getSessionStep } = require('./src/handlers');
    const currentStep = getSessionStep(phone);

    if (isHeavyStep(currentStep) && activeJobs >= MAX_CONCURRENT) {
      // Queue it and notify user of position
      const position = jobQueue.length + 1;
      enqueueJob(phone, job, sendMessage, position);
    } else if (isHeavyStep(currentStep)) {
      // Slot available — run immediately but still track it
      activeJobs++;
      job().finally(() => {
        activeJobs--;
        processQueue();
      });
    } else {
      // Light task — run immediately, no queue
      job();
    }

  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.send(`🤖 PocketAssist is running! | Active jobs: ${activeJobs} | Queued: ${jobQueue.length}`);
});
app.get('/privacy', (req, res) => {
  res.send(`
    <h1>PocketAssist Privacy Policy</h1>
    <p>PocketAssist collects only your WhatsApp phone number to provide bot services.</p>
    <p>We do not share your data with third parties.</p>
    <p>Contact: pocketassistng@gmail.com</p>
  `);
});

// ─── START SERVER ─────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🚀 PocketAssist running on port ${PORT}`);
});
