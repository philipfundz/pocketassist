const axios = require('axios');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const FormData = require('form-data');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
ffmpeg.setFfmpegPath(ffmpegPath);

const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const GEMINI_MODEL = 'gemini-2.5-flash';

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

    return sendMessage(phone, `📄 *Extracted Text:*\n━━━━━━━━━━━━━━\n\n${text}\n\n━━━━━━━━━━━━━━\nType *0* 🔙 to go back`);
  } catch (err) {
    console.error('OCR error:', err.message);
    return sendMessage(phone, '❌ OCR failed. Please try again with a clearer image.');
  } finally {
    cleanup(filePath);
  }
};

// ─── VOICE TRANSCRIBER (Gemini 2.5 Flash — native audio input) ──────────────
const handleVoiceTranscriber = async (phone, mediaUrl, sendMessage) => {
  await sendMessage(phone, '🎙️ Transcribing your voice message...');
  let filePath;
  try {
    filePath = await downloadFile(mediaUrl, 'ogg');

    const audioBytes = fs.readFileSync(filePath);
    const base64Audio = audioBytes.toString('base64');

    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    const result = await model.generateContent([
      {
        inlineData: {
          data: base64Audio,
          mimeType: 'audio/ogg',
        },
      },
      {
        text: 'Transcribe this voice message exactly as spoken. If it contains Nigerian Pidgin, Igbo, Yoruba, or Hausa words or phrases, transcribe them as spoken rather than translating to English. Return only the transcription text, with no introduction, commentary, or labels.',
      },
    ]);

    const transcript = result.response.text()?.trim();

    if (!transcript) {
      return sendMessage(phone, '❌ Could not transcribe. Please send a clearer voice message.');
    }

    return sendMessage(phone, `🎙️ *Transcription:*\n━━━━━━━━━━━━━━\n\n${transcript}\n\n━━━━━━━━━━━━━━\nType *0* 🔙 to go back`);
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

    return sendMessage(phone, `🔗 *Shortened URL:*\n\n${shortUrl}\n\n_Original:_ ${url.trim()}\n\n━━━━━━━━━━━━━━\nType *0* 🔙 to go back`);
  } catch (err) {
    console.error('URL shortener error:', err.message);
    return sendMessage(phone, '❌ Could not shorten URL. Please try again.');
  }
};

// ─── QR CODE GENERATOR (SVG logo in center) ──────────────────────────────────
const handleQRCode = async (phone, text, sendMessage, sendImage) => {
  await sendMessage(phone, '📱 Generating your QR code...');
  let qrPath, finalQrPath;
  try {
    const QRCode = require('qrcode');
    const qrSize = 600;

    qrPath = path.join(TEMP_DIR, `${uuidv4()}_qr.png`);

    await QRCode.toFile(qrPath, text.trim(), {
      errorCorrectionLevel: 'H',
      type: 'png',
      width: qrSize,
      margin: 2,
      color: {
        dark: '#111111',
        light: '#ffffff',
      },
    });

    const circleSize = 130;
    const circlePos = Math.floor((qrSize - circleSize) / 2);

    const svgOverlay = Buffer.from(`
      <svg width="${qrSize}" height="${qrSize}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="3" stdDeviation="6" flood-color="rgba(0,0,0,0.25)"/>
          </filter>
        </defs>
        <circle
          cx="${qrSize / 2}"
          cy="${qrSize / 2}"
          r="90"
          fill="white"
          filter="url(#shadow)"
        />
        <rect
          x="${qrSize / 2 - 52}"
          y="${qrSize / 2 - 52}"
          width="104"
          height="104"
          rx="22"
          ry="22"
          fill="#111111"
        />
        <text
          x="${qrSize / 2}"
          y="${qrSize / 2 + 12}"
          font-family="Arial, sans-serif"
          font-size="28"
          font-weight="bold"
          fill="white"
          text-anchor="middle"
        >PA⚡</text>
      </svg>
    `);

    finalQrPath = path.join(TEMP_DIR, `${uuidv4()}_qr_final.png`);

    await sharp(qrPath)
      .composite([{ input: svgOverlay, blend: 'over' }])
      .toFile(finalQrPath);

    cleanup(qrPath);
    qrPath = null;

    await sendImage(phone, finalQrPath, `📱 *QR Code Generated!*\n\n_Content:_ ${text.trim().substring(0, 50)}${text.length > 50 ? '...' : ''}`);
    return sendMessage(phone, '━━━━━━━━━━━━━━\nType *0* 🔙 to go back or send another text for a new QR code.');
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

    const PROMPTS = require('./prompts');

    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    const summary = await model.generateContent(PROMPTS.webpageReader(content));

    const result = summary.response.text();
    return sendMessage(phone, `🌐 *Webpage Summary:*\n━━━━━━━━━━━━━━\n\n${result}\n\n_Source:_ ${url.trim()}\n\n━━━━━━━━━━━━━━\nType *0* 🔙 to go back`);
  } catch (err) {
    console.error('Web reader error:', err.message);
    return sendMessage(phone, '❌ Could not read that webpage. Check the URL and try again.');
  }
};

// ─── SOCIAL DOWNLOADER (drop-in replacement for the function in src/fileProcessor.js)
// Fixes:
//   1. Silent crashes when response.data stream errors mid-pipe
//   2. JSON parse failure when body is unexpectedly not JSON
//   3. Missing error message forwarding from the downloader microservice
//   4. No user feedback when the download microservice itself is unreachable

const activeDownloads = new Set();

const fetchPart = async (DOWNLOADER_URL, DOWNLOADER_TOKEN, filename) => {
  const response = await axios.get(`${DOWNLOADER_URL}/file/${filename}`, {
    headers: { 'x-auth-token': DOWNLOADER_TOKEN },
    responseType: 'stream',
    timeout: 600000,
    validateStatus: () => true,
  });

  if (response.status !== 200) {
    // Drain the stream so the connection closes cleanly
    response.data.resume();
    throw new Error(`Could not fetch video part "${filename}" (HTTP ${response.status})`);
  }

  const partPath = path.join(TEMP_DIR, `${uuidv4()}_part.mp4`);
  const writer = fs.createWriteStream(partPath);

  await new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
    response.data.on('error', reject);
  });

  // Sanity-check: make sure we actually got bytes
  if (!fs.existsSync(partPath) || fs.statSync(partPath).size === 0) {
    throw new Error(`Part file "${filename}" was empty after download.`);
  }

  return partPath;
};

const handleSocialDL = async (phone, url, sendMessage, sendVideo) => {
  if (activeDownloads.has(phone)) {
    return sendMessage(
      phone,
      '⏳ You already have a download in progress.\n\nPlease wait for it to finish before starting another.'
    );
  }

  if (!url || !url.trim()) {
    return sendMessage(phone, '❌ Please paste a valid video link.\n\nType *0* 🔙 to go back.');
  }

  activeDownloads.add(phone);
  await sendMessage(phone, '⬇️ Downloading... please wait ⏳');

  let tempPath = null;

  try {
    const DOWNLOADER_URL = process.env.DOWNLOADER_URL;
    const DOWNLOADER_TOKEN = process.env.DOWNLOADER_TOKEN;

    if (!DOWNLOADER_URL || !DOWNLOADER_TOKEN) {
      throw new Error('Downloader service is not configured on this server.');
    }

    // ── POST to downloader microservice ──────────────────────────────────
    let response;
    try {
      response = await axios.post(
        `${DOWNLOADER_URL}/download`,
        { url: url.trim() },
        {
          headers: { 'x-auth-token': DOWNLOADER_TOKEN },
          responseType: 'stream',
          timeout: 600000,
          validateStatus: () => true, // Never throw on HTTP error codes — we handle them manually
        }
      );
    } catch (networkErr) {
      // Axios threw before we got a response (e.g. ECONNREFUSED, timeout)
      if (networkErr.code === 'ECONNABORTED' || networkErr.message.toLowerCase().includes('timeout')) {
        throw new Error('Download timed out — please try a shorter clip.');
      }
      throw new Error('Could not reach the download service. Please try again in a moment.');
    }

    const contentType = response.headers['content-type'] || '';

    // ── Non-200 response: read body to extract error message ─────────────
    if (response.status !== 200) {
      const chunks = [];
      for await (const chunk of response.data) chunks.push(chunk);
      const bodyText = Buffer.concat(chunks).toString('utf8');

      let errMsg = `Download failed (HTTP ${response.status})`;
      try {
        const parsed = JSON.parse(bodyText);
        if (parsed.error) errMsg = parsed.error;
      } catch (_) {
        // Body wasn't JSON — use a slice of the raw text if it looks useful
        if (bodyText.length > 0 && bodyText.length < 300) errMsg = bodyText;
      }
      throw new Error(errMsg);
    }

    // ── JSON response: video was split into parts ─────────────────────────
    if (contentType.includes('application/json')) {
      const chunks = [];
      for await (const chunk of response.data) chunks.push(chunk);
      const bodyText = Buffer.concat(chunks).toString('utf8');

      let body;
      try {
        body = JSON.parse(bodyText);
      } catch (parseErr) {
        throw new Error('Received an unexpected response from the download service.');
      }

      if (!body.split || !Array.isArray(body.files) || body.files.length === 0) {
        throw new Error('Download failed — no video parts were received.');
      }

      await sendMessage(
        phone,
        `📦 Video is large — sending in ${body.files.length} part${body.files.length > 1 ? 's' : ''}...`
      );

      for (let i = 0; i < body.files.length; i++) {
        let partPath = null;
        try {
          partPath = await fetchPart(DOWNLOADER_URL, DOWNLOADER_TOKEN, body.files[i]);

          const label = body.files.length > 1 ? `Part ${i + 1}/${body.files.length}` : '';
          const caption =
            i === 0
              ? `${body.caption || '🎬 Video downloaded via PocketAssist'}${label ? `\n\n${label}` : ''}`
              : label;

          await sendVideo(phone, partPath, caption);
        } catch (partErr) {
          console.error(`[SocialDL] Part ${i + 1} failed:`, partErr.message);
          await sendMessage(
            phone,
            `⚠️ Part ${i + 1} could not be sent: ${partErr.message}`
          );
        } finally {
          cleanup(partPath);
        }

        // Small delay between parts to avoid WhatsApp rate limits
        if (i < body.files.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      return sendMessage(
        phone,
        '━━━━━━━━━━━━━━\nType *0* 🔙 to go back or paste another link.'
      );
    }

    // ── Binary response: single video file ───────────────────────────────
    tempPath = path.join(TEMP_DIR, `${uuidv4()}_${phone}.mp4`);
    const writer = fs.createWriteStream(tempPath);

    await new Promise((resolve, reject) => {
      response.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
      response.data.on('error', reject);
    });

    // Make sure we actually got something
    if (!fs.existsSync(tempPath) || fs.statSync(tempPath).size === 0) {
      throw new Error('Download produced an empty file — the video format may be unsupported.');
    }

    const captionHeader = response.headers['x-caption'];
    const caption = captionHeader
      ? decodeURIComponent(captionHeader)
      : '🎬 Video downloaded via PocketAssist';

    await sendVideo(phone, tempPath, caption);
    return sendMessage(
      phone,
      '━━━━━━━━━━━━━━\nType *0* 🔙 to go back or paste another link.'
    );

  } catch (err) {
    console.error('[SocialDL error]', err.message);

    let userMsg;
    if (err.code === 'ECONNABORTED' || err.message.toLowerCase().includes('timed out') || err.message.toLowerCase().includes('timeout')) {
      userMsg = '⏱️ Download timed out — the video may be too long or the platform is slow right now.\n\nTry a shorter clip.';
    } else if (err.message) {
      userMsg = `❌ ${err.message}`;
    } else {
      userMsg = '❌ Download failed. Please check the link and try again.';
    }

    return sendMessage(phone, `${userMsg}\n\nType *0* 🔙 to go back.`);

  } finally {
    cleanup(tempPath);
    activeDownloads.delete(phone);
  }
};

// ─── FILE CONVERTER (Local: sharp + pdf-lib + poppler-utils — no API key) ───
const IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp'];
const DOCUMENT_FORMATS = ['docx', 'doc', 'pptx', 'xlsx'];

const handleFileConvert = async (phone, mediaUrl, mediaType, targetFormat, sendMessage, sendDocument, sendImage) => {
  let inputPath, outputPath, normalizedPath;
  try {
    let inputExt = '';
    if (mediaType.includes('pdf'))  inputExt = 'pdf';
    else if (mediaType.includes('word') || mediaType.includes('docx')) inputExt = 'docx';
    else if (mediaType.includes('doc'))  inputExt = 'doc';
    else if (mediaType.includes('pptx') || mediaType.includes('presentation')) inputExt = 'pptx';
    else if (mediaType.includes('xlsx') || mediaType.includes('spreadsheet'))  inputExt = 'xlsx';
    else if (mediaType.includes('png'))  inputExt = 'png';
    else if (mediaType.includes('webp')) inputExt = 'webp';
    else inputExt = 'jpg';

    const target = targetFormat.toLowerCase();
    console.log('[FILECONVERT DEBUG]', { mediaType, inputExt, target });

    const isDocumentSource = DOCUMENT_FORMATS.includes(inputExt);
    const isPdfToDocx = inputExt === 'pdf' && target === 'docx';

    if ((isDocumentSource && target === 'pdf') || isPdfToDocx) {
      return handleDocumentConvert(phone, mediaUrl, inputExt, target, sendMessage, sendDocument);
    }

    if (isDocumentSource || DOCUMENT_FORMATS.includes(target)) {
      return sendMessage(phone, `❌ *${inputExt.toUpperCase()} → ${target.toUpperCase()}* isn't supported yet.\n\nSupported: DOCX/PPTX/XLSX → PDF, and PDF → DOCX.\n\nType *0* 🔙 to go back.`);
    }

    await sendMessage(phone, '⚙️ Converting your file...\n\n_This may take a moment ⏳_');

    if (IMAGE_FORMATS.includes(inputExt) && IMAGE_FORMATS.includes(target)) {
      inputPath = await downloadFile(mediaUrl, inputExt);
      outputPath = path.join(TEMP_DIR, `${uuidv4()}.${target}`);

      let pipeline = sharp(inputPath);
      if (target === 'jpg' || target === 'jpeg') pipeline = pipeline.jpeg({ quality: 90 });
      else if (target === 'png') pipeline = pipeline.png();
      else if (target === 'webp') pipeline = pipeline.webp({ quality: 90 });

      await pipeline.toFile(outputPath);

      await sendDocument(phone, outputPath, `converted.${target}`, `✅ *File Converted!*\n\n_${inputExt.toUpperCase()} → ${target.toUpperCase()}_`);
      return sendMessage(phone, '━━━━━━━━━━━━━━\nType *0* 🔙 to go back or send another file to convert.');
    }

    if (IMAGE_FORMATS.includes(inputExt) && target === 'pdf') {
      const { PDFDocument } = require('pdf-lib');

      inputPath = await downloadFile(mediaUrl, inputExt);
      outputPath = path.join(TEMP_DIR, `${uuidv4()}.pdf`);

      normalizedPath = path.join(TEMP_DIR, `${uuidv4()}_norm.png`);
      await sharp(inputPath).png().toFile(normalizedPath);

      const imageBytes = fs.readFileSync(normalizedPath);
      const pdfDoc = await PDFDocument.create();
      const image = await pdfDoc.embedPng(imageBytes);
      const page = pdfDoc.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });

      const pdfBytes = await pdfDoc.save();
      fs.writeFileSync(outputPath, pdfBytes);

      await sendDocument(phone, outputPath, 'converted.pdf', `✅ *File Converted!*\n\n_${inputExt.toUpperCase()} → PDF_`);
      return sendMessage(phone, '━━━━━━━━━━━━━━\nType *0* 🔙 to go back or send another file to convert.');
    }

    if (inputExt === 'pdf' && IMAGE_FORMATS.includes(target)) {
      const { execFile } = require('child_process');
      inputPath = await downloadFile(mediaUrl, 'pdf');
      const outputBase = path.join(TEMP_DIR, uuidv4());
      const popplerFormat = (target === 'jpg' || target === 'jpeg') ? 'jpeg' : 'png';

      await new Promise((resolve, reject) => {
        execFile('pdftoppm', [`-${popplerFormat}`, '-r', '150', '-singlefile', inputPath, outputBase], (err) => {
          if (err) return reject(new Error('PDFTOPPM_MISSING_OR_FAILED'));
          resolve();
        });
      });

      const producedExt = popplerFormat === 'jpeg' ? 'jpg' : 'png';
      const producedPath = `${outputBase}.${producedExt}`;

      if (!fs.existsSync(producedPath)) {
        throw new Error('PDFTOPPM_OUTPUT_MISSING');
      }

      outputPath = producedPath;
      await sendImage(phone, outputPath, `✅ *File Converted!*\n\n_PDF → ${target.toUpperCase()}_ (page 1)`);
      return sendMessage(phone, '━━━━━━━━━━━━━━\nType *0* 🔙 to go back or send another file to convert.');
    }

    return sendMessage(phone, `❌ Conversion from *${inputExt.toUpperCase()}* to *${target.toUpperCase()}* is not supported.\n\nType *0* 🔙 to go back.`);

  } catch (err) {
    console.error('File convert error:', err.message);
    if (err.message === 'PDFTOPPM_MISSING_OR_FAILED' || err.message === 'PDFTOPPM_OUTPUT_MISSING') {
      return sendMessage(phone, '❌ PDF → Image conversion is unavailable on this server right now (poppler-utils missing or failed).\n\nType *0* 🔙 to go back.');
    }
    return sendMessage(phone, '❌ Conversion failed. Please try again.\n\nMake sure your file is not corrupted.\n\nType *0* 🔙 to go back.');
  } finally {
    cleanup(inputPath);
    cleanup(outputPath);
    cleanup(normalizedPath);
  }
};

// ─── DOCUMENT CONVERT (via pocketassist-converter microservice) ────────────
const handleDocumentConvert = async (phone, mediaUrl, inputExt, target, sendMessage, sendDocument) => {
  let inputPath, outputPath;
  try {
    const CONVERTER_URL = process.env.CONVERTER_URL;
    const CONVERTER_TOKEN = process.env.CONVERTER_TOKEN;

    inputPath = await downloadFile(mediaUrl, inputExt);

    const formData = new FormData();
    formData.append('file', fs.createReadStream(inputPath), `input.${inputExt}`);
    formData.append('targetFormat', target);

    const response = await axios.post(`${CONVERTER_URL}/convert`, formData, {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${CONVERTER_TOKEN}`,
      },
      responseType: 'stream',
      timeout: 600000,
      validateStatus: () => true,
    });

    if (response.status !== 200) {
      const chunks = [];
      for await (const chunk of response.data) chunks.push(chunk);
      const bodyText = Buffer.concat(chunks).toString('utf8');
      let errMsg = 'Conversion failed';
      try { errMsg = JSON.parse(bodyText).error || errMsg; } catch (e) {}
      throw new Error(errMsg);
    }

    outputPath = path.join(TEMP_DIR, `${uuidv4()}.${target}`);
    const writer = fs.createWriteStream(outputPath);
    await new Promise((resolve, reject) => {
      response.data.pipe(writer);
      writer.on('finish', resolve);
      writer.on('error', reject);
      response.data.on('error', reject);
    });

    await sendDocument(phone, outputPath, `converted.${target}`, `✅ *File Converted!*\n\n_${inputExt.toUpperCase()} → ${target.toUpperCase()}_`);
    return sendMessage(phone, '━━━━━━━━━━━━━━\nType *0* 🔙 to go back or send another file to convert.');

  } catch (err) {
    console.error('Document convert error:', err.message);
    let msg = '❌ Conversion failed. Please try again.\n\nType *0* 🔙 to go back.';
    if (err.code === 'ECONNABORTED' || err.message.toLowerCase().includes('timeout')) {
      msg = '⏱️ Conversion took too long and timed out. Try again in a moment.\n\nType *0* 🔙 to go back.';
    } else if (err.message.includes('not supported')) {
      msg = `❌ ${err.message}\n\nType *0* 🔙 to go back.`;
    }
    return sendMessage(phone, msg);
  } finally {
    cleanup(inputPath);
    cleanup(outputPath);
  }
};

// ─── MULTI-IMAGE TO PDF ──────────────────────────────────────────────────────
const MAX_IMAGES_PER_BATCH = 15;
const MAX_IMAGE_DIMENSION = 1600;
const JPEG_QUALITY = 75;

const handleMultiImageToPDF = async (phone, mediaUrls, sendMessage, sendDocument) => {
  await sendMessage(phone, `⚙️ Combining ${mediaUrls.length} images into one PDF...\n\n_This may take a moment ⏳_`);
  const { PDFDocument } = require('pdf-lib');
  const downloadedPaths = [];
  const compressedPaths = [];
  let outputPath;
  try {
    const pdfDoc = await PDFDocument.create();

    for (const mediaUrl of mediaUrls) {
      const inputPath = await downloadFile(mediaUrl, 'jpg');
      downloadedPaths.push(inputPath);

      const compressedPath = path.join(TEMP_DIR, `${uuidv4()}_compressed.jpg`);
      await sharp(inputPath)
        .resize(MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY })
        .toFile(compressedPath);
      compressedPaths.push(compressedPath);

      const imageBytes = fs.readFileSync(compressedPath);
      const image = await pdfDoc.embedJpg(imageBytes);
      const page = pdfDoc.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    }

    outputPath = path.join(TEMP_DIR, `${uuidv4()}_combined.pdf`);
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, pdfBytes);

    const finalSizeMB = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(1);
    await sendDocument(phone, outputPath, 'combined.pdf', `✅ *${mediaUrls.length} images combined into one PDF!*\n\n_File size: ${finalSizeMB}MB_`);
    return sendMessage(phone, '━━━━━━━━━━━━━━\nType *0* 🔙 to go back or send more images to convert.');
  } catch (err) {
    console.error('Multi-image to PDF error:', err.message);
    return sendMessage(phone, '❌ Could not combine images into PDF. Please try again.\n\nType *0* 🔙 to go back.');
  } finally {
    downloadedPaths.forEach(cleanup);
    compressedPaths.forEach(cleanup);
    cleanup(outputPath);
  }
};

// ─── WATERMARK (Premium) ──────────────────────────────────────────────────────
const handleWatermark = async (phone, mediaUrl, mediaType, sendMessage, sendImage, sendDocument) => {
  await sendMessage(phone, '🖼️ Adding watermark...');
  let inputPath, outputPath;
  try {
    const isImage = mediaType.includes('image');
    const isPDF = mediaType.includes('pdf');

    if (!isImage && !isPDF) {
      return sendMessage(phone, '❌ Please send an *image* or *PDF* to watermark.\n\nType *0* 🔙 to go back.');
    }

    if (isImage) {
      const ext = mediaType.includes('png') ? 'png' : 'jpg';
      inputPath = await downloadFile(mediaUrl, ext);
      outputPath = path.join(TEMP_DIR, `${uuidv4()}_watermarked.${ext}`);

      const image = sharp(inputPath);
      const metadata = await image.metadata();
      const { width, height } = metadata;

      const watermarkText = 'PocketAssist_Bot';
      const fontSize = Math.max(20, Math.floor(width / 20));
      const svgWatermark = Buffer.from(`
        <svg width="${width}" height="${height}">
          <style>
            .watermark {
              fill: rgba(255,255,255,0.35);
              font-size: ${fontSize}px;
              font-family: Arial, sans-serif;
              font-weight: bold;
            }
          </style>
          <text
            x="50%"
            y="50%"
            text-anchor="middle"
            dominant-baseline="middle"
            class="watermark"
            transform="rotate(-30, ${width / 2}, ${height / 2})"
          >${watermarkText}</text>
          <text
            x="50%"
            y="80%"
            text-anchor="middle"
            dominant-baseline="middle"
            class="watermark"
            transform="rotate(-30, ${width / 2}, ${height * 0.8})"
          >${watermarkText}</text>
        </svg>
      `);

      await sharp(inputPath)
        .composite([{ input: svgWatermark, blend: 'over' }])
        .toFile(outputPath);

      await sendImage(phone, outputPath, '🖼️ *Watermarked Image*\n\n_Watermark: PocketAssist_Bot_');
      return sendMessage(phone, '━━━━━━━━━━━━━━\nType *0* 🔙 to go back or send another file.');

    } else {
      const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');

      inputPath = await downloadFile(mediaUrl, 'pdf');
      outputPath = path.join(TEMP_DIR, `${uuidv4()}_watermarked.pdf`);

      const pdfBytes = fs.readFileSync(inputPath);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const watermarkText = 'PocketAssist_Bot';

      for (const page of pdfDoc.getPages()) {
        const { width, height } = page.getSize();
        const fontSize = Math.max(24, Math.floor(width / 14));
        const textWidth = font.widthOfTextAtSize(watermarkText, fontSize);

        page.drawText(watermarkText, {
          x: width / 2 - textWidth / 2,
          y: height / 2,
          size: fontSize,
          font,
          color: rgb(0.7, 0.7, 0.7),
          rotate: degrees(-30),
        });
        page.drawText(watermarkText, {
          x: width / 2 - textWidth / 2,
          y: height * 0.2,
          size: fontSize,
          font,
          color: rgb(0.7, 0.7, 0.7),
          rotate: degrees(-30),
        });
      }

      const watermarkedBytes = await pdfDoc.save();
      fs.writeFileSync(outputPath, watermarkedBytes);

      await sendDocument(phone, outputPath, 'watermarked.pdf', '🖼️ *Watermarked PDF*\n\n_Watermark: PocketAssist_Bot_');
      return sendMessage(phone, '━━━━━━━━━━━━━━\nType *0* 🔙 to go back or send another file.');
    }
  } catch (err) {
    console.error('Watermark error:', err.message);
    return sendMessage(phone, '❌ Watermark failed. Please try again.\n\nType *0* 🔙 to go back.');
  } finally {
    cleanup(inputPath);
    cleanup(outputPath);
  }
};

// ─── E-SIGN (Premium) ─────────────────────────────────────────────────────────
const handleESign = async (phone, pdfUrl, signatureImageUrl, sendMessage, sendDocument) => {
  await sendMessage(phone, '✍️ Adding your signature to the document...\n\n_This may take a moment ⏳_');
  let pdfPath, sigPath, outputPath;
  try {
    const { PDFDocument } = require('pdf-lib');

    pdfPath = await downloadFile(pdfUrl, 'pdf');
    sigPath = await downloadFile(signatureImageUrl, 'png');

    const resizedSigPath = path.join(TEMP_DIR, `${uuidv4()}_sig_resized.png`);
    await sharp(sigPath)
      .resize(200, 80, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(resizedSigPath);
    cleanup(sigPath);
    sigPath = resizedSigPath;

    const pdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const sigImageBytes = fs.readFileSync(sigPath);
    const sigImage = await pdfDoc.embedPng(sigImageBytes);

    const pages = pdfDoc.getPages();
    const lastPage = pages[pages.length - 1];
    const { width, height } = lastPage.getSize();

    lastPage.drawImage(sigImage, {
      x: width - 220,
      y: 40,
      width: 180,
      height: 60,
    });

    outputPath = path.join(TEMP_DIR, `${uuidv4()}_signed.pdf`);
    const signedPdfBytes = await pdfDoc.save();
    fs.writeFileSync(outputPath, signedPdfBytes);

    await sendDocument(phone, outputPath, 'signed_document.pdf', '✍️ *Document Signed!*\n\nYour signature has been added to the last page.');
    return sendMessage(phone, '━━━━━━━━━━━━━━\nType *0* 🔙 to go back or send another document.');
  } catch (err) {
    console.error('E-Sign error:', err.message);
    return sendMessage(phone, '❌ Signing failed. Make sure you sent a valid PDF.\n\nType *0* 🔙 to go back.');
  } finally {
    cleanup(pdfPath);
    cleanup(sigPath);
    cleanup(outputPath);
  }
};

// ─── STICKER CREATOR (Premium) ───────────────────────────────────────────────
const handleStickerCreator = async (phone, mediaUrl, sendMessage, sendSticker, sendImage) => {
  await sendMessage(phone, '🎨 Creating your sticker...');
  let inputPath, outputPath;
  try {
    inputPath = await downloadFile(mediaUrl, 'jpg');
    outputPath = path.join(TEMP_DIR, `${uuidv4()}_sticker.webp`);

    await sharp(inputPath)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      })
      .webp({ quality: 80 })
      .toFile(outputPath);

    if (!fs.existsSync(outputPath)) {
      throw new Error('Sticker file not created');
    }

    try {
      await sendSticker(phone, outputPath);
      return sendMessage(phone, '🎨 *Sticker created!*\n\n━━━━━━━━━━━━━━\nType *0* 🔙 to go back or send another image.');
    } catch (sendErr) {
      console.error('Sticker send error:', sendErr.message);
      await sendMessage(phone, '⚠️ Could not send as sticker. Sending as image instead...');
      await sendImage(phone, outputPath, '🎨 Your sticker (WebP format)');
      return sendMessage(phone, '━━━━━━━━━━━━━━\nType *0* 🔙 to go back or send another image.');
    }
    
  } catch (err) {
    console.error('Sticker error:', err.message);
    return sendMessage(phone, '❌ Sticker creation failed. Please send a clear image and try again.\n\nType *0* 🔙 to go back.');
  } finally {
    cleanup(inputPath);
    cleanup(outputPath);
  }
};

// Periodic safety sweep — removes orphaned temp files from crashed/incomplete requests
const SWEEP_INTERVAL_MS = 30 * 60 * 1000; // every 30 min
const MAX_FILE_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

setInterval(() => {
  try {
    const now = Date.now();
    const files = fs.readdirSync(TEMP_DIR);
    for (const file of files) {
      const filePath = path.join(TEMP_DIR, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > MAX_FILE_AGE_MS) {
        fs.unlinkSync(filePath);
        console.log('Swept stale temp file:', file);
      }
    }
  } catch (e) {
    console.error('Sweep error:', e.message);
  }
}, SWEEP_INTERVAL_MS);

module.exports = {
  handleOCR,
  handleVoiceTranscriber,
  handleURLShortener,
  handleQRCode,
  handleWebpageReader,
  handleSocialDL,
  handleFileConvert,
  handleMultiImageToPDF,
  handleWatermark,
  handleESign,
  handleStickerCreator,
};
