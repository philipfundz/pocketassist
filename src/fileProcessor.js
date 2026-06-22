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

// ─── SOCIAL DOWNLOADER (yt-dlp + ffmpeg compress, fully optimised) ──────────
const activeDownloads = new Set(); // tracks users currently downloading

const handleSocialDL = async (phone, url, sendMessage, sendVideo) => {
  // Fix 1: Per-user limit — reject if already downloading
  if (activeDownloads.has(phone)) {
    return sendMessage(phone, '⏳ You already have a download in progress.\n\nPlease wait for it to finish before starting another.');
  }

  activeDownloads.add(phone);
  await sendMessage(phone, '⬇️ Checking video... please wait');

  let outputPath, compressedPath;
  let ffmpegCommand = null;

  try {
    const ytDlp = require('yt-dlp-exec');

    // Fix 2: Pre-download duration check — reject over 5 min instantly
    let videoInfo;
    try {
      videoInfo = await ytDlp(url.trim(), {
        dumpSingleJson: true,
        noPlaylist: true,
        noCheckCertificates: true,
        skipDownload: true,
      });
    } catch (infoErr) {
      throw new Error('Could not fetch video info — link may be invalid or unsupported');
    }

    const durationSeconds = videoInfo?.duration || 0;

    // Extract caption/description — clean, forward-ready, no labels or branding
    const videoTitle = (videoInfo?.title || '').trim();
    const videoDescription = (videoInfo?.description || '').trim();

    // TEMP DEBUG — remove after diagnosing caption truncation (item #5)
    console.log('[SocialDL] Raw description length:', videoDescription.length);
    console.log('[SocialDL] Raw description:', videoDescription);
    console.log('[SocialDL] Raw title:', videoTitle);
    console.log('[SocialDL] Full videoInfo keys:', Object.keys(videoInfo || {}));

    // Clean up description: remove t.co links and trim
    const cleanDescription = videoDescription
      .replace(/https:\/\/t\.co\/\S+/g, '')
      .trim();

    let captionText = '';
    if (cleanDescription) {
      captionText = cleanDescription.substring(0, 800) + (cleanDescription.length > 800 ? '...' : '');
    } else if (videoTitle) {
      captionText = videoTitle.substring(0, 100);
    }

    // TEMP DEBUG — confirm what survives the cleanup step
    console.log('[SocialDL] Final captionText length:', captionText.length);
    console.log('[SocialDL] Final captionText:', captionText);

    if (durationSeconds > 300) { // 5 minutes
      const mins = Math.floor(durationSeconds / 60);
      return sendMessage(phone, `❌ Video is too long (${mins} min).\n\nMax allowed: *5 minutes*\n\nTry a shorter clip.\n\nType *0* to go back.`);
    }

    await sendMessage(phone, '⬇️ Downloading... please wait');
    outputPath = path.join(TEMP_DIR, `${uuidv4()}_${phone}.mp4`);

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
      await sendMessage(phone, '⚙️ Compressing video...\n\n_This may take up to 90 seconds ⏳_');
      compressedPath = path.join(TEMP_DIR, `${uuidv4()}_${phone}_compressed.mp4`);

      // Fix 3: ffmpeg dynamic timeout — kill process and send error
      await new Promise((resolve, reject) => {
        let finished = false;

        ffmpegCommand = ffmpeg(outputPath)
          .outputOptions([
            '-vcodec libx264',
            '-crf 28',
            '-preset fast',
            '-vf scale=480:-2',
            '-acodec aac',
            '-b:a 96k',
          ])
          .output(compressedPath)
          .on('end', () => {
            finished = true;
            resolve();
          })
          .on('error', (err) => {
            finished = true;
            reject(err);
          });

        // Dynamic timeout: 90s base + 15s per minute of video duration
        const dynamicTimeoutMs = 90000 + Math.ceil((durationSeconds / 60) * 15000);

        const timeoutHandle = setTimeout(() => {
          if (!finished) {
            try {
              ffmpegCommand.kill('SIGKILL');
            } catch (e) {
              console.error('ffmpeg kill error:', e.message);
            }
            reject(new Error('COMPRESSION_TIMEOUT'));
          }
        }, dynamicTimeoutMs);

        ffmpegCommand.on('end', () => clearTimeout(timeoutHandle));
        ffmpegCommand.on('error', () => clearTimeout(timeoutHandle));

        ffmpegCommand.run();
      });

      if (!fs.existsSync(compressedPath)) {
        throw new Error('Compression failed — output not created');
      }

      const compressedStats = fs.statSync(compressedPath);
      if (compressedStats.size > 15 * 1024 * 1024) {
        cleanup(compressedPath);
        return sendMessage(phone, '❌ Video is too large even after compression.\n\nTry a shorter clip (max ~3 min).\n\nType *0* to go back.');
      }

      finalPath = compressedPath;
    }

    // Clean caption — just the description, forward-ready for WhatsApp Status
    // Falls back to a simple message if no caption was found
    const finalCaption = captionText.trim() || '🎬 Video downloaded via PocketAssist';
    await sendVideo(phone, finalPath, finalCaption);
    return sendMessage(phone, 'Type *0* to go back or paste another link.');

  } catch (err) {
    console.error('Social DL error:', err.message);

    let msg;
    if (err.message === 'COMPRESSION_TIMEOUT') {
      msg = '⏱️ Compression took too long and was stopped.\n\nTry a shorter or lower quality clip.\n\nType *0* to go back.';
    } else if (err.message.includes('not supported') || err.message.includes('Unsupported')) {
      msg = '❌ This link is not supported.\n\nSupported: YouTube Shorts, TikTok, Instagram, Twitter/X, Facebook';
    } else if (err.message.includes('Could not fetch video info')) {
      msg = '❌ Could not read this link. Check the URL and try again.\n\nType *0* to go back.';
    } else {
      msg = '❌ Download failed. Check the link and try again.\n\nType *0* to go back.';
    }
    return sendMessage(phone, msg);

  } finally {
    // Fix 4: Force cleanup — only this user's files
    cleanup(outputPath);
    cleanup(compressedPath);
    // Fix 5: Force release — always remove from active downloads
    activeDownloads.delete(phone);
  }
};

// ─── FILE CONVERTER (Local: sharp + pdf-lib + poppler-utils — no API key) ───
// CloudConvert removed. Image<->image and image->PDF run fully local via sharp/pdf-lib.
// PDF->image runs via poppler-utils (pdftoppm) — UNTESTED on Render host, may not be
// installed; will throw a clear error if missing rather than failing silently.
// Document conversions (docx/pptx/xlsx<->pdf) are temporarily disabled pending the
// LibreOffice/Docker setup on the separate pocketassist-converter service.
const IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp'];
const DOCUMENT_FORMATS = ['docx', 'doc', 'pptx', 'xlsx'];

const handleFileConvert = async (phone, mediaUrl, mediaType, targetFormat, sendMessage, sendDocument, sendImage) => {
  let inputPath, outputPath, normalizedPath;
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

    const target = targetFormat.toLowerCase();
    console.log('[FILECONVERT DEBUG]', { mediaType, inputExt, target });

    // Document conversions temporarily disabled
    if (DOCUMENT_FORMATS.includes(inputExt) || DOCUMENT_FORMATS.includes(target)) {
      return sendMessage(phone, `⚙️ *${inputExt.toUpperCase()} ↔ ${target.toUpperCase()}* conversion is upgrading right now.\n\nIt'll be back soon on our new conversion engine.\n\nType *0* to go back.`);
    }

    await sendMessage(phone, '⚙️ Converting your file...\n\n_This may take a moment ⏳_');

    // ── Image → Image (jpg/jpeg/png/webp) ──
    if (IMAGE_FORMATS.includes(inputExt) && IMAGE_FORMATS.includes(target)) {
      inputPath = await downloadFile(mediaUrl, inputExt);
      outputPath = path.join(TEMP_DIR, `${uuidv4()}.${target}`);

      let pipeline = sharp(inputPath);
      if (target === 'jpg' || target === 'jpeg') pipeline = pipeline.jpeg({ quality: 90 });
      else if (target === 'png') pipeline = pipeline.png();
      else if (target === 'webp') pipeline = pipeline.webp({ quality: 90 });

      await pipeline.toFile(outputPath);

      await sendDocument(phone, outputPath, `converted.${target}`, `✅ *File Converted!*\n\n_${inputExt.toUpperCase()} → ${target.toUpperCase()}_`);
      return sendMessage(phone, 'Type *0* to go back or send another file to convert.');
    }

    // ── Image → PDF ──
    if (IMAGE_FORMATS.includes(inputExt) && target === 'pdf') {
      const { PDFDocument } = require('pdf-lib');

      inputPath = await downloadFile(mediaUrl, inputExt);
      outputPath = path.join(TEMP_DIR, `${uuidv4()}.pdf`);

      // Normalize to PNG first so pdf-lib can embed it regardless of source format
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
      return sendMessage(phone, 'Type *0* to go back or send another file to convert.');
    }

    // ── PDF → Image (poppler-utils / pdftoppm — UNTESTED on Render host) ──
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
      return sendMessage(phone, 'Type *0* to go back or send another file to convert.');
    }

    return sendMessage(phone, `❌ Conversion from *${inputExt.toUpperCase()}* to *${target.toUpperCase()}* is not supported.\n\nType *0* to go back.`);

  } catch (err) {
    console.error('File convert error:', err.message);
    if (err.message === 'PDFTOPPM_MISSING_OR_FAILED' || err.message === 'PDFTOPPM_OUTPUT_MISSING') {
      return sendMessage(phone, '❌ PDF → Image conversion is unavailable on this server right now (poppler-utils missing or failed).\n\nType *0* to go back.');
    }
    return sendMessage(phone, '❌ Conversion failed. Please try again.\n\nMake sure your file is not corrupted.\n\nType *0* to go back.');
  } finally {
    cleanup(inputPath);
    cleanup(outputPath);
    cleanup(normalizedPath);
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
      // PDF watermark — local via pdf-lib, no API key, no limits, runs on every page
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

        // Two diagonal passes per page, same look as the image watermark
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



