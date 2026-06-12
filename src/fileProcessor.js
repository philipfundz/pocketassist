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

    // Draw white circle + dark rounded square + PA⚡ text using SVG
    const circleSize = 130;
    const circlePos = Math.floor((qrSize - circleSize) / 2);

    const svgOverlay = Buffer.from(`
      <svg width="${qrSize}" height="${qrSize}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="3" stdDeviation="6" flood-color="rgba(0,0,0,0.25)"/>
          </filter>
        </defs>
        <!-- White circle background -->
        <circle
          cx="${qrSize / 2}"
          cy="${qrSize / 2}"
          r="90"
          fill="white"
          filter="url(#shadow)"
        />
        <!-- Dark rounded square -->
        <rect
          x="${qrSize / 2 - 52}"
          y="${qrSize / 2 - 52}"
          width="104"
          height="104"
          rx="22"
          ry="22"
          fill="#111111"
        />
        <!-- PA⚡ text on same line -->
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

// ─── FILE CONVERTER (CloudConvert API) ───────────────────────────────────────
// Supported conversions map
const CONVERSION_MAP = {
  // To PDF
  'docx-pdf': { inputFormat: 'docx', outputFormat: 'pdf' },
  'doc-pdf':  { inputFormat: 'doc',  outputFormat: 'pdf' },
  'pptx-pdf': { inputFormat: 'pptx', outputFormat: 'pdf' },
  'xlsx-pdf': { inputFormat: 'xlsx', outputFormat: 'pdf' },
  'jpg-pdf':  { inputFormat: 'jpg',  outputFormat: 'pdf' },
  'jpeg-pdf': { inputFormat: 'jpeg', outputFormat: 'pdf' },
  'png-pdf':  { inputFormat: 'png',  outputFormat: 'pdf' },
  // From PDF
  'pdf-docx': { inputFormat: 'pdf', outputFormat: 'docx' },
  'pdf-jpg':  { inputFormat: 'pdf', outputFormat: 'jpg'  },
  'pdf-png':  { inputFormat: 'pdf', outputFormat: 'png'  },
  // Image conversions
  'png-jpg':  { inputFormat: 'png', outputFormat: 'jpg'  },
  'jpg-png':  { inputFormat: 'jpg', outputFormat: 'png'  },
  'webp-jpg': { inputFormat: 'webp', outputFormat: 'jpg' },
  'jpg-webp': { inputFormat: 'jpg', outputFormat: 'webp' },
};

const handleFileConvert = async (phone, mediaUrl, mediaType, targetFormat, sendMessage, sendDocument) => {
  await sendMessage(phone, '⚙️ Converting your file...\n\n_This may take a moment ⏳_');
  let inputPath, outputPath;
  try {
    // Detect input format from mediaType
    let inputExt = '';
    if (mediaType.includes('pdf'))  inputExt = 'pdf';
    else if (mediaType.includes('word') || mediaType.includes('docx')) inputExt = 'docx';
    else if (mediaType.includes('doc'))  inputExt = 'doc';
    else if (mediaType.includes('pptx') || mediaType.includes('presentation')) inputExt = 'pptx';
    else if (mediaType.includes('xlsx') || mediaType.includes('spreadsheet'))  inputExt = 'xlsx';
    else if (mediaType.includes('png'))  inputExt = 'png';
    else if (mediaType.includes('webp')) inputExt = 'webp';
    else inputExt = 'jpg';

    const convKey = `${inputExt}-${targetFormat.toLowerCase()}`;
    if (!CONVERSION_MAP[convKey]) {
      return sendMessage(phone, `❌ Conversion from *${inputExt.toUpperCase()}* to *${targetFormat.toUpperCase()}* is not supported.\n\nType *0* to go back.`);
    }

    // Download the file
    inputPath = await downloadFile(mediaUrl, inputExt);

    // Step 1: Create CloudConvert job
    const jobRes = await axios.post('https://api.cloudconvert.com/v2/jobs', {
      tasks: {
        'import-file': {
          operation: 'import/upload'
        },
        'convert-file': {
          operation: 'convert',
          input: 'import-file',
          input_format: inputExt,
          output_format: targetFormat.toLowerCase(),
        },
        'export-file': {
          operation: 'export/url',
          input: 'convert-file'
        }
      }
    }, {
      headers: {
        Authorization: `Bearer ${process.env.CLOUDCONVERT_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const job = jobRes.data.data;
    const importTask = job.tasks.find(t => t.name === 'import-file');

    // Step 2: Upload the file
    const uploadForm = new FormData();
    Object.entries(importTask.result.form.parameters).forEach(([k, v]) => uploadForm.append(k, v));
    uploadForm.append('file', fs.createReadStream(inputPath));

    await axios.post(importTask.result.form.url, uploadForm, {
      headers: uploadForm.getHeaders()
    });

    // Step 3: Wait for job to finish (poll)
    let exportTask = null;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const statusRes = await axios.get(`https://api.cloudconvert.com/v2/jobs/${job.id}`, {
        headers: { Authorization: `Bearer ${process.env.CLOUDCONVERT_API_KEY}` }
      });
      const tasks = statusRes.data.data.tasks;
      exportTask = tasks.find(t => t.name === 'export-file');
      if (exportTask?.status === 'finished') break;
      if (exportTask?.status === 'error') throw new Error('Conversion failed on CloudConvert');
    }

    if (!exportTask?.result?.files?.length) {
      throw new Error('No output file from CloudConvert');
    }

    // Step 4: Download converted file
    const fileUrl = exportTask.result.files[0].url;
    const fileName = exportTask.result.files[0].filename;
    outputPath = path.join(TEMP_DIR, fileName);

    const fileRes = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    fs.writeFileSync(outputPath, fileRes.data);

    // Step 5: Send to user
    await sendDocument(phone, outputPath, fileName, `✅ *File Converted!*\n\n_${inputExt.toUpperCase()} → ${targetFormat.toUpperCase()}_\n\nHere is your converted file.`);
    return sendMessage(phone, 'Type *0* to go back or send another file to convert.');
  } catch (err) {
    console.error('File convert error:', err.message);
    return sendMessage(phone, '❌ Conversion failed. Please try again.\n\nMake sure your file is not corrupted.\n\nType *0* to go back.');
  } finally {
    cleanup(inputPath);
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
      return sendMessage(phone, '❌ Please send an *image* or *PDF* to watermark.\n\nType *0* to go back.');
    }

    if (isImage) {
      // Image watermark using sharp
      const ext = mediaType.includes('png') ? 'png' : 'jpg';
      inputPath = await downloadFile(mediaUrl, ext);
      outputPath = path.join(TEMP_DIR, `${uuidv4()}_watermarked.${ext}`);

      const image = sharp(inputPath);
      const metadata = await image.metadata();
      const { width, height } = metadata;

      // Create SVG watermark text
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
      return sendMessage(phone, 'Type *0* to go back or send another file.');

    } else {
      // PDF watermark via CloudConvert
      inputPath = await downloadFile(mediaUrl, 'pdf');

      const jobRes = await axios.post('https://api.cloudconvert.com/v2/jobs', {
        tasks: {
          'import-file': { operation: 'import/upload' },
          'watermark-file': {
            operation: 'convert',
            input: 'import-file',
            input_format: 'pdf',
            output_format: 'pdf',
            options: {
              watermark: {
                text: 'PocketAssist_Bot',
                font_size: 40,
                font_color: '#cccccc',
                opacity: 35,
                rotation: -30,
              }
            }
          },
          'export-file': { operation: 'export/url', input: 'watermark-file' }
        }
      }, {
        headers: {
          Authorization: `Bearer ${process.env.CLOUDCONVERT_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      const job = jobRes.data.data;
      const importTask = job.tasks.find(t => t.name === 'import-file');

      const uploadForm = new FormData();
      Object.entries(importTask.result.form.parameters).forEach(([k, v]) => uploadForm.append(k, v));
      uploadForm.append('file', fs.createReadStream(inputPath));
      await axios.post(importTask.result.form.url, uploadForm, { headers: uploadForm.getHeaders() });

      let exportTask = null;
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const statusRes = await axios.get(`https://api.cloudconvert.com/v2/jobs/${job.id}`, {
          headers: { Authorization: `Bearer ${process.env.CLOUDCONVERT_API_KEY}` }
        });
        exportTask = statusRes.data.data.tasks.find(t => t.name === 'export-file');
        if (exportTask?.status === 'finished') break;
        if (exportTask?.status === 'error') throw new Error('Watermark failed');
      }

      const fileUrl = exportTask.result.files[0].url;
      outputPath = path.join(TEMP_DIR, `${uuidv4()}_watermarked.pdf`);
      const fileRes = await axios.get(fileUrl, { responseType: 'arraybuffer' });
      fs.writeFileSync(outputPath, fileRes.data);

      await sendDocument(phone, outputPath, 'watermarked.pdf', '🖼️ *Watermarked PDF*\n\n_Watermark: PocketAssist_Bot_');
      return sendMessage(phone, 'Type *0* to go back or send another file.');
    }
  } catch (err) {
    console.error('Watermark error:', err.message);
    return sendMessage(phone, '❌ Watermark failed. Please try again.\n\nType *0* to go back.');
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

    // Resize signature image to reasonable size
    const resizedSigPath = path.join(TEMP_DIR, `${uuidv4()}_sig_resized.png`);
    await sharp(sigPath)
      .resize(200, 80, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(resizedSigPath);
    cleanup(sigPath);
    sigPath = resizedSigPath;

    // Load PDF and embed signature
    const pdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const sigImageBytes = fs.readFileSync(sigPath);
    const sigImage = await pdfDoc.embedPng(sigImageBytes);

    // Add signature to last page bottom right
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
    return sendMessage(phone, 'Type *0* to go back or send another document.');
  } catch (err) {
    console.error('E-Sign error:', err.message);
    return sendMessage(phone, '❌ Signing failed. Make sure you sent a valid PDF.\n\nType *0* to go back.');
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

    // Convert to 512x512 WebP (WhatsApp sticker format)
    await sharp(inputPath)
      .resize(512, 512, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 }
      })
      .webp({ quality: 80 })
      .toFile(outputPath);

    // Check file was created
    if (!fs.existsSync(outputPath)) {
      throw new Error('Sticker file not created');
    }

    try {
      await sendSticker(phone, outputPath);
      return sendMessage(phone, '🎨 *Sticker created!*\n\nType *0* to go back or send another image.');
    } catch (sendErr) {
      console.error('Sticker send error:', sendErr.message);
      // If sticker sending fails, send as image instead
      await sendMessage(phone, '⚠️ Could not send as sticker. Sending as image instead...');
      await sendImage(phone, outputPath, '🎨 Your sticker (WebP format)');
      return sendMessage(phone, 'Type *0* to go back or send another image.');
    }
  } catch (err) {
    console.error('Sticker error:', err.message);
    return sendMessage(phone, '❌ Sticker creation failed. Please send a clear image and try again.\n\nType *0* to go back.');
  } finally {
    cleanup(inputPath);
    cleanup(outputPath);
  }
};

module.exports = {
  handleOCR,
  handleVoiceTranscriber,
  handleURLShortener,
  handleQRCode,
  handleWebpageReader,
  handleSocialDL,
  handleFileConvert,
  handleWatermark,
  handleESign,
  handleStickerCreator,
};
