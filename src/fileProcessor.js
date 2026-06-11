const axios = require('axios');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
ffmpeg.setFfmpegPath(ffmpegPath);

// Temp directory
const TEMP_DIR = path.join(__dirname, '../temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// Logo path
const LOGO_PATH = path.join(__dirname, '../assets/pa_logo.png');

// Clean up temp file after use
const cleanup = (filePath) => {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
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

// ─── OCR (OCR.space API) ─────────────────────────────────────────────────────
const handleOCR = async (phone, mediaUrl, sendMessage) => {
  await sendMessage(phone, '🔍 Extracting text from image...');
  let filePath;
  try {
    filePath = await downloadFile(mediaUrl, 'jpg');

    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath), 'image.jpg');
    formData.append('language', 'eng');
    formData.append('isOverlayRequired', 'false');
    formData.append('OCREngine', '2');

    const response = await axios.post('https://api.ocr.space/parse/image', formData, {
      headers: {
        ...formData.getHeaders(),
        'apikey': process.env.OCR_SPACE_API_KEY || 'helloworld',
      }
    });

    const result = response.data;
    if (result.IsErroredOnProcessing) {
      return sendMessage(phone, '❌ OCR failed. Please send a clearer image.');
    }

    const text = result.ParsedResults?.[0]?.ParsedText?.trim();
    if (!text) {
      return sendMessage(phone, '❌ No text found in this image. Try a clearer photo.');
    }

    return sendMessage(phone, `📄 *Extracted Text:*\n\n${text}\n\nType *0* to go back`);
  } catch (err) {
    console.error('OCR error:', err.message);
    return sendMessage(phone, '❌ OCR failed. Please try again with a clearer image.');
  } finally {
    cleanup(filePath);
  }
};

// ─── VOICE TRANSCRIBER (Groq Whisper) ───────────────────────────────────────
const handleVoiceTranscriber = async (phone, mediaUrl, sendMessage) => {
  await sendMessage(phone, '🎙️ Transcribing your voice message...');
  let filePath;
  try {
    filePath = await downloadFile(mediaUrl, 'ogg');
    const Groq = require('groq-sdk');
    const groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const transcription = await groqClient.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: 'whisper-large-v3',
    });

    if (!transcription.text?.trim()) {
      return sendMessage(phone, '❌ Could not transcribe. Please send a clearer voice message.');
    }

    return sendMessage(phone, `🎙️ *Transcription:*\n\n${transcription.text}\n\nType *0* to go back`);
  } catch (err) {
    console.error('Voice transcribe error:', err.message);
    return sendMessage(phone, '❌ Transcription failed. Please try again.');
  } finally {
    cleanup(filePath);
  }
};

// ─── URL SHORTENER (TinyURL) ─────────────────────────────────────────────────
const handleURLShortener = async (phone, url, sendMessage) => {
  await sendMessage(phone, '🔗 Shortening your link...');
  try {
    const urlPattern = /^https?:\/\/.+/i;
    if (!urlPattern.test(url.trim())) {
      return sendMessage(phone, '❌ Invalid URL. Make sure it starts with http:// or https://');
    }

    const response = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url.trim())}`);
    const shortUrl = response.data;

    return sendMessage(phone, `🔗 *Shortened URL:*\n\n${shortUrl}\n\n_Original:_ ${url.trim()}\n\nType *0* to go back`);
  } catch (err) {
    console.error('URL shortener error:', err.message);
    return sendMessage(phone, '❌ Could not shorten URL. Please try again.');
  }
};

// ─── QR CODE GENERATOR (with PA logo) ───────────────────────────────────────
const handleQRCode = async (phone, text, sendMessage, sendImage) => {
  await sendMessage(phone, '📱 Generating your QR code...');
  let qrPath, finalQrPath;
  try {
    const QRCode = require('qrcode');

    qrPath = path.join(TEMP_DIR, `${uuidv4()}_qr.png`);

    // Generate high-quality QR
    await QRCode.toFile(qrPath, text.trim(), {
      errorCorrectionLevel: 'H',
      type: 'png',
      width: 600,
      margin: 2,
      color: {
        dark: '#1a1a2e',
        light: '#ffffff',
      },
    });

    // Embed PA logo in center if logo file exists
    if (fs.existsSync(LOGO_PATH)) {
      const qrSize = 600;
      const logoSize = 120;
      const logoPosition = Math.floor((qrSize - logoSize) / 2);

      const logoPadded = await sharp(LOGO_PATH)
        .resize(logoSize, logoSize, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .extend({ top: 8, bottom: 8, left: 8, right: 8, background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .toBuffer();

      finalQrPath = path.join(TEMP_DIR, `${uuidv4()}_qr_final.png`);

      await sharp(qrPath)
        .composite([{ input: logoPadded, top: logoPosition - 8, left: logoPosition - 8 }])
        .toFile(finalQrPath);

      cleanup(qrPath);
      qrPath = null;
    } else {
      finalQrPath = qrPath;
      qrPath = null;
    }

    await sendImage(phone, finalQrPath, `📱 *QR Code Generated!*\n\n_Content:_ ${text.trim().substring(0, 50)}${text.length > 50 ? '...' : ''}`);
    return sendMessage(phone, 'Type *0* to go back or send another text for a new QR code.');
  } catch (err) {
    console.error('QR Code error:', err.message);
    return sendMessage(phone, '❌ QR code generation failed. Please try again.');
  } finally {
    cleanup(qrPath);
    cleanup(finalQrPath);
  }
};

// ─── WEBPAGE READER ──────────────────────────────────────────────────────────
const handleWebpageReader = async (phone, url, sendMessage) => {
  await sendMessage(phone, '🌐 Reading webpage...');
  try {
    const urlPattern = /^https?:\/\/.+/i;
    if (!urlPattern.test(url.trim())) {
      return sendMessage(phone, '❌ Invalid URL. Make sure it starts with http:// or https://');
    }

    const response = await axios.get(url.trim(), {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PocketAssist/1.0)' }
    });

    let content = response.data
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 3000);

    if (!content) {
      return sendMessage(phone, '❌ Could not extract content from this page.');
    }

    const Groq = require('groq-sdk');
    const groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const PROMPTS = require('./prompts');

    const summary = await groqClient.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: PROMPTS.webpageReader(content) }],
      max_tokens: 512,
    });

    const result = summary.choices[0].message.content;
    return sendMessage(phone, `🌐 *Webpage Summary:*\n\n${result}\n\n_Source:_ ${url.trim()}\n\nType *0* to go back`);
  } catch (err) {
    console.error('Web reader error:', err.message);
    return sendMessage(phone, '❌ Could not read that webpage. Check the URL and try again.');
  }
};

// ─── SOCIAL DOWNLOADER (yt-dlp + ffmpeg compress) ───────────────────────────
const handleSocialDL = async (phone, url, sendMessage, sendVideo) => {
  await sendMessage(phone, '⬇️ Downloading... please wait');
  let outputPath, compressedPath;
  try {
    const ytDlp = require('yt-dlp-exec');
    outputPath = path.join(TEMP_DIR, `${uuidv4()}.mp4`);

    await ytDlp(url.trim(), {
      output: outputPath,
      format: 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best[height<=360]/worst',
      mergeOutputFormat: 'mp4',
      noPlaylist: true,
      noCheckCertificates: true,
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error('Download failed — file not created');
    }

    let finalPath = outputPath;
    const stats = fs.statSync(outputPath);
    const fileSizeMB = stats.size / (1024 * 1024);

    if (fileSizeMB > 10) {
      await sendMessage(phone, '⚙️ Compressing video...');
      compressedPath = path.join(TEMP_DIR, `${uuidv4()}_compressed.mp4`);

      await new Promise((resolve, reject) => {
        ffmpeg(outputPath)
          .outputOptions([
            '-vcodec libx264',
            '-crf 28',
            '-preset fast',
            '-vf scale=480:-2',
            '-acodec aac',
            '-b:a 96k',
          ])
          .output(compressedPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });

      const compressedStats = fs.statSync(compressedPath);
      if (compressedStats.size > 15 * 1024 * 1024) {
        cleanup(compressedPath);
        return sendMessage(phone, '❌ Video is too large even after compression.\n\nTry a shorter clip (max ~3 min).\n\nType *0* to go back.');
      }

      finalPath = compressedPath;
    }

    await sendVideo(phone, finalPath, '🎬 Here is your downloaded video!');
    return sendMessage(phone, 'Type *0* to go back or paste another link.');
  } catch (err) {
    console.error('Social DL error:', err.message);
    const msg = err.message.includes('not supported') || err.message.includes('Unsupported')
      ? '❌ This link is not supported.\n\nSupported: YouTube Shorts, TikTok, Instagram, Twitter/X, Facebook'
      : '❌ Download failed. Check the link and try again.\n\nType *0* to go back.';
    return sendMessage(phone, msg);
  } finally {
    cleanup(outputPath);
    cleanup(compressedPath);
  }
};

module.exports = {
  handleOCR,
  handleVoiceTranscriber,
  handleURLShortener,
  handleQRCode,
  handleWebpageReader,
  handleSocialDL,
};