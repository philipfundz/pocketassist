const axios = require('axios');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const execAsync = promisify(exec);

// Temp directory for file processing
const TEMP_DIR = path.join(__dirname, '../temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR);

// Clean up temp file after use
const cleanup = (filePath) => {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.error('Cleanup error:', e.message);
  }
};

// Download file from WhatsApp media URL
const downloadFile = async (mediaUrl, ext) => {
  const filePath = path.join(TEMP_DIR, `${uuidv4()}.${ext}`);
  const response = await axios.get(mediaUrl, {
    responseType: 'arraybuffer',
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }
  });
  fs.writeFileSync(filePath, response.data);
  return filePath;
};

// ─── OCR ─────────────────────────────────────────────────
const handleOCR = async (phone, mediaUrl, sendMessage) => {
  await sendMessage(phone, '🔍 Extracting text from image...');
  let filePath;
  try {
    filePath = await downloadFile(mediaUrl, 'jpg');
    const worker = await createWorker('eng');
    const { data: { text } } = await worker.recognize(filePath);
    await worker.terminate();

    if (!text.trim()) {
      return sendMessage(phone, '❌ No text found in image. Make sure the image is clear.');
    }

    await sendMessage(phone, `📝 *Extracted Text:*\n\n${text.trim()}`);
  } catch (err) {
    await sendMessage(phone, '❌ OCR failed. Please send a clearer image.');
    console.error('OCR error:', err.message);
  } finally {
    if (filePath) cleanup(filePath);
  }
};

// ─── URL SHORTENER ────────────────────────────────────────
const handleURLShortener = async (phone, url, sendMessage) => {
  await sendMessage(phone, '🔗 Shortening your link...');
  try {
    const response = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
    await sendMessage(phone, `✅ *Shortened URL:*\n\n${response.data}\n\nOriginal: ${url}`);
  } catch (err) {
    await sendMessage(phone, '❌ Failed to shorten URL. Please check the link and try again.');
    console.error('URL shortener error:', err.message);
  }
};

// ─── QR CODE GENERATOR ────────────────────────────────────
const handleQRCode = async (phone, text, sendMessage, sendImage) => {
  await sendMessage(phone, '📱 Generating QR code...');
  try {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(text)}`;
    await sendImage(phone, qrUrl, `QR Code for: ${text}`);
  } catch (err) {
    await sendMessage(phone, '❌ Failed to generate QR code. Please try again.');
    console.error('QR error:', err.message);
  }
};

// ─── VOICE TRANSCRIBER ────────────────────────────────────
const handleVoiceTranscribe = async (phone, mediaUrl, sendMessage) => {
  await sendMessage(phone, '🎙️ Transcribing your voice message...');
  let filePath;
  try {
    filePath = await downloadFile(mediaUrl, 'ogg');
    const groq = require('groq-sdk');
    const groqClient = new groq({ apiKey: process.env.GROQ_API_KEY });

    const transcription = await groqClient.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-large-v3',
    });

    await sendMessage(phone, `🎙️ *Transcription:*\n\n${transcription.text}`);
  } catch (err) {
    await sendMessage(phone, '❌ Transcription failed. Please send a clear voice message.');
    console.error('Voice transcribe error:', err.message);
  } finally {
    if (filePath) cleanup(filePath);
  }
};

// ─── WEBPAGE READER ───────────────────────────────────────
const handleWebpageReader = async (phone, url, sendMessage) => {
  await sendMessage(phone, '🌐 Reading webpage...');
  try {
    const response = await axios.get(`https://r.jina.ai/${url}`, {
      headers: { Accept: 'text/plain' },
      timeout: 15000
    });

    const content = response.data.slice(0, 3000);
    const Groq = require('groq-sdk');
    const groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const completion = await groqClient.chat.completions.create({
      model: 'llama3-70b-8192',
      messages: [{ role: 'user', content: `Summarize this webpage content for a student:\n\n${content}\n\nProvide: 1. Main topic 2. Key points (3-5 bullets) 3. Important takeaway` }],
      max_tokens: 512
    });

    await sendMessage(phone, `🌐 *Webpage Summary:*\n\n${completion.choices[0].message.content}`);
  } catch (err) {
    await sendMessage(phone, '❌ Could not read webpage. Make sure the URL is correct and accessible.');
    console.error('Webpage reader error:', err.message);
  }
};

// ─── SOCIAL MEDIA DOWNLOADER ──────────────────────────────
const handleSocialDL = async (phone, url, sendMessage, sendVideo) => {
  await sendMessage(phone, '⬇️ Downloading... please wait');
  let outputPath;
  try {
    const ytDlp = require('yt-dlp-exec');
    outputPath = path.join(TEMP_DIR, `${uuidv4()}.mp4`);

    await ytDlp(url, {
      output: outputPath,
      format: 'best[filesize<15M]/best',
      maxFilesize: '15m',
      noPlaylist: true,
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error('Download failed — file not created');
    }

    const stats = fs.statSync(outputPath);
    if (stats.size > 15 * 1024 * 1024) {
      throw new Error('File too large (max 15MB)');
    }

    await sendVideo(phone, outputPath, '🎬 Here is your downloaded video!');
  } catch (err) {
    await sendMessage(phone, `❌ Download failed.\n\nSupported: YouTube Shorts, TikTok, Instagram, Twitter/X, Facebook\nMax size: 15MB\n\nError: ${err.message}`);
    console.error('SocialDL error:', err.message);
  } finally {
    if (outputPath) cleanup(outputPath);
  }
};

module.exports = {
  handleOCR,
  handleURLShortener,
  handleQRCode,
  handleVoiceTranscriber: handleVoiceTranscribe,
  handleWebpageReader,
  handleSocialDL
};